import "./style.css";
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import {
  getFormatAccept,
  getFormatHandler,
  getSupportedExtensions,
  getSupportedLabel,
} from "./formats/index.js";

const app = document.querySelector("#app");
const supportedLabel = getSupportedLabel();
const formatAccept = getFormatAccept();
const supportedExtensions = getSupportedExtensions();
const supportedExtensionsText = supportedExtensions.join(", ");

app.innerHTML = `
  <div class="page">
    <div id="viewer" class="viewer">
      <div class="loading-overlay"><div class="loading-spinner"></div></div>
      <div class="drop-help">
        <div class="eyebrow">Drag ${supportedLabel} files here</div>
        <div class="fine-print">Spark + THREE 3DGS</div>
      </div>
    </div>
    <button
      id="panel-toggle"
      class="panel-toggle"
      aria-label="Toggle info panel"
      aria-controls="side-panel"
      aria-expanded="true"
      type="button"
    >></button>
    <div class="side" id="side-panel">
      <div class="header">
        <div>
          <div class="title">3DGS File Upload</div>
          <div class="subtitle">Drag & drop or pick local files to view instantly</div>
        </div>
        <button id="pick-btn" class="primary">Choose File</button>
        <input id="file-input" type="file" accept="${formatAccept}" hidden />
      </div>
      <div class="hint">After import, debug info prints on the right and the scene renders live on the left.</div>
      <div class="debug">
        <div class="row"><span>Status</span><span id="status">Waiting for file...</span></div>
        <div class="row"><span>File</span><span id="file-name">-</span></div>
        <div class="row"><span>Size</span><span id="file-size">-</span></div>
        <div class="row"><span>Splats</span><span id="splat-count">-</span></div>
        <div class="row"><span>Time</span><span id="load-time">-</span></div>
        <div class="row"><span>Bounds</span><span id="bounds">-</span></div>
      </div>
      <div class="settings">
        <div class="row">
          <label>
            <input type="checkbox" id="grid-toggle" checked />
            Show grid
          </label>
        </div>
        <div class="row fov-controls camera-range-controls">
          <label for="camera-range-slider">Camera range</label>
          <input type="range" id="camera-range-slider" min="0" max="1" step="0.01" value="0.33" />
          <span id="camera-range-label">Sm</span>
        </div>
        <div class="row fov-controls">
          <label for="fov-slider">FOV</label>
          <input type="range" id="fov-slider" min="20" max="120" step="1" value="60" />
          <span id="fov-value">60°</span>
        </div>
        <div class="row">
          <button id="recenter-btn" class="secondary">Recenter view</button>
        </div>
        <div class="row">
          <label>
            <input type="checkbox" id="bg-image-toggle" />
            Show background image
          </label>
        </div>
        <div class="row bg-image-controls" id="bg-image-controls">
          <button id="bg-image-btn" class="secondary">Choose Background</button>
          <input id="bg-image-input" type="file" accept="image/*" hidden />
          <input type="range" id="bg-blur-slider" min="0" max="50" value="20" />
          <span id="bg-blur-value">20px</span>
        </div>
      </div>
      <div class="log" id="log"></div>
    </div>
  </div>
`;

// UI references
const viewerEl = document.getElementById("viewer");
const pageEl = document.querySelector(".page");
const panelToggleBtn = document.getElementById("panel-toggle");
const pickBtn = document.getElementById("pick-btn");
const fileInput = document.getElementById("file-input");
const statusEl = document.getElementById("status");
const fileNameEl = document.getElementById("file-name");
const fileSizeEl = document.getElementById("file-size");
const splatCountEl = document.getElementById("splat-count");
const loadTimeEl = document.getElementById("load-time");
const boundsEl = document.getElementById("bounds");
const logEl = document.getElementById("log");
const gridToggleEl = document.getElementById("grid-toggle");
const recenterBtn = document.getElementById("recenter-btn");
const cameraRangeSliderEl = document.getElementById("camera-range-slider");
const cameraRangeLabelEl = document.getElementById("camera-range-label");
const fovSliderEl = document.getElementById("fov-slider");
const fovValueEl = document.getElementById("fov-value");
const bgImageToggleEl = document.getElementById("bg-image-toggle");
const bgImageControlsEl = document.getElementById("bg-image-controls");
const bgImageBtn = document.getElementById("bg-image-btn");
const bgImageInput = document.getElementById("bg-image-input");
const bgBlurSlider = document.getElementById("bg-blur-slider");
const bgBlurValue = document.getElementById("bg-blur-value");

