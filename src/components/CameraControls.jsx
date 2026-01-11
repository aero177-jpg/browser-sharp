/**
 * Camera controls component for adjusting FOV, orbit range, and view positioning.
 * Provides sliders for camera parameters and buttons for view manipulation.
 */

import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { useStore } from '../store';
import { camera, controls, defaultCamera, defaultControls, dollyZoomBaseDistance, dollyZoomBaseFov, requestRender, THREE, setStereoEffectEnabled } from '../viewer';
import { applyCameraRangeDegrees, restoreHomeView, resetViewWithImmersive } from '../cameraUtils';
import { currentMesh, raycaster, SplatMesh, scene } from '../viewer';
import { updateDollyZoomBaselineFromCamera } from '../viewer';
import { startAnchorTransition } from '../cameraAnimations';
import { enableImmersiveMode, disableImmersiveMode, recenterInImmersiveMode, isImmersiveModeActive, pauseImmersiveMode, resumeImmersiveMode, setImmersiveSensitivityMultiplier } from '../immersiveMode';
import { saveFocusDistance, clearFocusDistance } from '../fileStorage';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { resize } from '../fileLoader';
import { enterVrSession } from '../vrMode';
/** Default orbit range in degrees */
const DEFAULT_CAMERA_RANGE_DEGREES = 8;

