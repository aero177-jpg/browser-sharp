import { camera, controls, requestRender, THREE, bgImageContainer } from "./viewer.js";
import { cancelLoadZoomAnimation } from "./customAnimations.js";
import { useStore } from "./store.js";
import gsap from "gsap";

let animationState = null;
let resetAnimationState = null;
let anchorAnimationState = null;
let currentGsapTween = null; // Track active GSAP tween for cancellation
let continuousZoomTween = null; // Track active continuous zoom tween
let continuousOrbitTween = null; // Track active continuous orbit tween
let continuousOrbitState = null; // Track orbit constraint overrides
let continuousVerticalOrbitTween = null; // Track active continuous vertical orbit tween
let continuousVerticalOrbitState = null; // Track vertical orbit constraint overrides

// Easing functions (kept for non-slideshow animations)
const easingFunctions = {
  'linear': (t) => t,
  'ease-in': (t) => t * t * t,
  'ease-out': (t) => 1 - Math.pow(1 - t, 3),
  'ease-in-out': (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
};

// ============================================================================
// SLIDESHOW TIMING CONFIGURATION (GSAP)
// ============================================================================
// These values control the "feel" of slideshow transitions.
// Adjust durations and easing to taste. GSAP supports:
//   - Standard eases: "power1", "power2", "power3", "power4" with .in, .out, .inOut
//   - Custom bezier: "cubic-bezier(0.17, 0.67, 0.83, 0.67)" via CustomEase plugin
//   - See: https://gsap.com/docs/v3/Eases/
//
// Current setup creates continuous motion feel:
//   - Slide-in: rushes in fast, decelerates to slow drift at end
//   - Slide-out: starts with slow drift, accelerates out fast
//   - Handoff between animations feels like one continuous motion
// ============================================================================

export const SLIDESHOW_CONFIG = {
  slideIn: {
    totalDuration: 5,
    speedMultiplier: 1.0,   // NEW: >1 = faster (shorter), <1 = slower (longer)
    decelTimeRatio: 0.45,
    fastSpeed: 1.0,
    slowSpeed: 0.25,
    decelEase: "power3.out",
    slowEase: "none",
  },
  slideOut: {
    totalDuration: 3,
    speedMultiplier: 1.0,   // NEW: >1 = faster (shorter), <1 = slower (longer)
    slowTimeRatio: 0.55,
    fastSpeed: 1.0,
    slowSpeed: 0.25,
    accelEase: "power3.in",
    fadeDelay: 0.7,
  },
};

// Non-slideshow defaults (original behavior)
const DEFAULT_CONFIG = {
  slideIn: {
    duration: 1.2,
    ease: "power2.out",
  },
  slideOut: {
    duration: 1.2,
    ease: "power2.in",
    fadeDelay: 0.7,
  },
};

// Continuous zoom configuration
const CONTINUOUS_ZOOM_DURATION = 5; // seconds
const CONTINUOUS_ZOOM_START_RATIO_BY_SIZE = {
  small: 0.04,  // subtle pull-back
  medium: 0.08,
  large: 0.12, // reduced pull-back vs previous large
};
const CONTINUOUS_ZOOM_END_RATIO_BY_SIZE = {
  small: 0.22,  // modest move past home
  medium: 0.30,
  large: 0.36, // allow further zoom-in on large
};

// Continuous orbit configuration
const CONTINUOUS_ORBIT_DURATION = 10; // seconds
const CONTINUOUS_ORBIT_ANGLE_DEG = 12; // total orbit angle on either side (large)
const CONTINUOUS_ORBIT_PAN_SCALE = 0.4; // scales pan amount vs slide amount (large)

// Continuous vertical orbit configuration
const CONTINUOUS_VERTICAL_ORBIT_DURATION = 10; // seconds
const CONTINUOUS_VERTICAL_ORBIT_ANGLE_DEG = 12; // total orbit angle on either side (large)
const CONTINUOUS_VERTICAL_ORBIT_PAN_SCALE = 0.4; // scales pan amount vs slide amount (large)

const CONTINUOUS_SIZE_SCALE = {
  small: 0.45,
  medium: 0.65,
  large: 0.85,
};

const getStoreState = () => useStore.getState();

const getContinuousSizeScale = () => {
  const { continuousMotionSize } = getStoreState();
  return CONTINUOUS_SIZE_SCALE[continuousMotionSize] ?? CONTINUOUS_SIZE_SCALE.large;
};

const getContinuousZoomRatios = () => {
  const { continuousMotionSize } = getStoreState();
  const sizeKey = continuousMotionSize ?? 'large';
  return {
    start: CONTINUOUS_ZOOM_START_RATIO_BY_SIZE[sizeKey] ?? CONTINUOUS_ZOOM_START_RATIO_BY_SIZE.large,
    end: CONTINUOUS_ZOOM_END_RATIO_BY_SIZE[sizeKey] ?? CONTINUOUS_ZOOM_END_RATIO_BY_SIZE.large,
  };
};

const getDurationScale = (durationSec, baseDurationSec) => {
  if (!Number.isFinite(durationSec) || !Number.isFinite(baseDurationSec) || baseDurationSec <= 0) {
    return 1;
  }
  return durationSec / baseDurationSec;
};

const getContinuousDurationSeconds = (mode, baseDurationSec) => {
  const { continuousMotionDuration } = getStoreState();
  const duration = Number.isFinite(continuousMotionDuration) ? continuousMotionDuration : baseDurationSec;
  return duration > 0 ? duration : baseDurationSec;
};

const isContinuousMode = (mode) => (
  mode === 'continuous-zoom' ||
  mode === 'continuous-orbit' ||
  mode === 'continuous-orbit-vertical'
);

const beginContinuousSlideIn = (durationMs) => {
  const viewerEl = document.getElementById('viewer');
  if (viewerEl) {
    viewerEl.classList.remove('slide-out');
    void viewerEl.offsetHeight;
    viewerEl.classList.add('slide-in');
  }

  if (!camera || !controls) {
    return { viewerEl, fadeDurationSec: null, canAnimate: false };
  }

  const fadeDurationSec = Math.max(0.1, durationMs / 1000);
  return { viewerEl, fadeDurationSec, canAnimate: true };
};

const scheduleSlideInCleanup = (viewerEl, fadeDurationSec, resolve) => {
  if (!viewerEl || !Number.isFinite(fadeDurationSec)) {
    resolve();
    return;
  }

  setTimeout(() => {
    viewerEl.classList.remove('slide-out', 'slide-in');
    resolve();
  }, fadeDurationSec * 1000);
};

const applyOrbitLimitOverride = (stateRef) => {
  if (!stateRef) return;
  stateRef.savedLimits = {
    minAzimuthAngle: controls.minAzimuthAngle,
    maxAzimuthAngle: controls.maxAzimuthAngle,
    minPolarAngle: controls.minPolarAngle,
    maxPolarAngle: controls.maxPolarAngle,
  };
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI;
};

const restoreOrbitLimitOverride = (stateRef) => {
  if (!stateRef?.savedLimits) return;
  controls.minAzimuthAngle = stateRef.savedLimits.minAzimuthAngle;
  controls.maxAzimuthAngle = stateRef.savedLimits.maxAzimuthAngle;
  controls.minPolarAngle = stateRef.savedLimits.minPolarAngle;
  controls.maxPolarAngle = stateRef.savedLimits.maxPolarAngle;
  controls.update();
};

// Smooth reset animation
const easeInOutCubic = easingFunctions['ease-in-out'];

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
      eased
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

// Slide transition state
let slideAnimationState = null;

export const cancelSlideAnimation = () => {
  // Kill GSAP tween if active
  if (currentGsapTween) {
    currentGsapTween.kill();
    currentGsapTween = null;
  }
  
  // Legacy cleanup for non-GSAP state
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

export const cancelContinuousZoomAnimation = () => {
  if (continuousZoomTween) {
    continuousZoomTween.kill();
    continuousZoomTween = null;
  }
};

export const cancelContinuousOrbitAnimation = () => {
  if (continuousOrbitTween) {
    continuousOrbitTween.kill();
    continuousOrbitTween = null;
  }
  if (continuousOrbitState) {
    restoreOrbitLimitOverride(continuousOrbitState);
    continuousOrbitState = null;
  }
};

export const cancelContinuousVerticalOrbitAnimation = () => {
  if (continuousVerticalOrbitTween) {
    continuousVerticalOrbitTween.kill();
    continuousVerticalOrbitTween = null;
  }
  if (continuousVerticalOrbitState) {
    restoreOrbitLimitOverride(continuousVerticalOrbitState);
    continuousVerticalOrbitState = null;
  }
};

export const cancelResetAnimation = () => {
  if (resetAnimationState?.frameId) {
    cancelAnimationFrame(resetAnimationState.frameId);
  }
  resetAnimationState = null;
};

/**
 * Calculate slide geometry based on mode and direction.
 * Returns start/end positions for camera and target, plus orbit params.
 * This is separated from timing so GSAP can handle the "when" while this handles the "where".
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
    case 'zoom':
      // Zoom: move along forward axis
      const zoomAmount = distance * (isSlideOut ? 0.3 : 0.25);
      let zoomDir = isSlideOut ? 1 : -1;
      if (direction === 'prev') {
        zoomDir *= -1;
      }
      const zoomOffset = forward.clone().multiplyScalar(zoomAmount * zoomDir);
      offsetPosition = currentPosition.clone().add(zoomOffset);
      offsetTarget = currentTarget.clone();
      orbitAxis = up;
      orbitAngle = 0;
      break;

    case 'continuous-zoom':
      // Continuous zoom uses fade-only slide-out and a custom slide-in path
      offsetPosition = currentPosition.clone();
      offsetTarget = currentTarget.clone();
      orbitAxis = up;
      orbitAngle = 0;
      break;

    case 'continuous-orbit':
      // Continuous orbit uses fade-only slide-out and a custom slide-in path
      offsetPosition = currentPosition.clone();
      offsetTarget = currentTarget.clone();
      orbitAxis = up;
      orbitAngle = 0;
      break;

    case 'continuous-orbit-vertical':
      // Continuous vertical orbit uses fade-only slide-out and a custom slide-in path
      offsetPosition = currentPosition.clone();
      offsetTarget = currentTarget.clone();
      orbitAxis = up;
      orbitAngle = 0;
      break;

    case 'fade':
      // Fade: no camera movement
      offsetPosition = currentPosition.clone();
      offsetTarget = currentTarget.clone();
      orbitAxis = up;
      orbitAngle = 0;
      break;

    case 'vertical':
      // Vertical: pan up/down
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

    default: // horizontal
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

  if (isSlideOut) {
    return {
      startPosition: currentPosition,
      endPosition: offsetPosition,
      startTarget: currentTarget,
      endTarget: offsetTarget,
      orbitAxis,
      orbitAngle,
    };
  } else {
    return {
      startPosition: offsetPosition,
      endPosition: currentPosition,
      startTarget: offsetTarget,
      endTarget: currentTarget,
      orbitAxis,
      startOrbitAngle: orbitAngle,
    };
  }
};

/**
 * Performs a slide-out animation using GSAP.
 * @param {'next'|'prev'} direction - Navigation direction
 * @param {Object} options - Animation options
 * @returns {Promise} Resolves when animation completes
 */
export const slideOutAnimation = (direction, { duration = 1200, amount = 0.45, fadeDelay = 0.7, mode = 'horizontal' } = {}) => {
  return new Promise((resolve) => {
    const { slideshowMode, slideshowUseCustom } = getStoreState();
    const useCustom = slideshowMode && slideshowUseCustom;
    const config = useCustom ? SLIDESHOW_CONFIG.slideOut : DEFAULT_CONFIG.slideOut;

    const baseDuration = useCustom ? config.totalDuration : duration / 1000;
    const speedMultiplier = useCustom ? (config.speedMultiplier || 1) : 1;
    const durationSec = baseDuration / speedMultiplier;
    const actualFadeDelay = useCustom ? config.fadeDelay : fadeDelay;

    cancelSlideAnimation();

    const viewerEl = document.getElementById('viewer');
    if (viewerEl) {
      viewerEl.classList.remove('slide-in');
    }

    if (!camera || !controls) {
      resolve();
      return;
    }

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

    // console.log(`[SlideOut] START - duration: ${durationSec}s, mode: ${mode}`);

    const geometryMode = mode === 'continuous-zoom' ? 'fade' : mode;
    const geometry = calculateSlideGeometry(geometryMode, direction, amount, true);
    const { startPosition, endPosition, startTarget, endTarget, orbitAxis, orbitAngle } = geometry;

    const proxy = { t: 0 };
    let progress = 0;
    let lastTime = 0;

    const speedAt = useCustom
      ? createSlideOutSpeedProfile(config, durationSec)
      : null;

    const speedScale = useCustom
      ? computeSpeedScale(speedAt, durationSec)
      : 1;

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
        let t = proxy.t;

        if (useCustom) {
          const dt = t - lastTime;
          lastTime = t;
          progress += speedAt(t) * speedScale * dt;
          progress = clamp01(progress);
        } else {
          // legacy non-slideshow behavior
          progress = clamp01(t / durationSec);
          progress = gsap.parseEase(config.ease || "power2.in")(progress);
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
        // console.log(`[SlideOut] END`);
        currentGsapTween = null;
        slideAnimationState = null;
        resolve();
      },
    });
  });
};