if (panelToggleBtn && pageEl) {
  const updatePanelState = (isOpen) => {
    pageEl.classList.toggle("panel-open", isOpen);
    panelToggleBtn.setAttribute("aria-expanded", String(isOpen));
    panelToggleBtn.textContent = isOpen ? ">" : "<";
    panelToggleBtn.title = isOpen ? "Hide info panel" : "Show info panel";
  };

  updatePanelState(true);

  panelToggleBtn.addEventListener("click", () => {
    const nextState = !pageEl.classList.contains("panel-open");
    updatePanelState(nextState);
    // Recalculate viewer size after panel animation
    setTimeout(resize, 350);
  });
}

const logBuffer = [];
const appendLog = (message) => {
  const entry = `[${new Date().toLocaleTimeString()}] ${message}`;
  logBuffer.unshift(entry);
  logBuffer.length = Math.min(logBuffer.length, 14);
  logEl.textContent = logBuffer.join("\n");
  console.info(message);
};

const setStatus = (message) => {
  statusEl.textContent = message;
  appendLog(message);
};

const resetInfo = () => {
  fileNameEl.textContent = "-";
  fileSizeEl.textContent = "-";
  splatCountEl.textContent = "-";
  loadTimeEl.textContent = "-";
  boundsEl.textContent = "-";
};

resetInfo();
setStatus("Waiting for file...");

// Background image setup
let bgImageEnabled = false;
let bgImageUrl = null;
const bgImageContainer = document.createElement("div");
bgImageContainer.className = "bg-image-container";
viewerEl.insertBefore(bgImageContainer, viewerEl.firstChild);

const updateBackgroundImage = (url, blur = 20) => {
  if (url) {
    bgImageContainer.style.backgroundImage = `url(${url})`;
    bgImageContainer.style.filter = `blur(${blur}px)`;
    bgImageContainer.classList.add("active");
  } else {
    bgImageContainer.style.backgroundImage = "none";
    bgImageContainer.classList.remove("active");
  }
  requestRender();
};

const setBackgroundImageEnabled = (enabled) => {
  bgImageEnabled = enabled;
  if (enabled && bgImageUrl) {
    updateBackgroundImage(bgImageUrl, parseInt(bgBlurSlider?.value || 20));
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
  } else {
    bgImageContainer.classList.remove("active");
    scene.background = new THREE.Color("#0c1018");
    renderer.setClearColor(0x0c1018, 1);
  }
  requestRender();
};

// Three + Spark setup
const scene = new THREE.Scene();
scene.background = new THREE.Color("#0c1018");

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: true,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(window.devicePixelRatio);
viewerEl.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 500);
camera.position.set(0.5, 0.5, 2.5);
const defaultCamera = {
  fov: camera.fov,
  near: camera.near,
  far: camera.far,
};

const composer = new EffectComposer( renderer );
const renderPass = new RenderPass( scene, camera );
composer.addPass( renderPass );

