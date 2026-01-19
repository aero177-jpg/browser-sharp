/**
 * Viewer module - Three.js scene, renderer, camera, controls, render loop
 */

import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

// Scene
export const scene = new THREE.Scene();
scene.background = null;

// Renderer (initialized lazily)
export let renderer;
export let composer;
export let renderPass;
export let outputPass;
export let camera;
export let controls;
export let spark;
export let raycaster;
export let stereoCamera;

// Default settings (captured after initialization)
export let defaultCamera;
export let defaultControls;

// State
export let currentMesh = null;
export let activeCamera = null;
export let needsRender = true;
export let originalImageAspect = null;
export let stereoEnabled = false;
let renderSuspended = false;

// Dolly zoom state
export let dollyZoomEnabled = true;
export let dollyZoomBaseDistance = null;
export let dollyZoomBaseFov = null;

// Background capture state
export let bgImageUrl = null;
export let bgImageContainer = null;
export let bgImageAspect = null;
let bgActivateRaf = null;
let pendingBg = null;
// FPS overlay element
export let fpsContainer = null;
let fpsLimitEnabled = true;

export const setCurrentMesh = (mesh) => { currentMesh = mesh; };
export const setActiveCamera = (cam) => { activeCamera = cam; };
export const setOriginalImageAspect = (aspect) => { originalImageAspect = aspect; };
export const setDollyZoomEnabled = (enabled) => { dollyZoomEnabled = enabled; };
export const setBgImageUrl = (url) => { bgImageUrl = url; };

const ensureStereoCamera = () => {
  if (stereoCamera) return;
  stereoCamera = new THREE.StereoCamera();
  stereoCamera.aspect = 0.5; // Default for side-by-side (each eye gets half width)
};

export const setStereoEffectEnabled = (enabled) => {
  stereoEnabled = enabled;
  if (enabled) {
    ensureStereoCamera();
  }
  requestRender();
};

export const setStereoEyeSeparation = (eyeSep) => {
  if (stereoCamera) {
    stereoCamera.eyeSep = eyeSep;
    requestRender();
  }
};

export const setStereoAspect = (aspect) => {
  if (stereoCamera) {
    stereoCamera.aspect = aspect;
    requestRender();
  }
};

const applyStochasticRendering = (enabled) => {
  if (!spark?.defaultView) return;
  spark.defaultView.stochastic = Boolean(enabled);
  requestRender();
};

const applySparkMaxStdDev = (value) => {
  if (!spark) return;
  const next = Math.max(0.5, Math.min(8, Number(value)));
  if (!Number.isFinite(next)) return;
  spark.maxStdDev = next;
  requestRender();
};

/**
 * Gets the current focus distance (camera to orbit target distance).
 * @returns {number|null} Distance in scene units, or null if not available
 */
export const getFocusDistance = () => {
  if (!camera || !controls) return null;
  return camera.position.distanceTo(controls.target);
};

/**
 * Calculates optimal stereo eye separation based on focus distance.
 * Uses a ratio of approximately 1/20 of the focus distance, which provides
 * noticeable stereo depth while remaining comfortable.
 * @param {number} focusDistance - The distance to the focal point
 * @param {number} [ratio=0.05] - Separation ratio (default ~1/20)
 * @returns {number} Optimal eye separation in scene units
 */
export const calculateOptimalEyeSeparation = (focusDistance, ratio = 0.05) => {
  // Clamp to reasonable bounds (10mm to 600mm in scene units where 1 unit ≈ 1m)
  const minSep = 0.01;
  const maxSep = 0.6;
  const calculated = focusDistance * ratio;
  return Math.max(minSep, Math.min(maxSep, calculated));
};

/** 
 * Renders scene in side-by-side stereo using StereoCamera directly.
 * This gives us access to the aspect property for VR compatibility.
 */
const renderStereo = () => {
  if (!renderer || !camera || !stereoCamera) return;

  // Update scene matrices
  if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld();
  if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld();

  // Update stereo camera from main camera
  stereoCamera.update(camera);

  const size = renderer.getSize(new THREE.Vector2());
  const currentAutoClear = renderer.autoClear;

  renderer.autoClear = false;
  renderer.clear();
  renderer.setScissorTest(true);

  // Render left eye
  renderer.setScissor(0, 0, size.width / 2, size.height);
  renderer.setViewport(0, 0, size.width / 2, size.height);
  renderer.render(scene, stereoCamera.cameraL);

  // Render right eye
  renderer.setScissor(size.width / 2, 0, size.width / 2, size.height);
  renderer.setViewport(size.width / 2, 0, size.width / 2, size.height);
  renderer.render(scene, stereoCamera.cameraR);

  renderer.setScissorTest(false);
  renderer.autoClear = currentAutoClear;
};

export const requestRender = () => {
  needsRender = true;
};

