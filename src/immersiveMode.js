/**
 * Immersive Mode - Device orientation-based camera control
 * 
 * Maps device rotation to camera orbit for a parallax effect.
 * Tilting the device orbits the camera around the target.
 */

import { camera, controls, requestRender, THREE } from './viewer.js';
import { useStore } from './store.js';
import { setLoadAnimationEnabled } from './cameraAnimations.js';

// State
let isActive = false;
let isPaused = false;
let baseQuaternion = null;
let baseSpherical = null;
let lastBeta = null;
let lastGamma = null;
let screenOrientation = 'portrait-primary';

// Sensitivity settings
const BASE_SENSITIVITY = {
  tilt: 0.006,      // Base tilt sensitivity
  maxAngle: 25,     // Maximum degrees of camera orbit from center
  smoothing: 0.08,  // Smoothing factor (0-1, lower = smoother)
};

// Current sensitivity (can be scaled by multiplier)
let currentSensitivity = { ...BASE_SENSITIVITY };

/**
 * Sets the sensitivity multiplier for immersive mode tilt.
 * @param {number} multiplier - Multiplier between 1.0 and 5.0
 */
export const setImmersiveSensitivityMultiplier = (multiplier) => {
  const clamped = Math.max(1.0, Math.min(5.0, multiplier));
  currentSensitivity.tilt = BASE_SENSITIVITY.tilt * clamped;
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
      return permission === 'granted';
    } catch (err) {
      console.warn('Device orientation permission denied:', err);
      return false;
    }
  }
  // Permission not required on this device
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
 * Maps beta (front-back tilt) and gamma (left-right tilt) to camera orbit.
 */
const handleDeviceOrientation = (event) => {
  if (!isActive || isPaused || !camera || !controls) return;
  
  // Block input during slide transitions to prevent erratic camera movement
  if (isSlideTransitionActive()) return;
  
  let { beta, gamma } = event;
  
  // beta: front-back tilt (-180 to 180, 0 when flat)
  // gamma: left-right tilt (-90 to 90, 0 when flat)
  
  if (beta === null || gamma === null) return;
  
  // Transform values based on screen orientation
  const transformed = transformForOrientation(beta, gamma, screenOrientation);
  beta = transformed.beta;
  gamma = transformed.gamma;
  
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
    return;
  }
  
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
  
  // Apply to camera orbit
  if (baseSpherical) {
    const newSpherical = baseSpherical.clone();
    
    // Map device tilt to camera orbit
    // Gamma (left-right tilt) -> azimuthal angle (horizontal orbit)
    // Beta (front-back tilt) -> polar angle (vertical orbit)
    // Note: negative beta = tilt phone forward = look down = increase phi
    newSpherical.theta = baseSpherical.theta + smoothedGamma * currentSensitivity.tilt;
    newSpherical.phi = baseSpherical.phi + smoothedBeta * currentSensitivity.tilt;
    
    // Clamp phi - use very generous absolute limits
    // The soft clamping on input already provides smooth boundaries
    const minPhi = 0.02;  // Just above 0 (looking straight up)
    const maxPhi = Math.PI - 0.02;  // Just below PI (looking straight down)
    newSpherical.phi = THREE.MathUtils.clamp(newSpherical.phi, minPhi, maxPhi);
    
    // Apply to camera position
    const offset = new THREE.Vector3().setFromSpherical(newSpherical);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
    
    requestRender();
  }
};

/**
 * Enables immersive mode.
 * Disables orbit controls and starts listening to device orientation.
 */
export const enableImmersiveMode = async () => {
  if (isActive) return true;
  
  // Request permission if needed (iOS)
  const hasPermission = await requestOrientationPermission();
  if (!hasPermission) {
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
  }
  
  // Reset state
  lastBeta = null;
  lastGamma = null;
  smoothedBeta = 0;
  smoothedGamma = 0;
  baseSpherical = null;
  
  // Start listening to device orientation
  window.addEventListener('deviceorientation', handleDeviceOrientation, true);
  
  // Listen for screen orientation changes
  if (window.screen?.orientation) {
    window.screen.orientation.addEventListener('change', handleOrientationChange);
  } else {
    // Fallback for older browsers
    window.addEventListener('orientationchange', handleOrientationChange);
  }
  
  isActive = true;
  console.log('Immersive mode enabled');
  return true;
};

/**
 * Disables immersive mode.
 * Re-enables orbit controls and stops listening to device orientation.
 */
export const disableImmersiveMode = () => {
  if (!isActive) return;
  
  // Stop listening to device orientation
  window.removeEventListener('deviceorientation', handleDeviceOrientation, true);
  
  // Stop listening to screen orientation changes
  if (window.screen?.orientation) {
    window.screen.orientation.removeEventListener('change', handleOrientationChange);
  } else {
    window.removeEventListener('orientationchange', handleOrientationChange);
  }
  
  // Re-enable orbit controls
  if (controls) {
    controls.enableRotate = true;
  }
  
  // Re-enable load animations (restore from store)
  const storedAnimationEnabled = useStore.getState().animationEnabled;
  setLoadAnimationEnabled(storedAnimationEnabled);
  
  // Reset state
  isActive = false;
  lastBeta = null;
  lastGamma = null;
  baseSpherical = null;
  
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
  lastBeta = null;
  lastGamma = null;
  smoothedBeta = 0;
  smoothedGamma = 0;
  targetBeta = 0;
  targetGamma = 0;
  baseSpherical = null;
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
