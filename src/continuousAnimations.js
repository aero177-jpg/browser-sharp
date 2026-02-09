/**
 * Continuous slideshow animations: zoom, orbit, and vertical-orbit.
 * These run as long-lived GSAP tweens during slideshow "continuous" mode.
 */
import { camera, controls, requestRender, THREE } from "./viewer.js";
import { useStore } from "./store.js";
import gsap from "gsap";

// ============================================================================
// Configuration
// ============================================================================

const CONTINUOUS_ZOOM_DURATION = 5; // seconds
const CONTINUOUS_ZOOM_START_RATIO_BY_SIZE = {
  small: 0.04,
  medium: 0.08,
  large: 0.12,
};
const CONTINUOUS_ZOOM_END_RATIO_BY_SIZE = {
  small: 0.22,
  medium: 0.30,
  large: 0.36,
};

const CONTINUOUS_ORBIT_DURATION = 10;
const CONTINUOUS_ORBIT_ANGLE_DEG = 12;
const CONTINUOUS_ORBIT_PAN_SCALE = 0.4;

const CONTINUOUS_VERTICAL_ORBIT_DURATION = 10;
const CONTINUOUS_VERTICAL_ORBIT_ANGLE_DEG = 12;
const CONTINUOUS_VERTICAL_ORBIT_PAN_SCALE = 0.4;

const CONTINUOUS_SIZE_SCALE = {
  small: 0.45,
  medium: 0.65,
  large: 0.85,
};

// ============================================================================
// Internal state
// ============================================================================

let continuousZoomTween = null;
let continuousOrbitTween = null;
let continuousOrbitState = null;
let continuousVerticalOrbitTween = null;
let continuousVerticalOrbitState = null;

// ============================================================================
// Helpers
// ============================================================================

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

/** Shared setup for continuous slide-in: toggle CSS classes, guard camera. */
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

/** Schedules CSS cleanup after the fade duration. */
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

// ============================================================================
// Cancel helpers
// ============================================================================

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

// ============================================================================
// Continuous slide-in animations
// ============================================================================

/**
 * Continuous-zoom slide-in: gentle dolly along the forward axis.
 * @returns {Promise} Resolves when CSS fade completes (tween continues in background).
 */
export const continuousZoomSlideIn = (duration, amount) => {
  return new Promise((resolve) => {
    cancelContinuousZoomAnimation();
    const { viewerEl, fadeDurationSec, canAnimate } = beginContinuousSlideIn(duration);
    if (!canAnimate) { resolve(); return; }

    const currentPosition = camera.position.clone();
    const currentTarget = controls.target.clone();
    const distance = currentPosition.distanceTo(currentTarget);
    const forward = new THREE.Vector3().subVectors(currentTarget, currentPosition).normalize();

    const durationSec = getContinuousDurationSeconds('continuous-zoom', CONTINUOUS_ZOOM_DURATION);
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
      onUpdate: () => { controls.update(); requestRender(); },
      onComplete: () => { continuousZoomTween = null; },
    });

    scheduleSlideInCleanup(viewerEl, fadeDurationSec, resolve);
  });
};

/**
 * Continuous-orbit slide-in: horizontal arc around the target.
 * @returns {Promise}
 */
export const continuousOrbitSlideIn = (duration, amount) => {
  return new Promise((resolve) => {
    cancelContinuousOrbitAnimation();
    const { viewerEl, fadeDurationSec, canAnimate } = beginContinuousSlideIn(duration);
    if (!canAnimate) { resolve(); return; }

    const currentPosition = camera.position.clone();
    const currentTarget = controls.target.clone();
    const distance = currentPosition.distanceTo(currentTarget);
    const up = camera.up.clone().normalize();
    const forward = new THREE.Vector3().subVectors(currentTarget, currentPosition).normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();

    const durationSec = getContinuousDurationSeconds('continuous-orbit', CONTINUOUS_ORBIT_DURATION);
    const motionScale = getContinuousSizeScale();

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
  });
};

/**
 * Continuous-vertical-orbit slide-in: vertical arc around the target.
 * @returns {Promise}
 */
export const continuousVerticalOrbitSlideIn = (duration, amount) => {
  return new Promise((resolve) => {
    cancelContinuousVerticalOrbitAnimation();
    const { viewerEl, fadeDurationSec, canAnimate } = beginContinuousSlideIn(duration);
    if (!canAnimate) { resolve(); return; }

    const currentPosition = camera.position.clone();
    const currentTarget = controls.target.clone();
    const distance = currentPosition.distanceTo(currentTarget);
    const up = camera.up.clone().normalize();
    const forward = new THREE.Vector3().subVectors(currentTarget, currentPosition).normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();

    const durationSec = getContinuousDurationSeconds('continuous-orbit-vertical', CONTINUOUS_VERTICAL_ORBIT_DURATION);
    const motionScale = getContinuousSizeScale();

    const orbitAngle = (Math.PI / 180) * CONTINUOUS_VERTICAL_ORBIT_ANGLE_DEG * motionScale;
    const panAmount = distance * amount * CONTINUOUS_VERTICAL_ORBIT_PAN_SCALE * motionScale;

    const startTarget = currentTarget.clone().add(up.clone().multiplyScalar(panAmount));
    const endTarget = currentTarget.clone().add(up.clone().multiplyScalar(-panAmount));

    const orbitOffset = new THREE.Vector3().subVectors(currentPosition, currentTarget);
    const startOrbitOffset = orbitOffset.clone().applyAxisAngle(right, -orbitAngle);
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
  });
};