const outputPass = new OutputPass();
// composer.addPass( outputPass ); // Managed dynamically

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.75;
controls.zoomSpeed = 0.6;
controls.panSpeed = 0.6;
controls.target.set(0, 0, 0);
const defaultControls = {
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
const cameraLimitPresets = {
  locked: {
    minDistance: 1.0,
    maxDistance: 1.3,
    minPolarAngle: Math.PI * 0.48,
    maxPolarAngle: Math.PI * 0.52,
    minAzimuthAngle: -Math.PI * 0.02,
    maxAzimuthAngle: Math.PI * 0.02,
    enablePan: false,
  },
  sm: {
    minDistance: 0.9,
    maxDistance: 1.8,
    minPolarAngle: Math.PI * 0.45,
    maxPolarAngle: Math.PI * 0.55,
    minAzimuthAngle: -Math.PI * 0.05,
    maxAzimuthAngle: Math.PI * 0.05,
    enablePan: false,
  },
  md: {
    minDistance: 0.7,
    maxDistance: 2.5,
    minPolarAngle: Math.PI * 0.2,
    maxPolarAngle: Math.PI * 0.8,
    minAzimuthAngle: -Math.PI * 0.4,
    maxAzimuthAngle: Math.PI * 0.4,
    enablePan: true,
  },
  lg: {
    minDistance: 0.5,
    maxDistance: 4.0,
    minPolarAngle: Math.PI * 0.15,
    maxPolarAngle: Math.PI * 0.85,
    // ~180° orbit around the subject
    minAzimuthAngle: -Math.PI * 0.5,
    maxAzimuthAngle: Math.PI * 0.5,
    // Allow panning over an area roughly matching the splat size
    enablePan: true,
  },
};

let cameraLimitConfig = cameraLimitPresets.sm;

const spark = new SparkRenderer({ renderer });
scene.add(spark);

// Raycaster for double-click anchor point selection
const raycaster = new THREE.Raycaster();

// Provide a simple ground for orientation
const grid = new THREE.GridHelper(2.5, 10, 0x2a2f3a, 0x151822);
grid.position.y = -0.5;
scene.add(grid);
grid.visible = false;

if (gridToggleEl) {
  gridToggleEl.checked = grid.visible;
}

// Dolly zoom state
let dollyZoomEnabled = true;
let dollyZoomBaseDistance = null;
let dollyZoomBaseFov = null;

const updateDollyZoomBaselineFromCamera = () => {
  if (!dollyZoomEnabled) return;
  dollyZoomBaseDistance = camera.position.distanceTo(controls.target);
  dollyZoomBaseFov = camera.fov;
};

if (fovSliderEl) {
  fovSliderEl.value = camera.fov;
  if (fovValueEl) fovValueEl.textContent = `${camera.fov.toFixed(0)}°`;
}

// Initialize dolly zoom baseline from the initial camera view
updateDollyZoomBaselineFromCamera();

let currentMesh = null;
let activeCamera = null;
let needsRender = true;
let renderTimeout = null;
let originalImageAspect = null; // Track original image aspect ratio for viewer sizing

const requestRender = () => {
  needsRender = true;
};

const updateViewerAspectRatio = () => {
  const pageEl = document.querySelector(".page");
  const sidePanelWidth = pageEl.classList.contains("panel-open") ? 456 : 0; // 420px + margins
  const availableWidth = window.innerWidth - 36 - sidePanelWidth; // 36px = 18px padding * 2
  const availableHeight = window.innerHeight - 36;

  if (originalImageAspect && originalImageAspect > 0) {
    // Calculate dimensions to fit the aspect ratio within available space
    let viewerWidth, viewerHeight;
    
    // First, try to fill the height
    viewerHeight = availableHeight;
    viewerWidth = viewerHeight * originalImageAspect;
    
    // If width exceeds available, constrain by width instead
    if (viewerWidth > availableWidth) {
      viewerWidth = availableWidth;
      viewerHeight = viewerWidth / originalImageAspect;
    }
    
    viewerEl.style.width = `${viewerWidth}px`;
    viewerEl.style.height = `${viewerHeight}px`;
  } else {
    // No aspect ratio set, use full available space
    viewerEl.style.width = `${availableWidth}px`;
    viewerEl.style.height = `${availableHeight}px`;
  }
};

const resize = () => {
  updateViewerAspectRatio();
  const { clientWidth, clientHeight } = viewerEl;
  renderer.setSize(clientWidth, clientHeight, false);
  composer.setSize(clientWidth, clientHeight);
  if (activeCamera) {
    applyCameraProjection(activeCamera, clientWidth, clientHeight);
  } else {
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  }
  requestRender();
};

window.addEventListener("resize", resize);
resize();

if (gridToggleEl) {
  gridToggleEl.addEventListener("change", (event) => {
    grid.visible = event.target.checked;
    requestRender();
  });
}

if (recenterBtn) {
  recenterBtn.addEventListener("click", () => {
    restoreHomeView();
  });
}

// Global keyboard shortcut: Spacebar to recenter view
document.addEventListener("keydown", (event) => {
  // Avoid interfering with typing in inputs/buttons/contentEditable
  const target = event.target;
  const tag = target?.tagName;
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "BUTTON" ||
    target?.isContentEditable
  ) {
    return;
  }

  if (event.code === "Space" || event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    restoreHomeView();
  }
});

