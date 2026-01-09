import { camera, controls, requestRender, THREE, bgImageContainer } from "./viewer.js";
import { useStore } from "./store.js";

// Get store state
const getStoreState = () => useStore.getState();

let animationState = null;
let resetAnimationState = null;
let anchorAnimationState = null;

// Easing functions
const easingFunctions = {
  'linear': (t) => t,
  'ease-in': (t) => t * t * t,
  'ease-out': (t) => 1 - Math.pow(1 - t, 3),
  'ease-in-out': (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
};

// Sweep direction presets (startDeg is the offset from center)
const sweepPresets = {
  left: { axis: 'up', direction: 1 },
  right: { axis: 'up', direction: -1 },
  up: { axis: 'right', direction: -1 },
  down: { axis: 'right', direction: 1 },
};

// Intensity presets
const intensityPresets = {
  subtle: { zoomFactor: 0.05, duration: 1200, sweepDegrees: 4 },
  medium: { zoomFactor: 0.1, duration: 1800, sweepDegrees: 8 },
  dramatic: { zoomFactor: 0.15, duration: 2400, sweepDegrees: 12 },
};

const validDirections = ['left', 'right', 'up', 'down', 'none'];

// Get animation settings from store
const getAnimationEnabled = () => getStoreState().animationEnabled;

export const isLoadAnimationEnabled = () => getAnimationEnabled();

export const setLoadAnimationEnabled = (enabled) => {
  getStoreState().setAnimationEnabled(enabled);
};

export const cancelLoadZoomAnimation = () => {
  if (animationState?.frameId) {
    cancelAnimationFrame(animationState.frameId);
  }
  if (animationState) {
    controls.enabled = animationState.wasEnabled;
    controls.update();
    requestRender();
  }
  animationState = null;
};

export const getLoadAnimationIntensityKey = () => getStoreState().animationIntensity;

export const setLoadAnimationIntensity = (key) => {
  if (intensityPresets[key] || key === 'custom') {
    getStoreState().setAnimationIntensity(key);
    return key;
  }
  return getStoreState().animationIntensity;
};

export const getLoadAnimationDirection = () => getStoreState().animationDirection;

export const setLoadAnimationDirection = (direction) => {
  const normalized = direction?.toLowerCase?.();
  if (validDirections.includes(normalized)) {
    getStoreState().setAnimationDirection(normalized);
    return normalized;
  }
  return getStoreState().animationDirection;
};

/**
 * Builds animation parameters from either a preset or custom settings.
 */
const buildAnimationParams = (distance) => {
  const state = getStoreState();
  const intensityKey = state.animationIntensity;
  
  if (intensityKey === 'custom') {
    const custom = state.customAnimation;
    const duration = custom.duration * 1000; // Convert to ms
    const easing = easingFunctions[custom.easing] ?? easingFunctions['ease-in-out'];
    
    // Rotation params
    const rotationType = custom.rotationType;
    const sweepDegrees = rotationType === 'none' ? 0 : custom.rotation;
    const sweepPreset = sweepPresets[rotationType] ?? null;
    
    // Zoom params - animation behavior:
    // zoomIn: start slightly before baseline → end zoomed in past baseline
    // zoomOut: start close → end at baseline (no overshoot)
    const zoomType = custom.zoomType;
    const zoomAmount = custom.zoom * 0.15; // Scale to reasonable range
    let startZoomOffset = 0;
    let endZoomOffset = 0;
    if (zoomType === 'in') {
      startZoomOffset = zoomAmount * 0.2;   // Start slightly before baseline (20% of zoom amount)
      endZoomOffset = -zoomAmount * 0.3;    // End zoomed in past baseline
    } else if (zoomType === 'out') {
      startZoomOffset = -zoomAmount * 0.5;  // Start zoomed in
      endZoomOffset = 0;                    // End at baseline (no overshoot)
    }
    
    return { duration, easing, sweepDegrees, sweepPreset, startZoomOffset, endZoomOffset };
  }
  
  // Use preset (presets zoom out then settle at baseline)
  const preset = intensityPresets[intensityKey] ?? intensityPresets.medium;
  const direction = state.animationDirection;
  const sweepPreset = direction === 'none' ? null : (sweepPresets[direction] ?? sweepPresets.left);
  
  return {
    duration: preset.duration,
    easing: easingFunctions['ease-out'],
    sweepDegrees: preset.sweepDegrees,
    sweepPreset,
    startZoomOffset: preset.zoomFactor,
    endZoomOffset: 0,
  };
};

export const startLoadZoomAnimation = (options = {}) => {
  const normalizedOptions = typeof options === 'string' ? { direction: options } : options ?? {};
  const forcePlayback = Boolean(normalizedOptions.force);
  const onComplete = normalizedOptions.onComplete;

  if (!camera || !controls || (!getAnimationEnabled() && !forcePlayback)) return;

  const baseOffset = new THREE.Vector3().subVectors(camera.position, controls.target);
  const distance = baseOffset.length();
  if (!Number.isFinite(distance) || distance <= 0.01) return;

  const { duration, easing, sweepDegrees, sweepPreset, startZoomOffset, endZoomOffset } = buildAnimationParams(distance);
  
  // Skip if nothing to animate
  if (duration <= 0 || (sweepDegrees === 0 && startZoomOffset === 0 && endZoomOffset === 0)) return;

  // Calculate axis vectors
  const upVector = (controls.object?.up ?? controls.up ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
  const rightVector = new THREE.Vector3().copy(baseOffset).cross(upVector);
  if (rightVector.lengthSq() < 1e-6) {
    rightVector.copy(upVector).cross(new THREE.Vector3(1, 0, 0));
    if (rightVector.lengthSq() < 1e-6) {
      rightVector.copy(upVector).cross(new THREE.Vector3(0, 0, 1));
    }
  }
  rightVector.normalize();

  // Determine sweep axis and angle
  const axisVector = sweepPreset
    ? (sweepPreset.axis === 'right' ? rightVector : upVector).clone()
    : upVector.clone();
  const startAngle = sweepPreset
    ? THREE.MathUtils.degToRad(sweepDegrees * sweepPreset.direction)
    : 0;
  const endAngle = 0;

  // Determine zoom radii (animation passes through baseline)
  const startRadius = distance * (1 + startZoomOffset);
  const endRadius = distance * (1 + endZoomOffset);

  // Store target and set initial position
  const animTarget = controls.target.clone();
  const initialOffset = baseOffset.clone().applyAxisAngle(axisVector, startAngle).setLength(startRadius);
  camera.position.copy(animTarget).add(initialOffset);
  camera.lookAt(animTarget);

  const wasEnabled = controls.enabled;
  controls.enabled = false;
  
  // Store current orbit limits and disable them for animation
  const savedLimits = {
    minAzimuthAngle: controls.minAzimuthAngle,
    maxAzimuthAngle: controls.maxAzimuthAngle,
    minPolarAngle: controls.minPolarAngle,
    maxPolarAngle: controls.maxPolarAngle,
  };
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI;
  
  requestRender();

  cancelLoadZoomAnimation();

  const animate = (timestamp) => {
    if (!animationState) return;

    if (animationState.startTime == null) {
      animationState.startTime = timestamp;
    }

    const elapsed = timestamp - animationState.startTime;
    const t = Math.min(elapsed / animationState.duration, 1);
    const eased = animationState.easing(t);

    const angle = THREE.MathUtils.lerp(animationState.startAngle, animationState.endAngle, eased);
    const radius = THREE.MathUtils.lerp(animationState.startRadius, animationState.endRadius, eased);
    const offset = animationState.baseOffset
      .clone()
      .applyAxisAngle(animationState.axisVector, angle)
      .setLength(radius);
    camera.position.copy(animationState.animTarget).add(offset);
    camera.lookAt(animationState.animTarget);
    requestRender();

    if (t < 1) {
      animationState.frameId = requestAnimationFrame(animate);
    } else {
      // Restore orbit limits after animation
      controls.minAzimuthAngle = animationState.savedLimits.minAzimuthAngle;
      controls.maxAzimuthAngle = animationState.savedLimits.maxAzimuthAngle;
      controls.minPolarAngle = animationState.savedLimits.minPolarAngle;
      controls.maxPolarAngle = animationState.savedLimits.maxPolarAngle;
      
      controls.enabled = animationState.wasEnabled;
      controls.update();
      requestRender();
      
      const callback = animationState.onComplete;
      animationState = null;
      if (callback) callback();
    }
  };

  animationState = {
    frameId: requestAnimationFrame(animate),
    startTime: null,
    baseOffset,
    axisVector,
    startAngle,
    endAngle,
    startRadius,
    endRadius,
    duration,
    easing,
    animTarget,
    wasEnabled,
    savedLimits,
    onComplete,
  };
};

// Smooth reset animation
const easeInOutCubic = easingFunctions['ease-in-out'];

export const cancelResetAnimation = () => {
  if (resetAnimationState?.frameId) {
    cancelAnimationFrame(resetAnimationState.frameId);
  }
  resetAnimationState = null;
};

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

    // Lerp position
    camera.position.lerpVectors(startState.position, targetState.position, eased);

    // Slerp quaternion for smooth rotation
    camera.quaternion.slerpQuaternions(startState.quaternion, targetState.quaternion, eased);

    // Lerp FOV, near, far, zoom
    camera.fov = THREE.MathUtils.lerp(startState.fov, targetState.fov, eased);
    camera.near = THREE.MathUtils.lerp(startState.near, targetState.near, eased);
    camera.far = THREE.MathUtils.lerp(startState.far, targetState.far, eased);
    camera.zoom = THREE.MathUtils.lerp(startState.zoom, targetState.zoom, eased);
    camera.updateProjectionMatrix();

    // Lerp controls target
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

export const cancelAnchorTransition = () => {
  if (anchorAnimationState?.frameId) {
    cancelAnimationFrame(anchorAnimationState.frameId);
  }
  anchorAnimationState = null;
};

// Slide transition state
let slideAnimationState = null;

export const cancelSlideAnimation = () => {
  if (slideAnimationState?.frameId) {
    cancelAnimationFrame(slideAnimationState.frameId);
  }
  if (slideAnimationState?.fadeTimeoutId) {
    clearTimeout(slideAnimationState.fadeTimeoutId);
  }
  slideAnimationState = null;
  
  // Clean up CSS transition classes to ensure clean state
  const viewerEl = document.getElementById('viewer');
  if (viewerEl) {
    viewerEl.classList.remove('slide-out', 'slide-in');
  }
  if (bgImageContainer) {
    bgImageContainer.classList.remove('blur-out');
  }
};

/**
 * Performs a slide-out animation (pan camera in direction of navigation).
 * @param {'next'|'prev'} direction - Navigation direction
 * @param {Object} options - Animation options
 * @param {string} options.mode - Slide mode: 'horizontal', 'vertical', 'zoom', or 'fade'
 * @returns {Promise} Resolves when animation completes
 */
export const slideOutAnimation = (direction, { duration = 1200, amount = 0.45, fadeDelay = 0.7, mode = 'horizontal' } = {}) => {
  return new Promise((resolve) => {
    // For fade mode, only do CSS transition - no camera animation
    if (mode === 'fade') {
      cancelSlideAnimation();
      
      const viewerEl = document.getElementById('viewer');
      if (bgImageContainer) {
        bgImageContainer.classList.add('blur-out');
      }
      
      const fadeTimeoutId = setTimeout(() => {
        if (viewerEl) {
          viewerEl.classList.add('slide-out');
        }
        if (bgImageContainer) {
          bgImageContainer.classList.remove('active');
        }
      }, duration * fadeDelay);
      
      // Just wait for the fade duration, no camera movement
      slideAnimationState = {
        frameId: setTimeout(() => {
          slideAnimationState = null;
          resolve();
        }, duration),
        startTime: null,
        fadeTimeoutId,
      };
      return;
    }
    
    if (!camera || !controls) {
      resolve();
      return;
    }

    cancelSlideAnimation();
    
    const viewerEl = document.getElementById('viewer');
    if (viewerEl) {
      viewerEl.classList.remove('slide-in');
    }
    if (bgImageContainer) {
      // Begin blurring the existing background immediately; fade happens later
      bgImageContainer.classList.add('blur-out');
    }
    
    // Schedule canvas blur for later in the animation (last 0.45s)
    const fadeTimeoutId = setTimeout(() => {
      if (viewerEl) {
        viewerEl.classList.add('slide-out');
      }
      // Fade background out in sync with canvas blur instead of immediately
      if (bgImageContainer) {
        bgImageContainer.classList.remove('active');
      }
    }, duration * fadeDelay);

    const startPosition = camera.position.clone();
    const startTarget = controls.target.clone();
    const distance = startPosition.distanceTo(startTarget);

    // Calculate direction vectors
    const forward = new THREE.Vector3().subVectors(startTarget, startPosition).normalize();
    const up = camera.up.clone().normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();

    let endPosition, endTarget, orbitAxis, orbitAngle;
    
    if (mode === 'zoom') {
      // Zoom mode: zoom into the scene (move camera closer to target)
      const zoomAmount = distance * 0.3; // Zoom in by 30% of distance
      const zoomOffset = forward.clone().multiplyScalar(zoomAmount);
      endPosition = startPosition.clone().add(zoomOffset);
      endTarget = startTarget.clone(); // Target stays the same
      orbitAxis = up;
      orbitAngle = 0; // No orbit rotation for zoom
    } else if (mode === 'vertical') {
      // Vertical mode: pan up/down
      const panSign = direction === 'next' ? -1 : 1; // next = pan down, prev = pan up
      const panAmount = distance * amount * panSign;
      const panOffset = up.clone().multiplyScalar(panAmount);
      endPosition = startPosition.clone().add(panOffset);
      endTarget = startTarget.clone().add(panOffset);
      // Orbit around right axis for vertical movement
      orbitAxis = right;
      orbitAngle = (Math.PI / 180) * 8 * (direction === 'next' ? 1 : -1);
    } else {
      // Horizontal mode (default): pan left/right
      const panSign = direction === 'next' ? 1 : -1;
      const panAmount = distance * amount * panSign;
      const panOffset = right.clone().multiplyScalar(panAmount);
      endPosition = startPosition.clone().add(panOffset);
      endTarget = startTarget.clone().add(panOffset);
      orbitAxis = up;
      orbitAngle = (Math.PI / 180) * 8 * (direction === 'next' ? 1 : -1);
    }

    const animate = (timestamp) => {
      if (!slideAnimationState) {
        resolve();
        return;
      }

      if (slideAnimationState.startTime == null) {
        slideAnimationState.startTime = timestamp;
      }

      const elapsed = timestamp - slideAnimationState.startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = easingFunctions['ease-in'](t);

      // Interpolate position and target
      camera.position.lerpVectors(startPosition, endPosition, eased);
      controls.target.lerpVectors(startTarget, endTarget, eased);

      // Add orbit rotation (skip for zoom mode)
      if (orbitAngle !== 0) {
        const currentOrbitAngle = orbitAngle * eased;
        const orbitOffset = new THREE.Vector3().subVectors(camera.position, controls.target);
        orbitOffset.applyAxisAngle(orbitAxis, currentOrbitAngle);
        camera.position.copy(controls.target).add(orbitOffset);
      }

      controls.update();
      requestRender();

      if (t < 1) {
        slideAnimationState.frameId = requestAnimationFrame(animate);
      } else {
        slideAnimationState = null;
        resolve();
      }
    };

    slideAnimationState = {
      frameId: requestAnimationFrame(animate),
      startTime: null,
      fadeTimeoutId,
    };
  });
};

/**
 * Performs a slide-in animation (camera starts offset, slides to center).
 * Call this AFTER setting up the new camera position.
 * @param {'next'|'prev'} direction - Navigation direction (determines start offset)
 * @param {Object} options - Animation options
 * @param {string} options.mode - Slide mode: 'horizontal', 'vertical', 'zoom', or 'fade'
 * @returns {Promise} Resolves when animation completes
 */
export const slideInAnimation = (direction, { duration = 1000, amount = 0.45, mode = 'horizontal' } = {}) => {
  return new Promise((resolve) => {
    cancelSlideAnimation();
    
    const viewerEl = document.getElementById('viewer');
    const canvas = viewerEl?.querySelector('canvas');
    
    // Clear any lingering blur-out on background
    if (bgImageContainer) {
      bgImageContainer.classList.remove('blur-out');
    }

    // For fade mode, use JS-driven opacity animation for reliability
    if (mode === 'fade') {
      if (viewerEl) {
        // Remove CSS classes and use inline style for the fade
        viewerEl.classList.remove('slide-out', 'slide-in');
      }
      
      if (canvas) {
        // Start at opacity 0
        canvas.style.opacity = '0';
        canvas.style.transition = `opacity ${duration}ms ease-in`;
        
        // Force reflow to ensure the opacity 0 is applied
        void canvas.offsetHeight;
        
        // Trigger fade in
        canvas.style.opacity = '1';
      }
      
      // Wait for the fade-in to complete, then clean up
      const timeoutId = setTimeout(() => {
        slideAnimationState = null;
        if (canvas) {
          // Remove inline styles so CSS can take over again
          canvas.style.opacity = '';
          canvas.style.transition = '';
        }
        resolve();
      }, duration + 50); // Small buffer for safety
      
      slideAnimationState = {
        fadeTimeoutId: timeoutId,
        startTime: null,
      };
      return;
    }
    
    // For non-fade modes, remove slide-out synchronously before setting up camera
    if (viewerEl) {
      viewerEl.classList.remove('slide-out');
      void viewerEl.offsetHeight;
      viewerEl.classList.add('slide-in');
    }

    if (!camera || !controls) {
      resolve();
      return;
    }

    // End position is current (target) position
    const endPosition = camera.position.clone();
    const endTarget = controls.target.clone();
    const distance = endPosition.distanceTo(endTarget);

    // Calculate direction vectors
    const forward = new THREE.Vector3().subVectors(endTarget, endPosition).normalize();
    const up = camera.up.clone().normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();

    let startPosition, startTarget, orbitAxis, startOrbitAngle;
    
    if (mode === 'zoom') {
      // Zoom mode: start zoomed out (further from target) and zoom in
      const zoomAmount = distance * 0.25; // Start 25% further out
      const zoomOffset = forward.clone().multiplyScalar(-zoomAmount);
      startPosition = endPosition.clone().add(zoomOffset);
      startTarget = endTarget.clone(); // Target stays the same
      orbitAxis = up;
      startOrbitAngle = 0; // No orbit rotation for zoom
    } else if (mode === 'vertical') {
      // Vertical mode: start offset vertically
      const panSign = direction === 'next' ? 1 : -1; // Opposite of slide-out
      const panAmount = distance * amount * panSign;
      const panOffset = up.clone().multiplyScalar(panAmount);
      startPosition = endPosition.clone().add(panOffset);
      startTarget = endTarget.clone().add(panOffset);
      // Orbit around right axis for vertical movement
      orbitAxis = right;
      startOrbitAngle = (Math.PI / 180) * 8 * (direction === 'next' ? -1 : 1);
    } else {
      // Horizontal mode (default): start offset horizontally
      const panSign = direction === 'next' ? -1 : 1;
      const panAmount = distance * amount * panSign;
      const panOffset = right.clone().multiplyScalar(panAmount);
      startPosition = endPosition.clone().add(panOffset);
      startTarget = endTarget.clone().add(panOffset);
      orbitAxis = up;
      startOrbitAngle = (Math.PI / 180) * 8 * (direction === 'next' ? -1 : 1);
    }

    // Set camera to start position
    camera.position.copy(startPosition);
    controls.target.copy(startTarget);
    controls.update();
    requestRender();

    const animate = (timestamp) => {
      if (!slideAnimationState) {
        resolve();
        return;
      }

      if (slideAnimationState.startTime == null) {
        slideAnimationState.startTime = timestamp;
      }

      const elapsed = timestamp - slideAnimationState.startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = easingFunctions['ease-out'](t);

      // Interpolate position and target
      camera.position.lerpVectors(startPosition, endPosition, eased);
      controls.target.lerpVectors(startTarget, endTarget, eased);

      // Add orbit rotation (skip for zoom mode)
      if (startOrbitAngle !== 0) {
        const currentOrbitAngle = startOrbitAngle * (1 - eased);
        const orbitOffset = new THREE.Vector3().subVectors(camera.position, controls.target);
        orbitOffset.applyAxisAngle(orbitAxis, currentOrbitAngle);
        camera.position.copy(controls.target).add(orbitOffset);
      }

      controls.update();
      requestRender();

      if (t < 1) {
        slideAnimationState.frameId = requestAnimationFrame(animate);
      } else {
        slideAnimationState = null;
        // Clean up blur classes after slide-in completes
        const viewerEl = document.getElementById('viewer');
        if (viewerEl) {
          viewerEl.classList.remove('slide-out', 'slide-in');
        }
        if (bgImageContainer) {
          bgImageContainer.classList.remove('blur-out');
        }
        resolve();
      }
    };

    slideAnimationState = {
      frameId: requestAnimationFrame(animate),
      startTime: null,
    };
  });
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

    const currentAnchor = new THREE.Vector3().lerpVectors(anchorAnimationState.startTarget, anchorAnimationState.endTarget, eased);

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
