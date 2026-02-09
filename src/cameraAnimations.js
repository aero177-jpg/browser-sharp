/**
 * Camera animations: smooth-reset, anchor transitions, and standard slide transitions.
 *
 * Configuration & presets live in ./slideConfig.js
 * Continuous slideshow animations live in ./continuousAnimations.js
 *
 * This file re-exports the public API from both so existing import sites
 * can keep importing from "./cameraAnimations.js" with no changes.
 */
import { camera, controls, requestRender, THREE, bgImageContainer } from "./viewer.js";
import { cancelLoadZoomAnimation } from "./customAnimations.js";
import { useStore } from "./store.js";
import gsap from "gsap";

// Re-export config & presets (public)
export { SLIDESHOW_CONFIG, SLIDE_PRESETS } from "./slideConfig.js";

// Re-export continuous cancel helpers (public)
export {
  cancelContinuousZoomAnimation,
  cancelContinuousOrbitAnimation,
  cancelContinuousVerticalOrbitAnimation,
} from "./continuousAnimations.js";

// Internal imports from split modules
import {
  easingFunctions,
  clamp01,
  isContinuousMode,
  SLIDESHOW_CONFIG,
  DEFAULT_CONFIG,
  resolveSlideOutOptions,
  resolveSlideInOptions,
  computeSpeedScale,
  createSlideInSpeedProfile,
  createSlideOutSpeedProfile,
} from "./slideConfig.js";

import {
  cancelContinuousZoomAnimation,
  cancelContinuousOrbitAnimation,
  cancelContinuousVerticalOrbitAnimation,
  continuousZoomSlideIn,
  continuousOrbitSlideIn,
  continuousVerticalOrbitSlideIn,
} from "./continuousAnimations.js";

// ============================================================================
// Internal state
// ============================================================================

let resetAnimationState = null;
let anchorAnimationState = null;
let currentGsapTween = null;
let slideAnimationState = null;

const easeInOutCubic = easingFunctions['ease-in-out'];
const getStoreState = () => useStore.getState();

// ============================================================================
// Smooth reset animation
// ============================================================================

export const startSmoothResetAnimation = (targetState, { duration = 800, onComplete } = {}) => {
  if (!camera || !controls || !targetState) return;

  cancelLoadZoomAnimation();
  cancelResetAnimation();

  const startState = {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
    zoom: camera.zoom,
    target: controls.target.clone(),
  };

  const animate = (timestamp) => {
    if (!resetAnimationState) return;

    if (resetAnimationState.startTime == null) {
      resetAnimationState.startTime = timestamp;
    }

    const elapsed = timestamp - resetAnimationState.startTime;
    const t = Math.min(elapsed / duration, 1);
    const eased = easeInOutCubic(t);

    camera.position.lerpVectors(startState.position, targetState.position, eased);
    camera.quaternion.slerpQuaternions(startState.quaternion, targetState.quaternion, eased);
    camera.fov = THREE.MathUtils.lerp(startState.fov, targetState.fov, eased);
    camera.near = THREE.MathUtils.lerp(startState.near, targetState.near, eased);
    camera.far = THREE.MathUtils.lerp(startState.far, targetState.far, eased);
    camera.zoom = THREE.MathUtils.lerp(startState.zoom, targetState.zoom, eased);
    camera.updateProjectionMatrix();

    controls.target.lerpVectors(startState.target, targetState.target, eased);
    controls.update();
    requestRender();

    if (t < 1) {
      resetAnimationState.frameId = requestAnimationFrame(animate);
    } else {
      resetAnimationState = null;
      if (onComplete) onComplete();
    }
  };

  resetAnimationState = {
    frameId: requestAnimationFrame(animate),
    startTime: null,
  };
};

export const cancelResetAnimation = () => {
  if (resetAnimationState?.frameId) {
    cancelAnimationFrame(resetAnimationState.frameId);
  }
  resetAnimationState = null;
};

// ============================================================================
// Anchor transition
// ============================================================================