// Double-click to set new orbit anchor point
renderer.domElement.addEventListener("dblclick", (event) => {
  if (!currentMesh) return;

  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  raycaster.setFromCamera(mouse, camera);
  const intersects = [];
  raycaster.intersectObjects(scene.children, true, intersects);

  // Find the first splat mesh intersection
  const splatHit = intersects.find((i) => i.object instanceof SplatMesh);
  if (splatHit) {
    controls.target.copy(splatHit.point);
    controls.update();
    updateDollyZoomBaselineFromCamera();
    requestRender();
    appendLog(`Anchor set: ${formatVec3(splatHit.point)} (distance: ${splatHit.distance.toFixed(2)})`);
  }
});

// On-demand rendering: only render when needed to save GPU
controls.addEventListener("change", requestRender);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) requestRender();
});

const animate = () => {
  requestAnimationFrame(animate);

  // Skip rendering if tab is hidden
  if (document.hidden) return;

  // Always update controls for damping, but only render if needed
  const controlsNeedUpdate = controls.update();

  if (needsRender || controlsNeedUpdate) {
    composer.render();
    needsRender = false;
  }
};
animate();

// Helpers
const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
};

const formatVec3 = (vec) =>
  `${vec.x.toFixed(2)}, ${vec.y.toFixed(2)}, ${vec.z.toFixed(2)}`;

let homeView = null;

const saveHomeView = () => {
  homeView = {
    cameraPosition: camera.position.clone(),
    cameraQuaternion: camera.quaternion.clone(),
    cameraFov: camera.fov,
    cameraNear: camera.near,
    cameraFar: camera.far,
    cameraZoom: camera.zoom,
    controlsTarget: controls.target.clone(),
    controlsDampingFactor: controls.dampingFactor,
    controlsRotateSpeed: controls.rotateSpeed,
    controlsZoomSpeed: controls.zoomSpeed,
    controlsPanSpeed: controls.panSpeed,
    activeCamera: activeCamera ? JSON.parse(JSON.stringify(activeCamera)) : null,
  };
};

const restoreHomeView = () => {
  if (!homeView) return;

  camera.position.copy(homeView.cameraPosition);
  camera.quaternion.copy(homeView.cameraQuaternion);
  camera.fov = homeView.cameraFov;
  camera.near = homeView.cameraNear;
  camera.far = homeView.cameraFar;
  camera.zoom = homeView.cameraZoom;
  camera.updateProjectionMatrix();

  controls.target.copy(homeView.controlsTarget);
  controls.dampingFactor = homeView.controlsDampingFactor;
  controls.rotateSpeed = homeView.controlsRotateSpeed;
  controls.zoomSpeed = homeView.controlsZoomSpeed;
  controls.panSpeed = homeView.controlsPanSpeed;

  activeCamera = homeView.activeCamera ? { ...homeView.activeCamera } : null;

  // Sync UI FOV slider with restored camera fov
  if (fovSliderEl) {
    fovSliderEl.value = String(camera.fov);
    if (fovValueEl) fovValueEl.textContent = `${camera.fov.toFixed(0)}°`;
  }

  // Reset dolly zoom to its default enabled state and baseline
  dollyZoomEnabled = true;
  updateDollyZoomBaselineFromCamera();

  controls.update();
  requestRender();
  resize();
};

function applyCameraMovementLimits(enabled) {
  if (enabled) {
    controls.minPolarAngle = cameraLimitConfig.minPolarAngle;
    controls.maxPolarAngle = cameraLimitConfig.maxPolarAngle;
    controls.minAzimuthAngle = cameraLimitConfig.minAzimuthAngle;
    controls.maxAzimuthAngle = cameraLimitConfig.maxAzimuthAngle;
    controls.enablePan = cameraLimitConfig.enablePan;
  } else {
    controls.minPolarAngle = defaultControls.minPolarAngle;
    controls.maxPolarAngle = defaultControls.maxPolarAngle;
    controls.minAzimuthAngle = defaultControls.minAzimuthAngle;
    controls.maxAzimuthAngle = defaultControls.maxAzimuthAngle;
    controls.enablePan = defaultControls.enablePan;
  }
}