export const slideInAnimation = (direction, { duration = 1200, amount = 0.45, mode = 'horizontal' } = {}) => {
  return new Promise((resolve) => {
    const { slideshowMode, slideshowUseCustom } = getStoreState();
    const useCustom = slideshowMode && slideshowUseCustom;
    const config = useCustom ? SLIDESHOW_CONFIG.slideIn : DEFAULT_CONFIG.slideIn;

    const baseDuration = useCustom ? config.totalDuration : duration / 1000;
    const speedMultiplier = useCustom ? (config.speedMultiplier || 1) : 1;
    const durationSec = baseDuration / speedMultiplier;

    cancelSlideAnimation();

    if (mode === 'continuous-zoom') {
      cancelContinuousZoomAnimation();
      const { viewerEl, fadeDurationSec, canAnimate } = beginContinuousSlideIn(duration);
      if (!canAnimate) {
        resolve();
        return;
      }

      const currentPosition = camera.position.clone();
      const currentTarget = controls.target.clone();
      const distance = currentPosition.distanceTo(currentTarget);
      const forward = new THREE.Vector3().subVectors(currentTarget, currentPosition).normalize();

      const durationSec = getContinuousDurationSeconds(mode, CONTINUOUS_ZOOM_DURATION);
      const durationScale = getDurationScale(durationSec, CONTINUOUS_ZOOM_DURATION);
      const { start: startRatio, end: endRatio } = getContinuousZoomRatios();

      const startOffset = forward.clone().multiplyScalar(-distance * startRatio);
      const endOffset = forward.clone().multiplyScalar(distance * endRatio);
      const startPosition = currentPosition.clone().add(startOffset);
      const endPosition = currentPosition.clone().add(endOffset);

      camera.position.copy(startPosition);
      controls.update();
      requestRender();

      continuousZoomTween = gsap.to(camera.position, {
        x: endPosition.x,
        y: endPosition.y,
        z: endPosition.z,
        duration: durationSec,
        ease: "none",
        onUpdate: () => {
          controls.update();
          requestRender();
        },
        onComplete: () => {
          continuousZoomTween = null;
        },
      });

      scheduleSlideInCleanup(viewerEl, fadeDurationSec, resolve);

      return;
    }

    if (mode === 'continuous-orbit') {
      cancelContinuousOrbitAnimation();
      const { viewerEl, fadeDurationSec, canAnimate } = beginContinuousSlideIn(duration);
      if (!canAnimate) {
        resolve();
        return;
      }

      const currentPosition = camera.position.clone();
      const currentTarget = controls.target.clone();
      const distance = currentPosition.distanceTo(currentTarget);
      const up = camera.up.clone().normalize();
      const forward = new THREE.Vector3().subVectors(currentTarget, currentPosition).normalize();
      const right = new THREE.Vector3().crossVectors(forward, up).normalize();

      const durationSec = getContinuousDurationSeconds(mode, CONTINUOUS_ORBIT_DURATION);
      const sizeScale = getContinuousSizeScale();
      const motionScale = sizeScale;

      const orbitAngle = (Math.PI / 180) * CONTINUOUS_ORBIT_ANGLE_DEG * motionScale;
      const panAmount = distance * amount * CONTINUOUS_ORBIT_PAN_SCALE * motionScale;

      const startTarget = currentTarget.clone().add(right.clone().multiplyScalar(-panAmount));
      const endTarget = currentTarget.clone().add(right.clone().multiplyScalar(panAmount));

      const orbitOffset = new THREE.Vector3().subVectors(currentPosition, currentTarget);
      const startOrbitOffset = orbitOffset.clone().applyAxisAngle(up, -orbitAngle);
      const endOrbitOffset = orbitOffset.clone().applyAxisAngle(up, orbitAngle);
      const startPosition = startTarget.clone().add(startOrbitOffset);
      const endPosition = endTarget.clone().add(endOrbitOffset);

      continuousOrbitState = {};
      applyOrbitLimitOverride(continuousOrbitState);

      camera.position.copy(startPosition);
      controls.target.copy(startTarget);
      controls.update();
      requestRender();

      const proxy = { t: 0 };

      continuousOrbitTween = gsap.to(proxy, {
        t: 1,
        duration: durationSec,
        ease: "none",
        onUpdate: () => {
          camera.position.lerpVectors(startPosition, endPosition, proxy.t);
          controls.target.lerpVectors(startTarget, endTarget, proxy.t);
          controls.update();
          requestRender();
        },
        onComplete: () => {
          continuousOrbitTween = null;
          if (continuousOrbitState) {
            restoreOrbitLimitOverride(continuousOrbitState);
            continuousOrbitState = null;
          }
        },
      });

      scheduleSlideInCleanup(viewerEl, fadeDurationSec, resolve);

      return;
    }

    if (mode === 'continuous-orbit-vertical') {
      cancelContinuousVerticalOrbitAnimation();
      const { viewerEl, fadeDurationSec, canAnimate } = beginContinuousSlideIn(duration);
      if (!canAnimate) {
        resolve();
        return;
      }

      const currentPosition = camera.position.clone();
      const currentTarget = controls.target.clone();
      const distance = currentPosition.distanceTo(currentTarget);
      const up = camera.up.clone().normalize();
      const forward = new THREE.Vector3().subVectors(currentTarget, currentPosition).normalize();
      const right = new THREE.Vector3().crossVectors(forward, up).normalize();

      const durationSec = getContinuousDurationSeconds(mode, CONTINUOUS_VERTICAL_ORBIT_DURATION);
      const sizeScale = getContinuousSizeScale();
      const motionScale = sizeScale;

      const orbitAngle = (Math.PI / 180) * CONTINUOUS_VERTICAL_ORBIT_ANGLE_DEG * motionScale;
      const panAmount = distance * amount * CONTINUOUS_VERTICAL_ORBIT_PAN_SCALE * motionScale;

      const startTarget = currentTarget.clone().add(up.clone().multiplyScalar(panAmount));
      const endTarget = currentTarget.clone().add(up.clone().multiplyScalar(-panAmount));

      const orbitOffset = new THREE.Vector3().subVectors(currentPosition, currentTarget);
      const startOrbitOffset = orbitOffset.clone().applyAxisAngle(right, -orbitAngle);
      const endOrbitOffset = orbitOffset.clone().applyAxisAngle(right, orbitAngle);
      const startPosition = startTarget.clone().add(startOrbitOffset);

      continuousVerticalOrbitState = {};
      applyOrbitLimitOverride(continuousVerticalOrbitState);

      camera.position.copy(startPosition);
      controls.target.copy(startTarget);
      controls.update();
      requestRender();

      const proxy = { t: 0 };

      continuousVerticalOrbitTween = gsap.to(proxy, {
        t: 1,
        duration: durationSec,
        ease: "none",
        onUpdate: () => {
          const currentTargetPos = startTarget.clone().lerp(endTarget, proxy.t);
          const currentAngle = gsap.utils.interpolate(-orbitAngle, orbitAngle, proxy.t);
          const currentOffset = orbitOffset.clone().applyAxisAngle(right, currentAngle);
          camera.position.copy(currentTargetPos).add(currentOffset);
          controls.target.copy(currentTargetPos);
          controls.update();
          requestRender();
        },
        onComplete: () => {
          continuousVerticalOrbitTween = null;
          if (continuousVerticalOrbitState) {
            restoreOrbitLimitOverride(continuousVerticalOrbitState);
            continuousVerticalOrbitState = null;
          }
        },
      });

      scheduleSlideInCleanup(viewerEl, fadeDurationSec, resolve);

      return;
    }

    const viewerEl = document.getElementById('viewer');
    if (viewerEl) {
      viewerEl.classList.remove('slide-out');
      void viewerEl.offsetHeight;
      viewerEl.classList.add('slide-in');
    }

    if (!camera || !controls) {
      resolve();
      return;
    }

    // console.log(`[SlideIn] START - duration: ${durationSec}s, mode: ${mode}`);

    const geometry = calculateSlideGeometry(mode, direction, amount, false);
    const { startPosition, endPosition, startTarget, endTarget, orbitAxis, startOrbitAngle } = geometry;

    camera.position.copy(startPosition);
    controls.target.copy(startTarget);
    controls.update();
    requestRender();

    const proxy = { t: 0 };
    let progress = 0;
    let lastTime = 0;

    const speedAt = useCustom
      ? createSlideInSpeedProfile(config, durationSec)
      : null;

    const speedScale = useCustom
      ? computeSpeedScale(speedAt, durationSec)
      : 1;

    currentGsapTween = gsap.to(proxy, {
      t: durationSec,
      duration: durationSec,
      ease: "none",
      onUpdate: () => {
        let t = proxy.t;

        if (useCustom) {
          const dt = t - lastTime;
          lastTime = t;
          progress += speedAt(t) * speedScale * dt;
          progress = clamp01(progress);
        } else {
          progress = clamp01(t / durationSec);
          progress = gsap.parseEase(config.ease || "power2.out")(progress);
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
        // console.log(`[SlideIn] END`);
        currentGsapTween = null;
        slideAnimationState = null;

        if (viewerEl) {
          viewerEl.classList.remove('slide-out', 'slide-in');
        }
        resolve();
      },
    });
  });
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

const computeSpeedScale = (speedAt, totalDuration, samples = 240) => {
  let total = 0;
  let prevTime = 0;
  let prevSpeed = speedAt(0);

  for (let i = 1; i <= samples; i++) {
    const time = (totalDuration * i) / samples;
    const speed = speedAt(time);
    const dt = time - prevTime;
    // trapezoidal integration
    total += 0.5 * (prevSpeed + speed) * dt;
    prevTime = time;
    prevSpeed = speed;
  }

  return total > 0 ? 1 / total : 1;
};

const createSlideInSpeedProfile = (config, totalDuration) => {
  const total = totalDuration;
  const decelDur = total * config.decelTimeRatio;
  const decelEase = gsap.parseEase(config.decelEase || "power3.out");
  const slowEase = gsap.parseEase(config.slowEase || "none");

  return (time) => {
    if (time <= decelDur) {
      const t = decelDur > 0 ? time / decelDur : 1;
      const eased = decelEase(t);
      return gsap.utils.interpolate(config.fastSpeed, config.slowSpeed, eased);
    }
    const remaining = total - decelDur;
    const t = remaining > 0 ? (time - decelDur) / remaining : 1;
    slowEase(t);
    return config.slowSpeed;
  };
};

const createSlideOutSpeedProfile = (config, totalDuration) => {
  const total = totalDuration;
  const slowDur = total * config.slowTimeRatio;
  const accelDur = Math.max(0, total - slowDur);
  const accelEase = gsap.parseEase(config.accelEase || "power3.in");

  return (time) => {
    if (time <= slowDur) {
      return config.slowSpeed;
    }
    const t = accelDur > 0 ? (time - slowDur) / accelDur : 1;
    const eased = accelEase(t);
    return gsap.utils.interpolate(config.slowSpeed, config.fastSpeed, eased);
  };
};