export const startAnchorTransition = (nextTarget, { duration = 650, onComplete } = {}) => {
  if (!camera || !controls || !nextTarget) return;

  const currentTarget = controls.target.clone();
  if (currentTarget.distanceTo(nextTarget) < 1e-5) {
    controls.target.copy(nextTarget);
    controls.update();
    requestRender();
    if (typeof onComplete === "function") onComplete();
    return;
  }

  cancelAnchorTransition();
  cancelLoadZoomAnimation();

  const animate = (timestamp) => {
    if (!anchorAnimationState) return;
    if (anchorAnimationState.startTime == null) {
      anchorAnimationState.startTime = timestamp;
    }

    const elapsed = timestamp - anchorAnimationState.startTime;
    const t = Math.min(elapsed / anchorAnimationState.duration, 1);
    const eased = easeInOutCubic(t);

    const currentAnchor = new THREE.Vector3().lerpVectors(
      anchorAnimationState.startTarget,
      anchorAnimationState.endTarget,
      eased,
    );

    controls.target.copy(currentAnchor);
    controls.update();
    requestRender();

    if (t < 1) {
      anchorAnimationState.frameId = requestAnimationFrame(animate);
    } else {
      anchorAnimationState = null;
      if (onComplete) onComplete();
    }
  };

  anchorAnimationState = {
    frameId: requestAnimationFrame(animate),
    startTime: null,
    duration,
    startTarget: currentTarget,
    endTarget: nextTarget.clone(),
  };
};

export const cancelAnchorTransition = () => {
  if (anchorAnimationState?.frameId) {
    cancelAnimationFrame(anchorAnimationState.frameId);
  }
  anchorAnimationState = null;
};

// ============================================================================
// Cancel slide animation (shared by slide-in & slide-out)
// ============================================================================

export const cancelSlideAnimation = () => {
  if (currentGsapTween) {
    currentGsapTween.kill();
    currentGsapTween = null;
  }

  if (slideAnimationState?.frameId) {
    cancelAnimationFrame(slideAnimationState.frameId);
  }
  if (slideAnimationState?.fadeTimeoutId) {
    clearTimeout(slideAnimationState.fadeTimeoutId);
  }
  if (slideAnimationState?.resolveTimeoutId) {
    clearTimeout(slideAnimationState.resolveTimeoutId);
  }
  slideAnimationState = null;

  const viewerEl = document.getElementById('viewer');
  if (viewerEl) {
    viewerEl.classList.remove('slide-out', 'slide-in');
  }
};

// ============================================================================
// Slide geometry
// ============================================================================

/**
 * Calculate slide geometry based on mode and direction.
 * Returns start/end positions for camera and target, plus orbit params.
 */
const calculateSlideGeometry = (mode, direction, amount, isSlideOut) => {
  const currentPosition = camera.position.clone();
  const currentTarget = controls.target.clone();
  const distance = currentPosition.distanceTo(currentTarget);

  const forward = new THREE.Vector3().subVectors(currentTarget, currentPosition).normalize();
  const up = camera.up.clone().normalize();
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();

  let offsetPosition, offsetTarget, orbitAxis, orbitAngle;

  switch (mode) {
    case 'zoom': {
      const zoomAmount = distance * (isSlideOut ? 0.3 : 0.25);
      let zoomDir = isSlideOut ? 1 : -1;
      if (direction === 'prev') zoomDir *= -1;
      const zoomOffset = forward.clone().multiplyScalar(zoomAmount * zoomDir);
      offsetPosition = currentPosition.clone().add(zoomOffset);
      offsetTarget = currentTarget.clone();
      orbitAxis = up;
      orbitAngle = 0;
      break;
    }

    case 'vertical': {
      const vPanSign = isSlideOut
        ? (direction === 'next' ? -1 : 1)
        : (direction === 'next' ? 1 : -1);
      const vPanAmount = distance * amount * vPanSign;
      const vPanOffset = up.clone().multiplyScalar(vPanAmount);
      offsetPosition = currentPosition.clone().add(vPanOffset);
      offsetTarget = currentTarget.clone().add(vPanOffset);
      orbitAxis = right;
      orbitAngle = (Math.PI / 180) * 8 * (direction === 'next' ? (isSlideOut ? 1 : -1) : (isSlideOut ? -1 : 1));
      break;
    }

    case 'fade':
    case 'continuous-zoom':
    case 'continuous-orbit':
    case 'continuous-orbit-vertical':
      offsetPosition = currentPosition.clone();
      offsetTarget = currentTarget.clone();
      orbitAxis = up;
      orbitAngle = 0;
      break;

    default: { // horizontal
      const hPanSign = isSlideOut
        ? (direction === 'next' ? 1 : -1)
        : (direction === 'next' ? -1 : 1);
      const hPanAmount = distance * amount * hPanSign;
      const hPanOffset = right.clone().multiplyScalar(hPanAmount);
      offsetPosition = currentPosition.clone().add(hPanOffset);
      offsetTarget = currentTarget.clone().add(hPanOffset);
      orbitAxis = up;
      orbitAngle = (Math.PI / 180) * 8 * (direction === 'next' ? (isSlideOut ? 1 : -1) : (isSlideOut ? -1 : 1));
      break;
    }
  }

  if (isSlideOut) {
    return {
      startPosition: currentPosition, endPosition: offsetPosition,
      startTarget: currentTarget, endTarget: offsetTarget,
      orbitAxis, orbitAngle,
    };
  } else {
    return {
      startPosition: offsetPosition, endPosition: currentPosition,
      startTarget: offsetTarget, endTarget: currentTarget,
      orbitAxis, startOrbitAngle: orbitAngle,
    };
  }
};