const fitViewToMesh = (mesh) => {
  if (!mesh.getBoundingBox) return;
  const box = mesh.getBoundingBox();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const radius = Math.max(size.length() * 0.5, 0.5);
  const dist = radius / Math.tan((camera.fov * Math.PI) / 360);

  camera.position.copy(center).add(new THREE.Vector3(dist, dist, dist));
  camera.near = Math.max(0.01, radius * 0.01);
  camera.far = Math.max(dist * 4, radius * 8);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
  updateDollyZoomBaselineFromCamera();
  requestRender();

  boundsEl.textContent = `${formatVec3(center)} | size ${formatVec3(size)}`;
};

const makeAxisFlipCvToGl = () =>
  new THREE.Matrix4().set(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1);

const quantileSorted = (sorted, q) => {
  if (!sorted.length) return null;
  const clampedQ = Math.max(0, Math.min(1, q));
  const pos = (sorted.length - 1) * clampedQ;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  const weight = pos - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

const computeMlSharpDepthFocus = (
  mesh,
  { qFocus = 0.1, minDepthFocus = 2.0, maxSamples = 50_000 } = {},
) => {
  const numSplats = mesh?.packedSplats?.numSplats ?? 0;
  if (!numSplats) return minDepthFocus;

  const step = Math.max(1, Math.floor(numSplats / maxSamples));
  const depths = [];
  for (let i = 0; i < numSplats; i += step) {
    const { center } = mesh.packedSplats.getSplat(i);
    const z = center.z;
    if (Number.isFinite(z) && z > 0) depths.push(z);
  }

  if (!depths.length) return minDepthFocus;
  depths.sort((a, b) => a - b);
  const q = quantileSorted(depths, qFocus);
  if (!Number.isFinite(q)) return minDepthFocus;
  return Math.max(minDepthFocus, q);
};

const makeProjectionFromIntrinsics = ({
  fx,
  fy,
  cx,
  cy,
  width,
  height,
  near,
  far,
}) => {
  const left = (-cx * near) / fx;
  const right = ((width - cx) * near) / fx;
  const top = (cy * near) / fy;
  const bottom = (-(height - cy) * near) / fy;

  return new THREE.Matrix4().set(
    (2 * near) / (right - left),
    0,
    (right + left) / (right - left),
    0,
    0,
    (2 * near) / (top - bottom),
    (top + bottom) / (top - bottom),
    0,
    0,
    0,
    -(far + near) / (far - near),
    (-2 * far * near) / (far - near),
    0,
    0,
    -1,
    0,
  );
};

const applyCameraProjection = (cameraMetadata, viewportWidth, viewportHeight) => {
  const { intrinsics, near, far } = cameraMetadata;
  const sx = viewportWidth / intrinsics.imageWidth;
  const sy = viewportHeight / intrinsics.imageHeight;
  const s = Math.min(sx, sy);
  const scaledWidth = intrinsics.imageWidth * s;
  const scaledHeight = intrinsics.imageHeight * s;
  const offsetX = (viewportWidth - scaledWidth) * 0.5;
  const offsetY = (viewportHeight - scaledHeight) * 0.5;

  const fx = intrinsics.fx * s;
  const fy = intrinsics.fy * s;
  const cx = intrinsics.cx * s + offsetX;
  const cy = intrinsics.cy * s + offsetY;

  camera.aspect = viewportWidth / viewportHeight;
  camera.fov = THREE.MathUtils.radToDeg(
    2 * Math.atan(viewportHeight / (2 * Math.max(1e-6, fy))),
  );
  camera.near = near;
  camera.far = far;

  const fovScale = THREE.MathUtils.clamp(camera.fov / defaultCamera.fov, 0.05, 2.0);
  controls.rotateSpeed = Math.max(0.02, defaultControls.rotateSpeed * fovScale * 0.45);
  controls.zoomSpeed = Math.max(0.05, defaultControls.zoomSpeed * fovScale * 0.8);
  controls.panSpeed = Math.max(0.05, defaultControls.panSpeed * fovScale * 0.8);

  const projection = makeProjectionFromIntrinsics({
    fx,
    fy,
    cx,
    cy,
    width: viewportWidth,
    height: viewportHeight,
    near,
    far,
  });
  camera.projectionMatrix.copy(projection);
  camera.projectionMatrixInverse.copy(projection).invert();
};

const applyMetadataCamera = (mesh, cameraMetadata) => {
  const cvToThree = makeAxisFlipCvToGl();
  if (!mesh.userData.__cvToThreeApplied) {
    mesh.applyMatrix4(cvToThree);
    mesh.userData.__cvToThreeApplied = true;
  }
  mesh.updateMatrixWorld(true);

  const e = cameraMetadata.extrinsicCv;
  const extrinsicCv = new THREE.Matrix4().set(
    e[0],
    e[1],
    e[2],
    e[3],
    e[4],
    e[5],
    e[6],
    e[7],
    e[8],
    e[9],
    e[10],
    e[11],
    e[12],
    e[13],
    e[14],
    e[15],
  );

  const view = new THREE.Matrix4().multiplyMatrices(cvToThree, extrinsicCv).multiply(cvToThree);
  const cameraWorld = new THREE.Matrix4().copy(view).invert();

  camera.matrixAutoUpdate = true;
  camera.matrixWorld.copy(cameraWorld);
  camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale);
  camera.updateMatrix();
  camera.updateMatrixWorld(true);

  if (mesh?.getBoundingBox) {
    const box = mesh.getBoundingBox();
    const worldBox = box.clone().applyMatrix4(mesh.matrixWorld);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    worldBox.getSize(size);
    worldBox.getCenter(center);
    const radius = Math.max(size.length() * 0.5, 0.25);

    const camPos = camera.position.clone();
    const dist = camPos.distanceTo(center);

    const near = Math.max(0.01, dist - radius * 2.0);
    const far = Math.max(near + 1.0, dist + radius * 6.0);
    activeCamera = { ...cameraMetadata, near, far };

    boundsEl.textContent = `${formatVec3(center)} | size ${formatVec3(size)}`;
  } else {
    activeCamera = { ...cameraMetadata, near: 0.01, far: 1000 };
  }

  const depthFocusCv = computeMlSharpDepthFocus(mesh);
  const lookAtCv = new THREE.Vector3(0, 0, depthFocusCv);
  const lookAtThree = lookAtCv.applyMatrix4(mesh.matrixWorld);
  controls.target.copy(lookAtThree);
  appendLog(`ml-sharp lookAt: depth_focus=${depthFocusCv.toFixed(3)} (q=0.1, min=2.0)`);

  controls.enabled = true;
  controls.update();
  updateDollyZoomBaselineFromCamera();
  requestRender();

  resize();
};

