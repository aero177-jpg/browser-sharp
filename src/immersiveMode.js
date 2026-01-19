/**
 * Immersive Mode - Device orientation and touch-based camera control
 * 
 * Maps device rotation to camera orbit for a parallax effect.
 * Tilting the device orbits the camera around the target.
 * Single finger drag pans the camera for a parallax pan effect.
 * 
 * Uses a unified update loop to combine both inputs smoothly without jitter.
 */

import { camera, controls, requestRender, THREE } from './viewer.js';
import { useStore } from './store.js';
import { setLoadAnimationEnabled } from './customAnimations.js';

// State
let isActive = false;
let isPaused = false;
let baseQuaternion = null;
let baseSpherical = null;
let lastBeta = null;
let lastGamma = null;
let screenOrientation = 'portrait-primary';

// Unified update loop
let updateLoopId = null;

// Rotation (orientation) state
let rotationEnabled = true;

// Touch pan state
let touchPanEnabled = true;
let panOffset = { x: 0, y: 0 }; // Current pan offset applied to camera
let baseCameraTarget = null; // Original target before any pan offset
let touchStartPos = null; // Starting touch position
let touchPanSensitivity = 0.003; // How much touch movement translates to pan

// Raw input values (updated by event handlers, consumed by update loop)
let rawOrientation = { beta: null, gamma: null };

// Sensitivity settings
const BASE_SENSITIVITY = {
  tilt: 0.006,      // Base tilt sensitivity
  maxAngle: 25,     // Maximum degrees of camera orbit from center
  smoothing: 0.08,  // Smoothing factor (0-1, lower = smoother)
};

// Touch pan sensitivity settings
const TOUCH_PAN_SENSITIVITY = {
  scale: 0.003,     // How much touch movement translates to pan
  maxPanOffset: 2.0, // Maximum pan offset from center (world units, scaled by distance)
};

// Current sensitivity (can be scaled by multiplier)
let currentSensitivity = { ...BASE_SENSITIVITY };

// Touch pan scale multiplier (derived from immersive sensitivity)
let touchPanScaleMultiplier = 1;

/**
 * Computes touch pan scaling based on immersive sensitivity multiplier.
 * @param {number} multiplier - Multiplier between 1.0 and 5.0
 * @returns {number} Scale multiplier for touch panning
 */
const getTouchPanScaleForMultiplier = (multiplier) => {
  const t = (multiplier - 1.0) / 4.0; // 0..1
  return 0.25 + 0.75 * Math.max(0, Math.min(1, t));
};

/**
 * Sets the sensitivity multiplier for immersive mode tilt.
 * @param {number} multiplier - Multiplier between 1.0 and 5.0
 */
export const setImmersiveSensitivityMultiplier = (multiplier) => {
  const clamped = Math.max(1.0, Math.min(5.0, multiplier));
  currentSensitivity.tilt = BASE_SENSITIVITY.tilt * clamped;
  touchPanScaleMultiplier = getTouchPanScaleForMultiplier(clamped);
};

/**
 * Enables or disables rotation (orientation-based orbit).
 * @param {boolean} enabled - Whether rotation is enabled
 */
export const setRotationEnabled = (enabled) => {
  rotationEnabled = enabled;
  if (!enabled) {
    // Reset orientation state when disabled
    smoothedBeta = 0;
    smoothedGamma = 0;
    targetBeta = 0;
    targetGamma = 0;
  }
};

/**
 * Enables or disables touch-based panning.
 * @param {boolean} enabled - Whether touch panning is enabled
 */
export const setTouchPanEnabled = (enabled) => {
  touchPanEnabled = enabled;
  if (!enabled) {
    // Reset pan state when disabled
    panOffset = { x: 0, y: 0 };
    touchStartPos = null;
  }
};

// Smoothed values
let smoothedBeta = 0;
let smoothedGamma = 0;
let targetBeta = 0;
let targetGamma = 0;

/**
 * Gets the current screen orientation.
 */