/** Focus mode states */
const FOCUS_MODE = {
  IDLE: 'idle',
  SETTING: 'setting',
  SET: 'set',
  CUSTOM: 'custom',
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
  const immersiveSensitivity = useStore((state) => state.immersiveSensitivity);
  const setImmersiveSensitivity = useStore((state) => state.setImmersiveSensitivity);
  const currentFileName = useStore((state) => state.fileInfo?.name);
  const hasCustomFocus = useStore((state) => state.hasCustomFocus);
  const setHasCustomFocus = useStore((state) => state.setHasCustomFocus);
  const showFps = useStore((state) => state.showFps);
  const setShowFps = useStore((state) => state.setShowFps);
  const stereoEnabled = useStore((state) => state.stereoEnabled);
  const setStereoEnabled = useStore((state) => state.setStereoEnabled);
  const vrSupported = useStore((state) => state.vrSupported);
  const vrSessionActive = useStore((state) => state.vrSessionActive);

  // Ref for camera range slider to avoid DOM queries
  const rangeSliderRef = useRef(null);
  
  // Focus depth mode state
  const [focusMode, setFocusMode] = useState(FOCUS_MODE.IDLE);
  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;

  // Sync focus mode with custom focus state from store
  useEffect(() => {
    if (hasCustomFocus && focusMode === FOCUS_MODE.IDLE) {
      setFocusMode(FOCUS_MODE.CUSTOM);
    } else if (!hasCustomFocus && focusMode === FOCUS_MODE.CUSTOM) {
      setFocusMode(FOCUS_MODE.IDLE);
    }
  }, [hasCustomFocus, focusMode]);

  /**
   * Handles click during focus-setting mode.
   * Raycasts to get hit distance, then sets the orbit target along the
   * camera's forward direction to that distance without moving the camera.
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

    // Pause immersive mode briefly to prevent interference
    const wasImmersive = isImmersiveModeActive();
    if (wasImmersive) {
      pauseImmersiveMode();
    }

    // Directly set the target without animating camera position
    controls.target.copy(newTarget);
    controls.update();
    updateDollyZoomBaselineFromCamera();
    requestRender();

    // Resume immersive mode after a brief delay
    if (wasImmersive) {
      setTimeout(() => {
        resumeImmersiveMode();
      }, 100);
    }

    addLog(`Focus depth set: ${hitDistance.toFixed(2)} units`);

    // Persist focus distance for this file
    if (currentFileName && currentFileName !== '-') {
      saveFocusDistance(currentFileName, hitDistance).catch(err => {
        console.warn('Failed to save focus distance:', err);
      });
      setHasCustomFocus(true);
    }
    
    // Transition to "set" state briefly
    setFocusMode(FOCUS_MODE.SET);
    setTimeout(() => {
      setFocusMode(hasCustomFocus ? FOCUS_MODE.CUSTOM : FOCUS_MODE.IDLE);
    }, 1500);
  }, [addLog, currentFileName, hasCustomFocus]);

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
      setFocusMode(hasCustomFocus ? FOCUS_MODE.CUSTOM : FOCUS_MODE.IDLE);
      addLog('Focus mode cancelled');
    }
  }, [addLog, hasCustomFocus]);

  /**
   * Clears custom focus distance override.
   * Removes stored focus distance and reloads the file to apply default focus.
   */
  const handleClearCustomFocus = useCallback(async () => {
    if (currentFileName && currentFileName !== '-') {
      const success = await clearFocusDistance(currentFileName);
      if (success) {
        setHasCustomFocus(false);
        setFocusMode(FOCUS_MODE.IDLE);
        addLog('Custom focus cleared, reload to apply default');
      }
    }
  }, [currentFileName, addLog]);

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

  // Track if we're actively adjusting FOV to pause immersive mode
  const fovAdjustTimeoutRef = useRef(null);

  /**
   * Handles FOV slider changes with dolly-zoom compensation.
   * Maintains the apparent size of objects at the focus point by
   * adjusting camera distance inversely with FOV changes.
   */
  const handleFovChange = (e) => {
    const newFov = Number(e.target.value);
    if (!Number.isFinite(newFov) || !camera || !controls) return;

    // Pause immersive mode during adjustment to prevent judder
    if (isImmersiveModeActive()) {
      pauseImmersiveMode();
      // Clear existing timeout and set a new one
      if (fovAdjustTimeoutRef.current) {
        clearTimeout(fovAdjustTimeoutRef.current);
      }
      fovAdjustTimeoutRef.current = setTimeout(() => {
        resumeImmersiveMode();
        fovAdjustTimeoutRef.current = null;
      }, 300);
    }

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

  // Track if we're actively adjusting camera range to pause immersive mode
  const rangeAdjustTimeoutRef = useRef(null);

  /**
   * Handles orbit range slider changes.
   * Converts linear slider value to non-linear degrees for intuitive control.
   */
  const handleCameraRangeChange = (e) => {
    const val = Number.parseFloat(e.target.value);
    if (!Number.isFinite(val) || !controls) return;

    // Pause immersive mode during adjustment to prevent judder
    if (isImmersiveModeActive()) {
      pauseImmersiveMode();
      if (rangeAdjustTimeoutRef.current) {
        clearTimeout(rangeAdjustTimeoutRef.current);
      }
      rangeAdjustTimeoutRef.current = setTimeout(() => {
        resumeImmersiveMode();
        rangeAdjustTimeoutRef.current = null;
      }, 300);
    }

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
        return 'Focus set';
      case FOCUS_MODE.CUSTOM:
        return 'Custom focus';
      default:
        return 'Set focus depth';
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

  // Pause immersive mode during pinch-zoom gestures on viewer
  useEffect(() => {
    if (!isMobile) return;
    
    const viewerEl = document.getElementById('viewer');
    if (!viewerEl) return;
    
    let pinchResumeTimeout = null;
    let activeTouches = 0;
    
    const handleTouchStart = (e) => {
      activeTouches = e.touches.length;
      // Pause when 2+ fingers touch (pinch gesture starting)
      if (activeTouches >= 2 && isImmersiveModeActive()) {
        pauseImmersiveMode();
        if (pinchResumeTimeout) {
          clearTimeout(pinchResumeTimeout);
          pinchResumeTimeout = null;
        }
      }
    };
    
    const handleTouchEnd = (e) => {
      activeTouches = e.touches.length;
      // Resume shortly after all fingers lifted
      if (activeTouches === 0 && isImmersiveModeActive()) {
        pinchResumeTimeout = setTimeout(() => {
          resumeImmersiveMode();
          pinchResumeTimeout = null;
        }, 200);
      }
    };
    
    viewerEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    viewerEl.addEventListener('touchend', handleTouchEnd, { passive: true });
    viewerEl.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    
    return () => {
      viewerEl.removeEventListener('touchstart', handleTouchStart);
      viewerEl.removeEventListener('touchend', handleTouchEnd);
      viewerEl.removeEventListener('touchcancel', handleTouchEnd);
      if (pinchResumeTimeout) clearTimeout(pinchResumeTimeout);
    };
  }, [isMobile]);

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
   * Handles immersive sensitivity slider changes.
   */
  const handleImmersiveSensitivityChange = useCallback((e) => {
    const value = Number.parseFloat(e.target.value);
    if (!Number.isFinite(value)) return;
    setImmersiveSensitivity(value);
    setImmersiveSensitivityMultiplier(value);
  }, [setImmersiveSensitivity]);

  /** Toggle FPS overlay */
  const handleFpsToggle = useCallback((e) => {
    const enabled = Boolean(e.target.checked);
    setShowFps(enabled);
    const el = document.getElementById('fps-counter');
    if (el) el.style.display = enabled ? 'block' : 'none';
  }, [setShowFps]);

  /**
   * Resets view with immersive mode support.
   * Uses the shared function that pauses orientation input during animation.
   */
  const handleRecenterWithImmersive = useCallback(() => {
    resetViewWithImmersive();
  }, []);

  /** Toggle side-by-side stereo effect; enter fullscreen when enabling */
  const handleStereoToggle = useCallback(async (e) => {
    const enabled = e.target.checked;
    const viewerEl = document.getElementById('viewer');
    if (!viewerEl) return;

    try {
      if (enabled) {
        if (document.fullscreenElement !== viewerEl) {
          await viewerEl.requestFullscreen();
        }
        setStereoEffectEnabled(true);
        setStereoEnabled(true);
        resize();
        addLog('Side-by-side stereo enabled');
      } else {
        setStereoEffectEnabled(false);
        setStereoEnabled(false);
        requestRender();
        if (document.fullscreenElement === viewerEl) {
          await document.exitFullscreen();
        }
        resize();
        addLog('Stereo mode disabled');
      }
    } catch (err) {
      setStereoEffectEnabled(false);
      setStereoEnabled(false);
      e.target.checked = false;
      addLog('Stereo toggle failed');
      console.warn('Stereo toggle failed:', err);
    }
  }, [setStereoEnabled, addLog]);

  // If fullscreen is exited while stereo is on, disable stereo to avoid misalignment
  useEffect(() => {
    const handleFsChange = () => {
      const viewerEl = document.getElementById('viewer');
      const inFullscreen = document.fullscreenElement === viewerEl;
      if (stereoEnabled && !inFullscreen) {
        setStereoEffectEnabled(false);
        setStereoEnabled(false);
        requestRender();
        resize();
      }
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, [stereoEnabled, setStereoEnabled]);

  return (
    <div class="settings-group">
      {/* Collapsible header */}
      <button
        class="group-toggle"
        aria-expanded={cameraSettingsExpanded}
        onClick={toggleCameraSettingsExpanded}
      >
        <span class="settings-eyebrow">Camera Settings</span>
        <FontAwesomeIcon icon={faChevronDown} className="chevron" />
      </button>
      
      {/* Settings content */}
      <div 
        class="group-content" 
        style={{ display: cameraSettingsExpanded ? 'flex' : 'none' }}
      >
        {/* Immersive mode toggle - mobile only */}
        {isMobile && (
          <>
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
            
            {/* Immersive sensitivity slider - shown when immersive mode is active */}
            {immersiveMode && (
              <div class="control-row">
                <span class="control-label">Tilt sensitivity</span>
                <div class="control-track">
                  <input
                    type="range"
                    min="1.0"
                    max="5.0"
                    step="0.1"
                    value={immersiveSensitivity}
                    onInput={handleImmersiveSensitivityChange}
                  />
                  <span class="control-value">
                    {immersiveSensitivity.toFixed(1)}×
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {/* Orbit range control */}
        <div class="control-row">
          <span class="control-label">Show FPS</span>
          <label class="switch">
            <input
              type="checkbox"
              checked={showFps}
              onChange={handleFpsToggle}
            />
            <span class="switch-track" aria-hidden="true" />
          </label>
        </div>

        <div class="control-row">
          <span class="control-label">Side-by-side stereo</span>
          <label class="switch">
            <input
              type="checkbox"
              checked={stereoEnabled}
              onChange={handleStereoToggle}
            />
            <span class="switch-track" aria-hidden="true" />
          </label>
        </div>

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
              {Math.round(fov)}°
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div class="settings-footer">
          <button class="secondary" onClick={handleRecenterWithImmersive}>
            Recenter view
          </button>
          
          <div class="focus-control">
            <button 
              class={`secondary focus-main-btn ${
                focusMode === FOCUS_MODE.SETTING ? 'is-setting' : 
                focusMode === FOCUS_MODE.SET ? 'is-set' : 
                focusMode === FOCUS_MODE.CUSTOM ? 'is-custom' : ''
              }`}
              onClick={focusMode === FOCUS_MODE.SETTING ? handleCancelFocusMode : handleStartFocusMode}
              disabled={focusMode === FOCUS_MODE.SET}
              aria-label={focusMode === FOCUS_MODE.CUSTOM ? "Custom focus - click to set a new focus" : "Set focus depth"}
            >
              {getFocusButtonText()}
            </button>
            
            {focusMode === FOCUS_MODE.CUSTOM && (
              <button
                class="focus-clear-btn"
                onClick={handleClearCustomFocus}
                title="Clear custom focus"
                aria-label="Clear custom focus"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CameraControls;