/**
 * Force an immediate render, bypassing frame rate limiting.
 * Useful for batch operations where timing is critical.
 */
export const forceRenderNow = () => {
  if (!renderer || !composer || !camera) return;
  if (stereoEnabled && stereoCamera) {
    // For stereo, call the stereo render path
    if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld();
    if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld();
    stereoCamera.update(camera);
    const size = renderer.getSize(new THREE.Vector2());
    renderer.autoClear = false;
    renderer.clear();
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, size.width / 2, size.height);
    renderer.setViewport(0, 0, size.width / 2, size.height);
    renderer.render(scene, stereoCamera.cameraL);
    renderer.setScissor(size.width / 2, 0, size.width / 2, size.height);
    renderer.setViewport(size.width / 2, 0, size.width / 2, size.height);
    renderer.render(scene, stereoCamera.cameraR);
    renderer.setScissorTest(false);
    renderer.autoClear = true;
  } else {
    composer.render();
  }
  needsRender = false;
};

export const suspendRenderLoop = () => {
  renderSuspended = true;
};

export const resumeRenderLoop = () => {
  renderSuspended = false;
  needsRender = true;
};

export const updateDollyZoomBaselineFromCamera = () => {
  if (!dollyZoomEnabled) return;
  dollyZoomBaseDistance = camera.position.distanceTo(controls.target);
  dollyZoomBaseFov = camera.fov;
};

export const initViewer = (viewerEl) => {
  // Renderer
  renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0); // Transparent clear color
  viewerEl.appendChild(renderer.domElement);

  // Camera
  camera = new THREE.PerspectiveCamera(60, 1, 0.01, 500);
  camera.position.set(0.5, 0.5, 2.5);
  defaultCamera = {
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
  };

  // Post-processing
  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  outputPass = new OutputPass();

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.75;
  controls.zoomSpeed = 0.6;
  controls.panSpeed = 0.6;
  controls.target.set(0, 0, 0);
  defaultControls = {
    dampingFactor: controls.dampingFactor,
    rotateSpeed: controls.rotateSpeed,
    zoomSpeed: controls.zoomSpeed,
    panSpeed: controls.panSpeed,
    minDistance: controls.minDistance,
    maxDistance: controls.maxDistance,
    minPolarAngle: controls.minPolarAngle,
    maxPolarAngle: controls.maxPolarAngle,
    minAzimuthAngle: controls.minAzimuthAngle,
    maxAzimuthAngle: controls.maxAzimuthAngle,
    enablePan: controls.enablePan,
  };

  // Spark renderer (lower maxStdDev for better performance)
  spark = new SparkRenderer({ renderer, maxStdDev: Math.sqrt(5) });
  scene.add(spark);

  // Raycaster for double-click
  raycaster = new THREE.Raycaster();

  // Background image container
  bgImageContainer = document.createElement("div");
  bgImageContainer.className = "bg-image-container";
  viewerEl.insertBefore(bgImageContainer, viewerEl.firstChild);

  // Subscribe to bgBlur from store to keep CSS filter in sync
  import('./store.js').then(({ useStore }) => {
    const applyBlur = (value) => {
      if (!bgImageContainer) return;
      const clamped = Math.max(0, Math.min(40, Number(value) || 0));
      bgImageContainer.style.setProperty('--bg-blur', `${clamped}px`);
      // Also set explicit filter for browsers that ignore custom property here
      bgImageContainer.style.filter = `blur(${clamped}px)`;
    };

    applyBlur(useStore.getState().bgBlur);
    useStore.subscribe((s) => s.bgBlur, applyBlur);
  }).catch(() => {});

  // Subscribe to stochastic rendering debug toggle
  import('./store.js').then(({ useStore }) => {
    applyStochasticRendering(useStore.getState().debugStochasticRendering);
    useStore.subscribe((s) => s.debugStochasticRendering, applyStochasticRendering);
  }).catch(() => {});

  // Subscribe to Spark maxStdDev slider
  import('./store.js').then(({ useStore }) => {
    applySparkMaxStdDev(useStore.getState().debugSparkMaxStdDev);
    useStore.subscribe((s) => s.debugSparkMaxStdDev, applySparkMaxStdDev);
  }).catch(() => {});

  // Subscribe to FPS limit toggle
  import('./store.js').then(({ useStore }) => {
    fpsLimitEnabled = useStore.getState().debugFpsLimitEnabled;
    useStore.subscribe((s) => s.debugFpsLimitEnabled, (enabled) => {
      fpsLimitEnabled = Boolean(enabled);
      requestRender();
    });
  }).catch(() => {});

  // FPS overlay
  fpsContainer = document.createElement('div');
  fpsContainer.id = 'fps-counter';
  fpsContainer.textContent = '';
  fpsContainer.style.display = 'none';
  viewerEl.appendChild(fpsContainer);

  // Subscribe to store for showFps flag (lazy import to avoid circular deps)
  import('./store.js').then(({ useStore }) => {
    // Initialize visibility
    const initial = useStore.getState().showFps;
    fpsContainer.style.display = initial ? 'block' : 'none';
    // Subscribe to changes
    useStore.subscribe((s) => s.showFps, (show) => {
      if (fpsContainer) fpsContainer.style.display = show ? 'block' : 'none';
    });
  }).catch(() => {});

  // Initialize dolly zoom baseline
  updateDollyZoomBaselineFromCamera();

  // Apply default camera range (imported after initialization to avoid circular dependency)
  setTimeout(() => {
    import('./cameraUtils.js').then(({ applyCameraRangeDegrees }) => {
      import('./store.js').then(({ useStore }) => {
        const defaultRange = useStore.getState().cameraRange;
        applyCameraRangeDegrees(defaultRange);
      });
    });
  }, 0);

  // On-demand rendering
  controls.addEventListener("change", requestRender);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) requestRender();
  });

  return { renderer, camera, controls, composer, spark };
};