const getScreenOrientation = () => {
  if (window.screen?.orientation?.type) {
    return window.screen.orientation.type;
  }
  // Fallback for older browsers
  const angle = window.orientation;
  if (angle === 0) return 'portrait-primary';
  if (angle === 180) return 'portrait-secondary';
  if (angle === 90) return 'landscape-primary';
  if (angle === -90) return 'landscape-secondary';
  return 'portrait-primary';
};

/**
 * Transforms device orientation values based on screen rotation.
 * Returns { beta, gamma } adjusted for current screen orientation.
 */
const transformForOrientation = (beta, gamma, orientation) => {
  switch (orientation) {
    case 'portrait-primary':
      // Normal portrait - no transformation needed
      return { beta, gamma };
    
    case 'portrait-secondary':
      // Upside down portrait (rare)
      return { beta: -beta, gamma: -gamma };
    
    case 'landscape-primary':
      // Landscape with home button on right (or natural landscape for tablets)
      // Swap axes: device tilt left/right becomes front/back
      return { beta: -gamma, gamma: beta };
    
    case 'landscape-secondary':
      // Landscape with home button on left
      // Swap and invert: device tilt left/right becomes front/back (reversed)
      return { beta: gamma, gamma: -beta };
    
    default:
      return { beta, gamma };
  }
};

/**
 * Handles screen orientation change.
 */
const handleOrientationChange = () => {
  screenOrientation = getScreenOrientation();
  // Reset baseline when orientation changes
  resetImmersiveBaseline();
  console.log('Screen orientation changed to:', screenOrientation);
};

/**
 * Gets the current immersive mode state from store.
 */
const getImmersiveMode = () => useStore.getState().immersiveMode;

/**
 * Requests permission for device orientation on iOS 13+.
 * Returns true if permission granted or not needed.
 */
export const requestOrientationPermission = async () => {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        console.warn('Device orientation permission denied');
        return false;
      }
    } catch (err) {
      console.warn('Device orientation permission denied:', err);
      return false;
    }
  }
  // Permission not required on this device or granted
  return true;
};

/**
 * Requests permission for device motion (accelerometer) on iOS 13+.
 * Returns true if permission granted or not needed.
 */
export const requestMotionPermission = async () => {
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission !== 'granted') {
        console.warn('Device motion permission denied');
        return false;
      }
    } catch (err) {
      console.warn('Device motion permission denied:', err);
      return false;
    }
  }
  // Permission not required on this device or granted
  return true;
};

/**
 * Checks if a slide transition is currently active.
 * Used to block camera input during transitions.
 */
const isSlideTransitionActive = () => {
  const viewerEl = document.getElementById('viewer');
  return viewerEl?.classList.contains('slide-out') || viewerEl?.classList.contains('slide-in');
};

/**
 * Handles device orientation event.
 * Just stores the raw values - actual camera update happens in unified loop.
 */
const handleDeviceOrientation = (event) => {
  if (!isActive || isPaused) return;
  
  let { beta, gamma } = event;
  if (beta === null || gamma === null) return;
  
  // Transform values based on screen orientation
  const transformed = transformForOrientation(beta, gamma, screenOrientation);
  rawOrientation.beta = transformed.beta;
  rawOrientation.gamma = transformed.gamma;
};

/**
 * Handles touch start for panning.
 */
const handleTouchStart = (event) => {
  if (!isActive || isPaused || !touchPanEnabled) return;
  if (event.touches.length !== 1) return; // Only single finger
  
  const touch = event.touches[0];
  touchStartPos = { x: touch.clientX, y: touch.clientY };
};

/**
 * Handles touch move for panning.
 */