const clearMetadataCamera = () => {
  activeCamera = null;
  camera.matrixAutoUpdate = true;
  controls.enabled = true;
  controls.dampingFactor = defaultControls.dampingFactor;
  controls.rotateSpeed = defaultControls.rotateSpeed;
  controls.zoomSpeed = defaultControls.zoomSpeed;
  controls.panSpeed = defaultControls.panSpeed;
  camera.fov = defaultCamera.fov;
  camera.near = defaultCamera.near;
  camera.far = defaultCamera.far;
  camera.updateProjectionMatrix();
  resize();
};

const updateInfo = ({ file, mesh, loadMs }) => {
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  splatCountEl.textContent = mesh?.packedSplats?.numSplats ?? "-";
  loadTimeEl.textContent = `${loadMs.toFixed(1)} ms`;
};

const removeCurrentMesh = () => {
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh = null;
  }
};

const loadSplatFile = async (file) => {
  if (!file) return;
  const formatHandler = getFormatHandler(file);
  if (!formatHandler) {
    setStatus(`Only ${supportedExtensionsText} 3DGS files are supported`);
    return;
  }

  try {
    // Start loading transition
    viewerEl.classList.add("loading");
    
    setStatus("Reading local file...");
    const start = performance.now();
    const bytes = new Uint8Array(await file.arrayBuffer());

    let cameraMetadata = null;
    try {
      cameraMetadata = await formatHandler.loadMetadata({ file, bytes });
      if (cameraMetadata) {
        const { intrinsics } = cameraMetadata;
        // Set original image aspect ratio for viewer sizing
        originalImageAspect = intrinsics.imageWidth / intrinsics.imageHeight;
        // Update viewer container size immediately
        updateViewerAspectRatio();
        appendLog(
          `${formatHandler.label} camera: fx=${intrinsics.fx.toFixed(1)}, fy=${intrinsics.fy.toFixed(1)}, ` +
            `cx=${intrinsics.cx.toFixed(1)}, cy=${intrinsics.cy.toFixed(1)}, ` +
            `img=${intrinsics.imageWidth}x${intrinsics.imageHeight}`,
        );
      } else {
        // No metadata, reset to default full-size viewer
        originalImageAspect = null;
        updateViewerAspectRatio();
      }
    } catch (error) {
      originalImageAspect = null;
      updateViewerAspectRatio();
      appendLog(`Failed to parse camera metadata, falling back to default view: ${error?.message ?? error}`);
    }

    setStatus(`Parsing ${formatHandler.label} and building splats...`);
    const mesh = await formatHandler.loadData({ file, bytes });

    // Configure pipeline based on color space
    // Linear input (SOG) -> RenderPass (Linear) -> OutputPass (Linear->sRGB)
    // sRGB input (PLY) -> RenderPass (sRGB) -> Screen (sRGB)
    if (formatHandler.colorSpace === "linear") {
      if (!composer.passes.includes(outputPass)) {
        composer.addPass(outputPass);
      }
    } else {
      composer.removePass(outputPass);
    }

    removeCurrentMesh();
    currentMesh = mesh;
    viewerEl.classList.add("has-mesh");
    scene.add(mesh);

    clearMetadataCamera();
    if (cameraMetadata) {
      applyMetadataCamera(mesh, cameraMetadata);
    } else {
      fitViewToMesh(mesh);
    }
    spark.update({ scene });

    // Ensure frames are rendered after loading a mesh.
    // The spark renderer may need multiple frames to fully initialize,
    // so we render several frames in quick succession.
    let warmupFrames = 120; // ~2 seconds at 60fps - testing if this approach works
    const warmup = () => {
      if (warmupFrames > 0) {
        warmupFrames--;
        needsRender = true;
        requestAnimationFrame(warmup);
      }
    };
    warmup();

    const loadMs = performance.now() - start;
    updateInfo({ file, mesh, loadMs });
    saveHomeView();
    
    // End loading transition with slight delay for smooth fade-in
    setTimeout(() => {
      viewerEl.classList.remove("loading");
    }, 100);
    
    setStatus(
      cameraMetadata
        ? "Loaded (using file camera: drag to rotate / scroll to zoom)"
        : "Loaded: drag to rotate / scroll to zoom",
    );
    appendLog(
      `Debug: splats=${mesh.packedSplats.numSplats}, bbox=${boundsEl.textContent}`,
    );
  } catch (error) {
    console.error(error);
    viewerEl.classList.remove("loading");
    clearMetadataCamera();
    setStatus("Load failed, please check the file or console log");
  }
};

