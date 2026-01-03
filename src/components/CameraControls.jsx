/**
 * Camera controls component for adjusting FOV, orbit range, and view positioning.
 * Provides sliders for camera parameters and buttons for view manipulation.
 */

import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { useStore } from '../store';
import { camera, controls, defaultCamera, defaultControls, dollyZoomBaseDistance, dollyZoomBaseFov, requestRender, THREE } from '../viewer';
import { applyCameraRangeDegrees, restoreHomeView } from '../cameraUtils';
import { currentMesh, raycaster, SplatMesh, scene } from '../viewer';
import { updateDollyZoomBaselineFromCamera } from '../viewer';
import { startAnchorTransition } from '../cameraAnimations';
import { enableImmersiveMode, disableImmersiveMode, recenterInImmersiveMode, isImmersiveModeActive } from '../immersiveMode';

/** Default orbit range in degrees */
const DEFAULT_CAMERA_RANGE_DEGREES = 8;

/** Focus mode states */
const FOCUS_MODE = {
  IDLE: 'idle',
  SETTING: 'setting',
  SET: 'set',
};

/**
 * Clamps a value between min and max bounds.
 * @param {number} value - The value to clamp
 * @param {number} min - Minimum bound
 * @param {number} max - Maximum bound
 * @returns {number} Clamped value
 */
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Converts a linear slider value (0-180) to non-linear degrees.
 * Uses piecewise linear mapping for finer control at lower values:
 * - 0-50% slider → 0-10° (fine control)
 * - 50-85% slider → 10-30° (medium control)
 * - 85-100% slider → 30-180° (coarse control)
 * @param {number} sliderValue - Slider value between 0 and 180
 * @returns {number} Degrees between 0 and 180
 */
const sliderValueToDegrees = (sliderValue) => {
  const t = clamp(sliderValue / 180, 0, 1);
  if (t <= 0.5) {
    return 20 * t;
  }
  if (t <= 0.85) {
    const localT = (t - 0.5) / 0.35;
    return 10 + 20 * localT;
  }
  const localT = (t - 0.85) / 0.15;
  return 30 + 150 * localT;
};

/**
 * Converts degrees to a linear slider value (0-180).
 * Inverse of sliderValueToDegrees for initializing slider position.
 * @param {number} degrees - Degrees between 0 and 180
 * @returns {number} Slider value between 0 and 180
 */
const degreesToSliderValue = (degrees) => {
  const clamped = clamp(degrees, 0, 180);
  if (clamped <= 10) {
    return (clamped / 20) * 180;
  }
  if (clamped <= 30) {
    const localT = (clamped - 10) / 20;
    return (0.5 + 0.35 * localT) * 180;
  }
  const localT = (clamped - 30) / 150;
  return (0.85 + 0.15 * localT) * 180;
};

/**
 * Formats degrees for display, using 1 decimal place for small values.
 * @param {number} degrees - Angle in degrees
 * @returns {string} Formatted string
 */
const formatDegrees = (degrees) => (degrees < 10 ? degrees.toFixed(1) : degrees.toFixed(0));

/**
 * Updates orbit controls speed based on current FOV.
 * Slower controls at narrower FOV for precision, faster at wider FOV.
 * @param {number} fov - Current field of view in degrees
 */
const updateControlSpeedsForFov = (fov) => {
  if (!controls) return;
  const fovScale = THREE.MathUtils.clamp(fov / defaultCamera.fov, 0.05, 2.0);
  controls.rotateSpeed = Math.max(0.02, defaultControls.rotateSpeed * fovScale * 0.45);
  controls.zoomSpeed = Math.max(0.05, defaultControls.zoomSpeed * fovScale * 0.8);
  controls.panSpeed = Math.max(0.05, defaultControls.panSpeed * fovScale * 0.8);
};