// ============================================================================
// Slide-out animation
// ============================================================================

/**
 * Performs a slide-out animation using GSAP.
 * @param {'next'|'prev'} direction
 * @param {Object} options - { mode, preset, duration, amount, fadeDelay }
 * @returns {Promise}
 */
export const slideOutAnimation = (direction, options = {}) => {
  return new Promise((resolve) => {
    const mode = options.mode ?? 'horizontal';
    const { duration, amount, fadeDelay } = resolveSlideOutOptions(mode, options);
    const { slideshowMode, slideshowUseCustom } = getStoreState();
    const useCustom = slideshowMode && slideshowUseCustom;
    const config = useCustom ? SLIDESHOW_CONFIG.slideOut : DEFAULT_CONFIG.slideOut;

    const baseDuration = useCustom ? config.totalDuration : duration / 1000;
    const speedMultiplier = useCustom ? (config.speedMultiplier || 1) : 1;
    const durationSec = baseDuration / speedMultiplier;
    const actualFadeDelay = useCustom ? config.fadeDelay : fadeDelay;

    cancelSlideAnimation();

    const viewerEl = document.getElementById('viewer');
    if (viewerEl) viewerEl.classList.remove('slide-in');

    if (!camera || !controls) { resolve(); return; }

    // Continuous modes: fade-only out (no camera movement)
    if (isContinuousMode(mode)) {
      const fadeTimeoutId = setTimeout(() => {
        if (viewerEl) viewerEl.classList.add('slide-out');
        if (bgImageContainer) bgImageContainer.classList.remove('active');
      }, durationSec * actualFadeDelay * 1000);

      const resolveTimeoutId = setTimeout(() => {
        slideAnimationState = null;
        resolve();
      }, durationSec * 1000);

      slideAnimationState = { fadeTimeoutId, resolveTimeoutId };
      return;
    }

    const geometryMode = mode === 'continuous-zoom' ? 'fade' : mode;
    const geometry = calculateSlideGeometry(geometryMode, direction, amount, true);
    const { startPosition, endPosition, startTarget, endTarget, orbitAxis, orbitAngle } = geometry;

    const proxy = { t: 0 };
    let progress = 0;
    let lastTime = 0;

    const speedAt = useCustom ? createSlideOutSpeedProfile(config, durationSec) : null;
    const speedScale = useCustom ? computeSpeedScale(speedAt, durationSec) : 1;

    const fadeTimeoutId = setTimeout(() => {
      if (viewerEl) viewerEl.classList.add('slide-out');
      if (bgImageContainer) bgImageContainer.classList.remove('active');
    }, durationSec * actualFadeDelay * 1000);

    slideAnimationState = { fadeTimeoutId };

    currentGsapTween = gsap.to(proxy, {
      t: durationSec,
      duration: durationSec,
      ease: "none",
      onUpdate: () => {
        const t = proxy.t;

        if (useCustom) {
          const dt = t - lastTime;
          lastTime = t;
          progress += speedAt(t) * speedScale * dt;
          progress = clamp01(progress);
        } else {
          progress = gsap.parseEase(config.ease || "power2.in")(clamp01(t / durationSec));
        }

        camera.position.lerpVectors(startPosition, endPosition, progress);
        controls.target.lerpVectors(startTarget, endTarget, progress);

        if (orbitAngle !== 0) {
          const currentOrbitAngle = orbitAngle * progress;
          const orbitOffset = new THREE.Vector3().subVectors(camera.position, controls.target);
          orbitOffset.applyAxisAngle(orbitAxis, currentOrbitAngle);
          camera.position.copy(controls.target).add(orbitOffset);
        }

        controls.update();
        requestRender();
      },
      onComplete: () => {
        currentGsapTween = null;
        slideAnimationState = null;
        resolve();
      },
    });
  });
};