// Drag + click handlers
const preventDefaults = (event) => {
  event.preventDefault();
  event.stopPropagation();
};

["dragenter", "dragover"].forEach((eventName) => {
  viewerEl.addEventListener(eventName, (event) => {
    preventDefaults(event);
    viewerEl.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  viewerEl.addEventListener(eventName, (event) => {
    preventDefaults(event);
    if (eventName === "dragleave") {
      viewerEl.classList.remove("dragging");
    }
  });
});

viewerEl.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  viewerEl.classList.remove("dragging");
  loadSplatFile(file);
});

pickBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) {
    loadSplatFile(file);
    fileInput.value = "";
  }
});

const setCameraRangePreset = (size) => {
  const preset = cameraLimitPresets[size];
  if (!preset) return;
  cameraLimitConfig = preset;
  applyCameraMovementLimits(true);
};

const cameraRangeStops = [
  { key: "locked", label: "Locked", value: 0.0 },
  { key: "sm", label: "Sm", value: 0.33 },
  { key: "md", label: "Md", value: 0.66 },
  { key: "lg", label: "Lg", value: 1.0 },
];

if (cameraRangeSliderEl) {
  const updateCameraRangeFromSlider = (value) => {
    let closest = cameraRangeStops[0];
    let minDelta = Math.abs(value - closest.value);
    for (let i = 1; i < cameraRangeStops.length; i += 1) {
      const stop = cameraRangeStops[i];
      const delta = Math.abs(value - stop.value);
      if (delta < minDelta) {
        minDelta = delta;
        closest = stop;
      }
    }

    setCameraRangePreset(closest.key);
    if (cameraRangeLabelEl) {
      cameraRangeLabelEl.textContent = closest.label;
    }
  };

  const initialValue = Number.parseFloat(cameraRangeSliderEl.value);
  updateCameraRangeFromSlider(Number.isFinite(initialValue) ? initialValue : 0.33);

  cameraRangeSliderEl.addEventListener("input", (event) => {
    const val = Number.parseFloat(event.target.value);
    if (!Number.isFinite(val)) return;
    updateCameraRangeFromSlider(val);
  });
}

