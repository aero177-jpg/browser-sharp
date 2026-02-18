/**
 * Bottom controls container for navigation, fullscreen, and camera actions.
 */

import { useCallback, useRef } from 'preact/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExpandAlt, faCompressAlt } from '@fortawesome/free-solid-svg-icons';
import { FocusIcon, Rotate3DIcon, MaximizeIcon, MinimizeIcon, slideShowToggleIcon as SlideShowToggleIcon } from '../icons/customIcons';
import { useStore } from '../store';
import { camera, controls, defaultCamera, defaultControls, dollyZoomBaseDistance, dollyZoomBaseFov, requestRender, THREE, resetViewer } from '../viewer';
import { resize, reloadCurrentAsset } from '../fileLoader';
import { resetViewWithImmersive } from '../cameraUtils';
import { enableImmersiveMode, disableImmersiveMode, setImmersiveSensitivityMultiplier, setTouchPanEnabled, syncImmersiveBaseline } from '../immersiveMode';
import { resetSplatManager } from '../splatManager';
import { initVrSupport } from '../vrMode';
import useHasMesh from '../utils/useHasMesh';
import useFullscreenControls from '../utils/useFullscreenControls';
import useControlsReveal from '../utils/useControlsReveal';
import useSlideshowControls from '../utils/useSlideshowControls';
import AssetNavigation from './AssetNavigation';

const updateControlSpeedsForFov = (fov) => {
  if (!controls) return;
  const fovScale = THREE.MathUtils.clamp(fov / defaultCamera.fov, 0.05, 2.0);
  controls.rotateSpeed = Math.max(0.02, defaultControls.rotateSpeed * fovScale * 0.45);
  controls.zoomSpeed = Math.max(0.05, defaultControls.zoomSpeed * fovScale * 0.8);
  controls.panSpeed = Math.max(0.05, defaultControls.panSpeed * fovScale * 0.8);
};