export const startRenderLoop = () => {
  // Simple FPS measurement
  let lastTime = performance.now();
  let frameCount = 0;
  let lastFpsUpdate = performance.now();
  const targetFrameMs = 1000 / 60; // cap at 60 FPS
  let lastRenderTime = performance.now();

  const animate = () => {
    requestAnimationFrame(animate);

    // Skip rendering if tab is hidden
    if (document.hidden) return;

    const now = performance.now();
    if (fpsLimitEnabled) {
      const elapsedSinceRender = now - lastRenderTime;
      if (elapsedSinceRender < targetFrameMs) {
        return;
      }
      // Align to the frame boundary to reduce drift on high-refresh monitors
      lastRenderTime = now - (elapsedSinceRender % targetFrameMs);
    } else {
      lastRenderTime = now;
    }

    if (renderSuspended || !renderer || !controls || !composer || !camera) {
      return;
    }

    // Always update controls for damping, but only render if needed
    const controlsNeedUpdate = controls.update();

    if (needsRender || controlsNeedUpdate) {
      if (stereoEnabled && stereoCamera) {
        renderStereo();
      } else {
        composer.render();
      }
      needsRender = false;
      frameCount++;
    }

    // Update FPS display once per 250ms if present
    if (fpsContainer && fpsContainer.style.display === 'block') {
      const now = performance.now();
      const dt = now - lastFpsUpdate;
      if (dt >= 250) {
        const fps = Math.round((frameCount * 1000) / dt);
        fpsContainer.textContent = `${fps} FPS`;
        frameCount = 0;
        lastFpsUpdate = now;
      }
    }
  };
  animate();
};

export const removeCurrentMesh = () => {
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh = null;
  }
};

const cancelPendingBgActivation = () => {
  if (bgActivateRaf) {
    cancelAnimationFrame(bgActivateRaf);
    bgActivateRaf = null;
  }
  pendingBg = null;
};

export const updateBackgroundImage = (url) => {
  if (!bgImageContainer) return;
  cancelPendingBgActivation();

  if (url) {
    const viewerEl = bgImageContainer.parentElement;
    const isSlidingOut = viewerEl?.classList.contains("slide-out");
    const isSlidingIn = viewerEl?.classList.contains("slide-in");

    if (isSlidingOut) {
      // During slide-out, defer swap until slide-out completes (old bg stays visible)
      pendingBg = { url };
      bgActivateRaf = requestAnimationFrame(function waitUntilSlideOutEnds() {
        bgActivateRaf = null;
        if (viewerEl?.classList.contains("slide-out")) {
          bgActivateRaf = requestAnimationFrame(waitUntilSlideOutEnds);
          return;
        }
        // slide-out done, apply the new background (slide-in may now be active)
        if (pendingBg) {
          bgImageContainer.style.backgroundImage = `url(${pendingBg.url})`;
          bgImageUrl = pendingBg.url;
          pendingBg = null;
        }
        bgImageContainer.classList.add("active");
        requestRender();
      });
    } else if (isSlidingIn) {
      // During slide-in, apply immediately so it fades in with canvas
      bgImageContainer.style.backgroundImage = `url(${url})`;
      bgImageUrl = url;
      bgImageContainer.classList.add("active");
    } else {
      bgImageContainer.style.backgroundImage = `url(${url})`;
      bgImageUrl = url;
      bgImageContainer.classList.add("active");
    }
  } else {
    pendingBg = null;
    bgImageContainer.style.backgroundImage = "none";
    bgImageContainer.classList.remove("active");
  }

  requestRender();
};

// Export THREE and SplatMesh for use in other modules
export { THREE, SplatMesh };