// Dolly zoom toggle
// FOV slider with dolly zoom support
if (fovSliderEl) {
  fovSliderEl.addEventListener("input", (event) => {
    const newFov = Number(event.target.value);
    if (!Number.isFinite(newFov)) return;
    
    if (fovValueEl) fovValueEl.textContent = `${newFov}°`;

    if (dollyZoomEnabled && dollyZoomBaseDistance && dollyZoomBaseFov) {
      // Dolly zoom: adjust distance to keep subject same apparent size
      // distance ∝ 1/tan(fov/2), so new_dist = base_dist * tan(base_fov/2) / tan(new_fov/2)
      const baseTan = Math.tan(THREE.MathUtils.degToRad(dollyZoomBaseFov / 2));
      const newTan = Math.tan(THREE.MathUtils.degToRad(newFov / 2));
      const newDistance = dollyZoomBaseDistance * (baseTan / newTan);
      
      // Move camera along the direction from target to camera
      const direction = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
      camera.position.copy(controls.target).addScaledVector(direction, newDistance);
    }

    camera.fov = newFov;
    camera.updateProjectionMatrix();

    const fovScale = THREE.MathUtils.clamp(camera.fov / defaultCamera.fov, 0.05, 2.0);
    controls.rotateSpeed = Math.max(0.02, defaultControls.rotateSpeed * fovScale * 0.45);
    controls.zoomSpeed = Math.max(0.05, defaultControls.zoomSpeed * fovScale * 0.8);
    controls.panSpeed = Math.max(0.05, defaultControls.panSpeed * fovScale * 0.8);
    
    controls.update();
    requestRender();
  });
}

// Background image controls
if (bgImageToggleEl) {
  bgImageToggleEl.addEventListener("change", (event) => {
    setBackgroundImageEnabled(event.target.checked);
    if (bgImageControlsEl) {
      bgImageControlsEl.classList.toggle("visible", event.target.checked);
    }
  });
}

if (bgImageBtn && bgImageInput) {
  bgImageBtn.addEventListener("click", () => bgImageInput.click());
  bgImageInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      // Revoke previous URL to prevent memory leaks
      if (bgImageUrl) {
        URL.revokeObjectURL(bgImageUrl);
      }
      bgImageUrl = URL.createObjectURL(file);
      if (bgImageEnabled) {
        updateBackgroundImage(bgImageUrl, parseInt(bgBlurSlider?.value || 20));
        scene.background = null;
        renderer.setClearColor(0x000000, 0);
      }
      appendLog(`Background image set: ${file.name}`);
    }
    bgImageInput.value = "";
  });
}

if (bgBlurSlider && bgBlurValue) {
  bgBlurSlider.addEventListener("input", (event) => {
    const blur = parseInt(event.target.value);
    bgBlurValue.textContent = `${blur}px`;
    if (bgImageEnabled && bgImageUrl) {
      bgImageContainer.style.filter = `blur(${blur}px)`;
    }
  });
}