function CameraControls() {
  // Store state and actions
  const fov = useStore((state) => state.fov);
  const setFov = useStore((state) => state.setFov);
  const cameraRange = useStore((state) => state.cameraRange);
  const setCameraRange = useStore((state) => state.setCameraRange);
  const addLog = useStore((state) => state.addLog);
  const cameraSettingsExpanded = useStore((state) => state.cameraSettingsExpanded);
  const toggleCameraSettingsExpanded = useStore((state) => state.toggleCameraSettingsExpanded);
  const isMobile = useStore((state) => state.isMobile);
  const immersiveMode = useStore((state) => state.immersiveMode);
  const setImmersiveMode = useStore((state) => state.setImmersiveMode);

  // Ref for camera range slider to avoid DOM queries
  const rangeSliderRef = useRef(null);
  
  // Focus depth mode state
  const [focusMode, setFocusMode] = useState(FOCUS_MODE.IDLE);
  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;

  /**
   * Handles click during focus-setting mode.
   * Raycasts to get hit distance, then moves the orbit target along the
   * camera's forward direction to that distance, preserving pan/framing.
   */
  const handleFocusClick = useCallback((e) => {
    if (focusModeRef.current !== FOCUS_MODE.SETTING) return;
    if (!currentMesh || !camera || !raycaster || !controls) return;

    // Get canvas-relative coordinates
    const viewerEl = document.getElementById('viewer');
    if (!viewerEl) return;
    
    const rect = viewerEl.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    // Raycast from click position
    const clickRay = new THREE.Vector2(x, y);
    raycaster.setFromCamera(clickRay, camera);
    const intersects = [];
    raycaster.intersectObjects(scene.children, true, intersects);
    const splatHit = intersects.find((hit) => hit.object instanceof SplatMesh) ?? null;

    if (!splatHit) {
      addLog('No surface hit - click on the model');
      return;
    }

    // Get the hit distance
    const hitDistance = splatHit.distance;
    
    // Calculate new target position along camera's forward direction at hit distance
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    const newTarget = camera.position.clone().addScaledVector(cameraDirection, hitDistance);

    // Animate to new target (depth only - preserves apparent framing)
    startAnchorTransition(newTarget, {
      duration: 400,
      onComplete: () => {
        updateDollyZoomBaselineFromCamera();
        requestRender();
      },
    });

    addLog(`Focus depth set: ${hitDistance.toFixed(2)} units`);
    
    // Transition to "set" state briefly
    setFocusMode(FOCUS_MODE.SET);
    setTimeout(() => {
      setFocusMode(FOCUS_MODE.IDLE);
    }, 1500);
  }, [addLog]);

  /**
   * Activates focus-setting mode.
   * User can then click anywhere on the model to set focus depth.
   */
  const handleStartFocusMode = () => {
    if (!currentMesh) {
      addLog('No model loaded');
      return;
    }
    setFocusMode(FOCUS_MODE.SETTING);
    addLog('Click on the model to set focus depth');
  };

  /**
   * Cancels focus-setting mode (e.g., pressing Escape).
   */
  const handleCancelFocusMode = useCallback(() => {
    if (focusModeRef.current === FOCUS_MODE.SETTING) {
      setFocusMode(FOCUS_MODE.IDLE);
      addLog('Focus mode cancelled');
    }
  }, [addLog]);

  // Set up click listener and cursor when in focus-setting mode
  useEffect(() => {
    const viewerEl = document.getElementById('viewer');
    if (!viewerEl) return;

    if (focusMode === FOCUS_MODE.SETTING) {
      viewerEl.style.cursor = 'crosshair';
      viewerEl.addEventListener('click', handleFocusClick);
      
      // Cancel on Escape key
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          handleCancelFocusMode();
        }
      };
      document.addEventListener('keydown', handleKeyDown);

      return () => {
        viewerEl.style.cursor = '';
        viewerEl.removeEventListener('click', handleFocusClick);
        document.removeEventListener('keydown', handleKeyDown);
      };
    } else {
      viewerEl.style.cursor = '';
    }
  }, [focusMode, handleFocusClick, handleCancelFocusMode]);

  /**
   * Handles FOV slider changes with dolly-zoom compensation.
   * Maintains the apparent size of objects at the focus point by
   * adjusting camera distance inversely with FOV changes.
   */
  const handleFovChange = (e) => {
    const newFov = Number(e.target.value);
    if (!Number.isFinite(newFov) || !camera || !controls) return;

    setFov(newFov);

    // Apply dolly-zoom effect to maintain object size at focus point
    if (dollyZoomBaseDistance && dollyZoomBaseFov) {
      const baseTan = Math.tan(THREE.MathUtils.degToRad(dollyZoomBaseFov / 2));
      const newTan = Math.tan(THREE.MathUtils.degToRad(newFov / 2));
      const newDistance = dollyZoomBaseDistance * (baseTan / newTan);

      const direction = new THREE.Vector3()
        .subVectors(camera.position, controls.target)
        .normalize();
      camera.position.copy(controls.target).addScaledVector(direction, newDistance);
    }

    camera.fov = newFov;
    camera.updateProjectionMatrix();
    updateControlSpeedsForFov(newFov);
    controls.update();
    requestRender();
  };

  /**
   * Handles orbit range slider changes.
   * Converts linear slider value to non-linear degrees for intuitive control.
   */
  const handleCameraRangeChange = (e) => {
    const val = Number.parseFloat(e.target.value);
    if (!Number.isFinite(val) || !controls) return;

    const degrees = sliderValueToDegrees(val);
    setCameraRange(degrees);
    applyCameraRangeDegrees(degrees);
  };

  /**
   * Resets camera to the stored home view position.
   */
  const handleRecenter = () => {
    if (!camera || !controls) return;
    restoreHomeView();
  };

  /**
   * Returns the appropriate button text based on focus mode state.
   */
  const getFocusButtonText = () => {
    switch (focusMode) {
      case FOCUS_MODE.SETTING:
        return 'Click model...';
      case FOCUS_MODE.SET:
        return 'Focus set ✓';
      default:
        return 'Set focus depth';
    }
  };

  /**
   * Returns the appropriate button class based on focus mode state.
   */
  const getFocusButtonClass = () => {
    switch (focusMode) {
      case FOCUS_MODE.SETTING:
        return 'secondary focus-btn focus-setting';
      case FOCUS_MODE.SET:
        return 'secondary focus-btn focus-set';
      default:
        return 'secondary focus-btn';
    }
  };

  // Initialize camera range on mount
  useEffect(() => {
    if (!controls || !rangeSliderRef.current) return;

    const initialSliderValue = degreesToSliderValue(DEFAULT_CAMERA_RANGE_DEGREES);
    rangeSliderRef.current.value = String(initialSliderValue.toFixed(1));

    const degrees = sliderValueToDegrees(initialSliderValue);
    setCameraRange(degrees);
    applyCameraRangeDegrees(degrees);
  }, [setCameraRange]);

  /**
   * Handles toggling immersive mode.
   * Enables device orientation camera control.
   */
  const handleImmersiveToggle = useCallback(async (e) => {
    const enabled = e.target.checked;
    if (enabled) {
      const success = await enableImmersiveMode();
      if (success) {
        setImmersiveMode(true);
        addLog('Immersive mode enabled - tilt device to orbit');
      } else {
        e.target.checked = false;
        addLog('Could not enable immersive mode');
      }
    } else {
      disableImmersiveMode();
      setImmersiveMode(false);
      addLog('Immersive mode disabled');
    }
  }, [setImmersiveMode, addLog]);

  /**
   * Resets immersive mode baseline on recenter.
   * Pauses orientation input during animation to avoid conflicts.
   */
  const handleRecenterWithImmersive = useCallback(() => {
    if (isImmersiveModeActive()) {
      // Use special recenter that pauses orientation input
      recenterInImmersiveMode(handleRecenter, 600);
    } else {
      handleRecenter();
    }
  }, []);

  return (
    <div class="settings-group">
      {/* Collapsible header */}
      <button
        class="group-toggle"
        aria-expanded={cameraSettingsExpanded}
        onClick={toggleCameraSettingsExpanded}
      >
        <span class="settings-eyebrow">Camera Settings</span>
        <span class="chevron" />
      </button>
      
      {/* Settings content */}
      <div 
        class="group-content" 
        style={{ display: cameraSettingsExpanded ? 'flex' : 'none' }}
      >
        {/* Immersive mode toggle - mobile only */}
        {isMobile && (
          <div class="control-row animate-toggle-row">
            <span class="control-label">Immersive mode</span>
            <label class="switch">
              <input
                type="checkbox"
                checked={immersiveMode}
                onChange={handleImmersiveToggle}
              />
              <span class="switch-track" aria-hidden="true" />
            </label>
          </div>
        )}

        {/* Orbit range control */}
        <div class="control-row camera-range-controls">
          <span class="control-label">Orbit range</span>
          <div class="control-track">
            <input
              ref={rangeSliderRef}
              type="range"
              min="0"
              max="180"
              step="0.1"
              value={degreesToSliderValue(cameraRange)}
              onInput={handleCameraRangeChange}
            />
            <span class="control-value">
              {formatDegrees(cameraRange)}°
            </span>
          </div>
        </div>

        {/* FOV control */}
        <div class="control-row">
          <span class="control-label">FOV</span>
          <div class="control-track">
            <input
              type="range"
              min="20"
              max="120"
              step="1"
              value={fov}
              onInput={handleFovChange}
            />
            <span class="control-value">
              {fov}°
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div class="settings-footer">
          <button class="secondary" onClick={handleRecenterWithImmersive}>
            Recenter view
          </button>
          <button 
            class={getFocusButtonClass()}
            onClick={focusMode === FOCUS_MODE.SETTING ? handleCancelFocusMode : handleStartFocusMode}
            disabled={focusMode === FOCUS_MODE.SET}
          >
            {getFocusButtonText()}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CameraControls;