const handleTouchMove = (event) => {
  if (!isActive || isPaused || !touchPanEnabled || !touchStartPos) return;
  if (event.touches.length !== 1) return; // Only single finger
  
  const touch = event.touches[0];
  const deltaX = touch.clientX - touchStartPos.x;
  const deltaY = touch.clientY - touchStartPos.y;
  
  // Update start position for continuous drag
  touchStartPos = { x: touch.clientX, y: touch.clientY };
  
  // Get distance for scaling pan amount
  const distance = baseSpherical?.radius ?? camera.position.distanceTo(controls.target);
  
  // Apply pan (negative X because dragging right should move view left)
  const panScale = TOUCH_PAN_SENSITIVITY.scale * touchPanScaleMultiplier;
  panOffset.x -= deltaX * panScale * distance;
  panOffset.y += deltaY * panScale * distance; // Y is inverted in screen coords
  
  // Clamp pan offset
  const maxPan = TOUCH_PAN_SENSITIVITY.maxPanOffset * distance;
  panOffset.x = THREE.MathUtils.clamp(panOffset.x, -maxPan, maxPan);
  panOffset.y = THREE.MathUtils.clamp(panOffset.y, -maxPan, maxPan);
};

/**
 * Handles touch end for panning.
 */
const handleTouchEnd = (event) => {
  if (event.touches.length === 0) {
    touchStartPos = null;
  }
};

/**
 * Unified update loop - combines orientation and touch pan inputs.
 * Runs on requestAnimationFrame to ensure smooth, jitter-free updates.
 */
const immersiveUpdateLoop = () => {
  if (!isActive || isPaused || !camera || !controls) {
    updateLoopId = requestAnimationFrame(immersiveUpdateLoop);
    return;
  }
  
  // Block input during slide transitions
  if (isSlideTransitionActive()) {
    updateLoopId = requestAnimationFrame(immersiveUpdateLoop);
    return;
  }
  
  let needsRender = false;
  
  // === Process Orientation (Orbit) ===
  if (rotationEnabled && rawOrientation.beta !== null && rawOrientation.gamma !== null) {
    const beta = rawOrientation.beta;
    const gamma = rawOrientation.gamma;
    
    // Initialize base values on first reading
    if (lastBeta === null) {
      lastBeta = beta;
      lastGamma = gamma;
      smoothedBeta = 0;
      smoothedGamma = 0;
      targetBeta = 0;
      targetGamma = 0;
      
      // Capture current camera position as baseline
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      baseSpherical = new THREE.Spherical().setFromVector3(offset);
    } else {
      // Calculate delta from initial orientation
      let deltaBeta = beta - lastBeta;
      let deltaGamma = gamma - lastGamma;
      
      // Handle wrap-around for beta
      if (deltaBeta > 180) deltaBeta -= 360;
      if (deltaBeta < -180) deltaBeta += 360;
      
      // Soft clamping using tanh for smooth boundaries
      const softClamp = (value, limit) => {
        const normalized = value / limit;
        return limit * Math.tanh(normalized);
      };
      
      // Apply soft clamping for smooth boundary behavior
      targetBeta = softClamp(deltaBeta, currentSensitivity.maxAngle);
      targetGamma = softClamp(deltaGamma, currentSensitivity.maxAngle);
      
      // Apply smoothing (interpolate towards target)
      smoothedBeta += (targetBeta - smoothedBeta) * currentSensitivity.smoothing;
      smoothedGamma += (targetGamma - smoothedGamma) * currentSensitivity.smoothing;
    }
  }
  
  // === Pan is handled directly in touch handlers (panOffset is updated there) ===
  
  // === Apply Combined Camera Transform ===
  if (baseSpherical) {
    const newSpherical = baseSpherical.clone();
    
    // Apply orientation-based orbit
    newSpherical.theta = baseSpherical.theta + smoothedGamma * currentSensitivity.tilt;
    newSpherical.phi = baseSpherical.phi + smoothedBeta * currentSensitivity.tilt;
    
    // Clamp phi
    const minPhi = 0.02;
    const maxPhi = Math.PI - 0.02;
    newSpherical.phi = THREE.MathUtils.clamp(newSpherical.phi, minPhi, maxPhi);
    
    // Calculate base position from orbit (relative to base target)
    const orbitOffset = new THREE.Vector3().setFromSpherical(newSpherical);
    
    // Calculate pan displacement in camera space (true pan = move camera + target together)
    let panDisplacement = new THREE.Vector3();
    if (touchPanEnabled && (Math.abs(panOffset.x) > 0.0001 || Math.abs(panOffset.y) > 0.0001)) {
      // Get camera's right and up vectors from the orbit position
      // We need to compute these based on the spherical coordinates
      const tempCamPos = new THREE.Vector3().copy(baseCameraTarget ?? controls.target).add(orbitOffset);
      const forward = new THREE.Vector3().subVectors(baseCameraTarget ?? controls.target, tempCamPos).normalize();
      const worldUp = new THREE.Vector3(0, 1, 0);
      const cameraRight = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
      const cameraUp = new THREE.Vector3().crossVectors(cameraRight, forward).normalize();
      
      // Pan displacement moves both camera and target
      panDisplacement.addScaledVector(cameraRight, panOffset.x);
      panDisplacement.addScaledVector(cameraUp, panOffset.y);
    }
    
    // Apply pan offset to target (true panning)
    const pannedTarget = (baseCameraTarget ?? controls.target).clone().add(panDisplacement);
    
    // Position camera relative to panned target
    camera.position.copy(pannedTarget).add(orbitOffset);
    camera.lookAt(pannedTarget);
    
    // Update controls target to match (so manual controls work correctly after)
    controls.target.copy(pannedTarget);
    
    needsRender = true;
  }
  
  if (needsRender) {
    requestRender();
  }
  
  updateLoopId = requestAnimationFrame(immersiveUpdateLoop);
};