function BottomControls({ onOpenSlideshowOptions }) {
  const assets = useStore((state) => state.assets);
  const currentAssetIndex = useStore((state) => state.currentAssetIndex);
  const toggleAssetSidebar = useStore((state) => state.toggleAssetSidebar);
  const fov = useStore((state) => state.fov);
  const setFov = useStore((state) => state.setFov);
  const viewerFovSlider = useStore((state) => state.viewerFovSlider);
  const immersiveMode = useStore((state) => state.immersiveMode);
  const setImmersiveMode = useStore((state) => state.setImmersiveMode);
  const immersiveSensitivity = useStore((state) => state.immersiveSensitivity);
  const slideshowMode = useStore((state) => state.slideshowMode);
  const slideshowPlaying = useStore((state) => state.slideshowPlaying);
  const setSlideshowMode = useStore((state) => state.setSlideshowMode);
  const isMobile = useStore((state) => state.isMobile);
  const addLog = useStore((state) => state.addLog);

  const hasMesh = useHasMesh();
  const resetHoldTimeout = useRef(null);
  const resetHoldTriggered = useRef(false);

  const {
    isFullscreenMode,
    isRegularFullscreen,
    handleToggleFullscreenMode,
    handleToggleRegularFullscreen,
  } = useFullscreenControls({
    hasMesh,
    resize,
    requestRender,
  });

  const { controlsRevealed, revealBottomControls } = useControlsReveal({ slideshowMode });

  const {
    handleSlideshowButtonClick,
    handleSlideshowHoldStart,
    handleSlideshowHoldEnd,
  } = useSlideshowControls({
    slideshowMode,
    setSlideshowMode,
    onOpenOptions: onOpenSlideshowOptions,
  });

  const handleResetView = useCallback(() => {
    resetViewWithImmersive();
  }, []);

  const handleHardResetView = useCallback(async () => {
    const viewerEl = document.getElementById('viewer');
    if (!viewerEl) return;

    resetViewer(viewerEl, { preserveBackground: true });
    resetSplatManager();
    void initVrSupport(viewerEl);

    await reloadCurrentAsset();
    resize();
    requestRender();
  }, []);

  const handleResetHoldStart = useCallback(() => {
    resetHoldTriggered.current = false;
    if (resetHoldTimeout.current) {
      clearTimeout(resetHoldTimeout.current);
    }
    resetHoldTimeout.current = setTimeout(() => {
      resetHoldTriggered.current = true;
      handleHardResetView();
      resetHoldTimeout.current = null;
    }, 2000);
  }, [handleHardResetView]);

  const handleResetHoldEnd = useCallback(() => {
    if (resetHoldTimeout.current) {
      clearTimeout(resetHoldTimeout.current);
      resetHoldTimeout.current = null;
    }
  }, []);

  const handleResetButtonClick = useCallback(() => {
    if (resetHoldTriggered.current) {
      resetHoldTriggered.current = false;
      return;
    }
    handleResetView();
  }, [handleResetView]);

  const handleOverlayFovChange = useCallback((event) => {
    const newFov = Number(event.target.value);
    if (!Number.isFinite(newFov) || !camera || !controls) return;

    setFov(newFov);

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
    if (immersiveMode) {
      syncImmersiveBaseline();
    }
    requestRender();
  }, [setFov, immersiveMode]);

  const handleImmersiveToggle = useCallback(async () => {
    if (immersiveMode) {
      disableImmersiveMode();
      setImmersiveMode(false);
      addLog('Immersive mode disabled');
      return;
    }

    setTouchPanEnabled(true);
    setImmersiveSensitivityMultiplier(immersiveSensitivity);
    const success = await enableImmersiveMode();
    if (success) {
      setImmersiveMode(true);
      addLog('Immersive mode enabled - tilt device to orbit');
    } else {
      setImmersiveMode(false);
      addLog('Could not enable immersive mode');
    }
  }, [immersiveMode, setImmersiveMode, addLog, immersiveSensitivity]);

  const assetsLength = assets.length;
  return (
    <div
      class={`bottom-controls${slideshowMode && slideshowPlaying ? ' slideshow-hide' : ''}${controlsRevealed ? ' is-revealed' : ''}`}
      onPointerEnter={() => slideshowMode && slideshowPlaying && revealBottomControls(false)}
      onPointerLeave={() => slideshowMode && slideshowPlaying && revealBottomControls(true, 1000)}
      onPointerDown={() => slideshowMode && slideshowPlaying && revealBottomControls(true, 1000)}
    >
      <div class="bottom-controls-right">
        {assetsLength > 0 && (
          <button
            class={`bottom-page-btn immersive-toggle ${slideshowMode ? 'is-active' : 'is-inactive'}`}
            onClick={handleSlideshowButtonClick}
            onPointerDown={handleSlideshowHoldStart}
            onPointerUp={handleSlideshowHoldEnd}
            onPointerLeave={handleSlideshowHoldEnd}
            onPointerCancel={handleSlideshowHoldEnd}
            aria-pressed={slideshowMode}
            aria-label={slideshowMode ? 'Stop slideshow' : 'Start slideshow'}
            title={slideshowMode ? 'Stop slideshow' : 'Start slideshow'}
          >
            <SlideShowToggleIcon size={18} />
          </button>
        )}
        {assetsLength > 0 && (
          <button
            class="bottom-page-btn"
            onClick={toggleAssetSidebar}
            title="Open asset browser"
          >
            {currentAssetIndex + 1} / {assetsLength}
          </button>
        )}
      </div>

      {hasMesh && assetsLength > 0 && (
        <>
          <div class="bottom-controls-center">
            <div class="bottom-controls-center-inner">
              <AssetNavigation />
              {viewerFovSlider && (
                <div class="fov-overlay" role="group" aria-label="Viewer FOV">
                  <input
                    class="fov-overlay-slider"
                    type="range"
                    min="20"
                    max="120"
                    step="1"
                    value={fov}
                    onInput={handleOverlayFovChange}
                  />
                </div>
              )}
            </div>
          </div>

          <div class="bottom-controls-right">
            <button
              class="bottom-page-btn"
              onClick={handleResetButtonClick}
              onPointerDown={handleResetHoldStart}
              onPointerUp={handleResetHoldEnd}
              onPointerLeave={handleResetHoldEnd}
              onPointerCancel={handleResetHoldEnd}
              aria-label="Reset camera view"
              title="Reset view (R)"
            >
              <FocusIcon size={18} />
            </button>

            <button
              class="bottom-page-btn"
              onClick={handleToggleFullscreenMode}
              aria-label={isFullscreenMode ? 'Exit fullscreen mode' : 'Enter fullscreen mode'}
              title={isFullscreenMode ? 'Exit fullscreen mode' : 'Enter fullscreen mode'}
            >
              <FontAwesomeIcon icon={isFullscreenMode ? faCompressAlt : faExpandAlt} />
            </button>

            <button
              class="bottom-page-btn"
              onClick={handleToggleRegularFullscreen}
              aria-label={isRegularFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              title={isRegularFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isRegularFullscreen ? <MinimizeIcon size={18} /> : <MaximizeIcon size={18} />}
            </button>

            {isMobile && (
              <button
                class={`bottom-page-btn immersive-toggle ${immersiveMode ? 'is-active' : 'is-inactive'}`}
                onClick={handleImmersiveToggle}
                aria-pressed={immersiveMode}
                aria-label={immersiveMode ? 'Disable immersive mode' : 'Enable immersive mode'}
                title={immersiveMode ? 'Disable immersive mode' : 'Enable immersive mode'}
              >
                <Rotate3DIcon size={18} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default BottomControls;