// ============================================================================
// Slide-in animation
// ============================================================================

/**
 * Performs a slide-in animation.
 * For continuous modes, delegates to continuousAnimations.js.
 * @param {'next'|'prev'} direction
 * @param {Object} options - { mode, preset, duration, amount }
 * @returns {Promise}
 */
export const slideInAnimation = (direction, options = {}) => {
  return new Promise((resolve) => {
    const mode = options.mode ?? 'horizontal';
    const { duration, amount } = resolveSlideInOptions(mode, options);
    const { slideshowMode, slideshowUseCustom } = getStoreState();
    const useCustom = slideshowMode && slideshowUseCustom;
    const config = useCustom ? SLIDESHOW_CONFIG.slideIn : DEFAULT_CONFIG.slideIn;

    const baseDuration = useCustom ? config.totalDuration : duration / 1000;
    const speedMultiplier = useCustom ? (config.speedMultiplier || 1) : 1;
    const durationSec = baseDuration / speedMultiplier;

    cancelSlideAnimation();

    // Delegate continuous modes to their own module
    if (mode === 'continuous-zoom') {
      continuousZoomSlideIn(duration, amount).then(resolve);
      return;
    }
    if (mode === 'continuous-orbit') {
      continuousOrbitSlideIn(duration, amount).then(resolve);
      return;
    }
    if (mode === 'continuous-orbit-vertical') {
      continuousVerticalOrbitSlideIn(duration, amount).then(resolve);
      return;
    }

    // Standard slide-in (horizontal / vertical / zoom / fade)
    const viewerEl = document.getElementById('viewer');
    if (viewerEl) {
      viewerEl.classList.remove('slide-out');
      void viewerEl.offsetHeight;
      viewerEl.classList.add('slide-in');
    }

    if (!camera || !controls) { resolve(); return; }

    const geometry = calculateSlideGeometry(mode, direction, amount, false);
    const { startPosition, endPosition, startTarget, endTarget, orbitAxis, startOrbitAngle } = geometry;

    camera.position.copy(startPosition);
    controls.target.copy(startTarget);
    controls.update();
    requestRender();

    const proxy = { t: 0 };
    let progress = 0;
    let lastTime = 0;

    const speedAt = useCustom ? createSlideInSpeedProfile(config, durationSec) : null;
    const speedScale = useCustom ? computeSpeedScale(speedAt, durationSec) : 1;

    currentGsapTween = gsap.to(proxy, {
      t: durationSec,
      duration: durationSec,
      ease: "none",
      onUpdate: () => {
        const t = proxy.t;

        if (useCustom) {
          const dt = t - lastTime;
          lastTime = t;
          progress += speedAt(t) * speedScale * dt;
          progress = clamp01(progress);
        } else {
          progress = gsap.parseEase(config.ease || "power2.out")(clamp01(t / durationSec));
        }

        camera.position.lerpVectors(startPosition, endPosition, progress);
        controls.target.lerpVectors(startTarget, endTarget, progress);

        if (startOrbitAngle !== 0) {
          const currentOrbitAngle = startOrbitAngle * (1 - progress);
          const orbitOffset = new THREE.Vector3().subVectors(camera.position, controls.target);
          orbitOffset.applyAxisAngle(orbitAxis, currentOrbitAngle);
          camera.position.copy(controls.target).add(orbitOffset);
        }

        controls.update();
        requestRender();
      },
      onComplete: () => {
        currentGsapTween = null;
        slideAnimationState = null;
        if (viewerEl) viewerEl.classList.remove('slide-out', 'slide-in');
        resolve();
      },
    });
  });
};