/**
 * Enables immersive mode.
 * Disables orbit controls and starts listening to device orientation and touch.
 */
export const enableImmersiveMode = async () => {
  if (isActive) return true;
  
  // Request orientation permission if needed (iOS)
  const hasOrientationPermission = await requestOrientationPermission();
  if (!hasOrientationPermission) {
    console.warn('Immersive mode requires device orientation permission');
    return false;
  }
  
  // Get initial screen orientation
  screenOrientation = getScreenOrientation();
  
  // Disable load animations
  setLoadAnimationEnabled(false);
  
  // Disable orbit controls drag (but keep zoom/pan)
  if (controls) {
    controls.enableRotate = false;
    controls.enablePan = false; // We handle pan ourselves
  }
  
  // Reset orientation state
  lastBeta = null;
  lastGamma = null;
  smoothedBeta = 0;
  smoothedGamma = 0;
  baseSpherical = null;
  rawOrientation = { beta: null, gamma: null };
  
  // Reset pan state
  panOffset = { x: 0, y: 0 };
  touchStartPos = null;
  baseCameraTarget = controls?.target?.clone() ?? null;
  
  // Start listening to device orientation (just stores values)
  window.addEventListener('deviceorientation', handleDeviceOrientation, true);
  
  // Start listening to touch events for panning
  const viewerEl = document.getElementById('viewer');
  if (viewerEl) {
    viewerEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    viewerEl.addEventListener('touchmove', handleTouchMove, { passive: true });
    viewerEl.addEventListener('touchend', handleTouchEnd, { passive: true });
  }
  
  // Listen for screen orientation changes
  if (window.screen?.orientation) {
    window.screen.orientation.addEventListener('change', handleOrientationChange);
  } else {
    // Fallback for older browsers
    window.addEventListener('orientationchange', handleOrientationChange);
  }
  
  // Start unified update loop
  if (updateLoopId) {
    cancelAnimationFrame(updateLoopId);
  }
  updateLoopId = requestAnimationFrame(immersiveUpdateLoop);
  
  isActive = true;
  console.log('Immersive mode enabled (touch pan:', touchPanEnabled ? 'on' : 'off', ')');
  return true;
};

/**
 * Disables immersive mode.
 * Re-enables orbit controls and stops listening to device orientation and touch.
 */
export const disableImmersiveMode = () => {
  if (!isActive) return;
  
  // Stop unified update loop
  if (updateLoopId) {
    cancelAnimationFrame(updateLoopId);
    updateLoopId = null;
  }
  
  // Stop listening to device orientation
  window.removeEventListener('deviceorientation', handleDeviceOrientation, true);
  
  // Stop listening to touch events
  const viewerEl = document.getElementById('viewer');
  if (viewerEl) {
    viewerEl.removeEventListener('touchstart', handleTouchStart);
    viewerEl.removeEventListener('touchmove', handleTouchMove);
    viewerEl.removeEventListener('touchend', handleTouchEnd);
  }
  
  // Stop listening to screen orientation changes
  if (window.screen?.orientation) {
    window.screen.orientation.removeEventListener('change', handleOrientationChange);
  } else {
    window.removeEventListener('orientationchange', handleOrientationChange);
  }
  
  // Re-enable orbit controls
  if (controls) {
    controls.enableRotate = true;
    controls.enablePan = true;
  }
  
  // Re-enable load animations (restore from store)
  const storedAnimationEnabled = useStore.getState().animationEnabled;
  setLoadAnimationEnabled(storedAnimationEnabled);
  
  // Reset orientation state
  isActive = false;
  lastBeta = null;
  lastGamma = null;
  baseSpherical = null;
  
  // Reset pan state
  panOffset = { x: 0, y: 0 };
  touchStartPos = null;
  baseCameraTarget = null;
  
  console.log('Immersive mode disabled');
};

/**
 * Toggles immersive mode.
 */
export const toggleImmersiveMode = async () => {
  if (isActive) {
    disableImmersiveMode();
    return false;
  } else {
    return await enableImmersiveMode();
  }
};

/**
 * Resets the baseline orientation to current device position.
 * Call this to re-center the parallax effect.
 */
export const resetImmersiveBaseline = () => {
  // Reset orientation baseline
  lastBeta = null;
  lastGamma = null;
  smoothedBeta = 0;
  smoothedGamma = 0;
  targetBeta = 0;
  targetGamma = 0;
  baseSpherical = null;
  rawOrientation = { beta: null, gamma: null };
  
  // Reset pan state
  panOffset = { x: 0, y: 0 };
  touchStartPos = null;
  baseCameraTarget = controls?.target?.clone() ?? null;
};

/**
 * Pauses immersive mode temporarily (e.g., during camera reset animation).
 */
export const pauseImmersiveMode = () => {
  isPaused = true;
};

/**
 * Resumes immersive mode after pause, resetting baseline to current position.
 */
export const resumeImmersiveMode = () => {
  if (isActive) {
    // Reset baseline so camera starts fresh from new position
    resetImmersiveBaseline();
    isPaused = false;
  }
};

/**
 * Syncs the immersive baseline to the current camera state without pausing input.
 * Useful when external camera changes occur (e.g., FOV changes).
 */
export const syncImmersiveBaseline = () => {
  if (!isActive) return;
  resetImmersiveBaseline();
};

/**
 * Performs a camera recenter while in immersive mode.
 * Pauses orientation input, resets camera, then resumes with new baseline.
 */
export const recenterInImmersiveMode = (recenterCallback, duration = 600) => {
  if (!isActive) {
    // Not in immersive mode, just do normal recenter
    recenterCallback();
    return;
  }
  
  // Pause orientation input
  pauseImmersiveMode();
  
  // Perform recenter
  recenterCallback();
  
  // Resume after animation completes
  setTimeout(() => {
    resumeImmersiveMode();
  }, duration + 100); // Small buffer after animation
};

/**
 * Returns whether immersive mode is currently active.
 */
export const isImmersiveModeActive = () => isActive;

/**
 * Returns whether immersive mode is paused.
 */
export const isImmersiveModePaused = () => isPaused;

/**
 * Returns whether rotation (orientation-based orbit) is currently enabled.
 */
export const isRotationEnabled = () => rotationEnabled;

/**
 * Returns whether touch panning is currently enabled.
 */
export const isTouchPanEnabled = () => touchPanEnabled;
