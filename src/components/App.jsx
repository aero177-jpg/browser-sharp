/**
 * Main App component.
 * Root component that initializes the Three.js viewer and
 * orchestrates the main layout (viewer + side panel/mobile sheet).
 */

import { useEffect, useState, useCallback, useRef } from 'preact/hooks';
import { useStore } from '../store';
import Viewer from './Viewer';
import TitleCard from './TitleCard';
import SidePanel from './SidePanel';
import MobileSheet from './MobileSheet';
import AssetSidebar from './AssetSidebar';
import AssetNavigation from './AssetNavigation';
import { initViewer, startRenderLoop, currentMesh, camera, controls, defaultCamera, defaultControls, dollyZoomBaseDistance, dollyZoomBaseFov, requestRender, THREE } from '../viewer';
import { resize, loadFromStorageSource, loadNextAsset, loadPrevAsset, handleMultipleFiles } from '../fileLoader';
import { resetViewWithImmersive } from '../cameraUtils';
import { enableImmersiveMode, disableImmersiveMode, setImmersiveSensitivityMultiplier, setTouchPanEnabled, syncImmersiveBaseline } from '../immersiveMode';
import { setupFullscreenHandler } from '../fullscreenHandler';
import useOutsideClick from '../utils/useOutsideClick';
import useSwipe from '../utils/useSwipe';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExpandAlt, faCompressAlt } from '@fortawesome/free-solid-svg-icons';
import { FocusIcon, Rotate3DIcon } from '../icons/customIcons';
import { initVrSupport } from '../vrMode';
import { getSourcesArray } from '../storage/index.js';
import { getSource, createPublicUrlSource, registerSource, saveSource } from '../storage/index.js';
import { getFormatAccept } from '../formats/index';
import ConnectStorageDialog from './ConnectStorageDialog';

/** Delay before resize after panel toggle animation completes */
const PANEL_TRANSITION_MS = 350;

const updateControlSpeedsForFov = (fov) => {
  if (!controls) return;
  const fovScale = THREE.MathUtils.clamp(fov / defaultCamera.fov, 0.05, 2.0);
  controls.rotateSpeed = Math.max(0.02, defaultControls.rotateSpeed * fovScale * 0.45);
  controls.zoomSpeed = Math.max(0.05, defaultControls.zoomSpeed * fovScale * 0.8);
  controls.panSpeed = Math.max(0.05, defaultControls.panSpeed * fovScale * 0.8);
};

function App() {
  // Store state
  const panelOpen = useStore((state) => state.panelOpen);
  const isMobile = useStore((state) => state.isMobile);
  const isPortrait = useStore((state) => state.isPortrait);
  const setMobileState = useStore((state) => state.setMobileState);
  const togglePanel = useStore((state) => state.togglePanel);
  const assets = useStore((state) => state.assets);
  const currentAssetIndex = useStore((state) => state.currentAssetIndex);
  const setCurrentAssetIndex = useStore((state) => state.setCurrentAssetIndex);
  const setAssets = useStore((state) => state.setAssets);
  const toggleAssetSidebar = useStore((state) => state.toggleAssetSidebar);
  const setStatus = useStore((state) => state.setStatus);
  const addLog = useStore((state) => state.addLog);
  const focusSettingActive = useStore((state) => state.focusSettingActive);
  const fov = useStore((state) => state.fov);
  const setFov = useStore((state) => state.setFov);
  const viewerFovSlider = useStore((state) => state.viewerFovSlider);
  const immersiveMode = useStore((state) => state.immersiveMode);
  const setImmersiveMode = useStore((state) => state.setImmersiveMode);
  const immersiveSensitivity = useStore((state) => state.immersiveSensitivity);
  
  // Local state for viewer initialization
  const [viewerReady, setViewerReady] = useState(false);
  // Landing screen visibility (controls TitleCard fade-in/out)
  const [landingVisible, setLandingVisible] = useState(() => assets.length === 0);
  
  // Track mesh state
  const [hasMesh, setHasMesh] = useState(false);
  const hasMeshRef = useRef(false);
  const defaultLoadAttempted = useRef(false);

  // File input + storage dialog state for title card actions
  const fileInputRef = useRef(null);
  const [storageDialogOpen, setStorageDialogOpen] = useState(false);
  const [storageDialogInitialTier, setStorageDialogInitialTier] = useState(null);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const bottomControlsRef = useRef(null);
  const swipeTargetRef = useRef(null);

  // Outside click handler to close side panel
  useOutsideClick(
    togglePanel,
    ['.side', '.mobile-sheet', '.panel-toggle', '.bottom-page-btn', '.bottom-controls'],
    panelOpen && !focusSettingActive
  );

  // Setup fullscreen handler - re-run when controls mount
  useEffect(() => {
    const fullscreenRoot = document.getElementById('app');
    const viewerEl = document.getElementById('viewer');
    if (!fullscreenRoot || !viewerEl) return;

    return setupFullscreenHandler(fullscreenRoot, viewerEl, setIsFullscreen);
  }, [hasMesh]); // Re-run when hasMesh changes (when controls appear/disappear)

  /**
   * Track mesh loading state with stability to prevent flickering.
   * When mesh disappears, wait before updating state to avoid flicker during asset transitions.
   * When mesh appears, update immediately for responsive UI.
   */
  useEffect(() => {
    let timeout = null;
    
    const checkMesh = () => {
      const meshPresent = !!currentMesh;
      
      // Clear any pending timeout
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      
      if (meshPresent !== hasMeshRef.current) {
        if (meshPresent) {
          // Mesh appeared - update immediately
          hasMeshRef.current = true;
          setHasMesh(true);
        } else {
          // Mesh disappeared - wait before updating to avoid flicker during transitions
          timeout = setTimeout(() => {
            hasMeshRef.current = false;
            setHasMesh(false);
          }, 300);
        }
      }
    };
    
    // Check immediately and set up interval to poll
    checkMesh();
    const interval = setInterval(checkMesh, 100);
    
    return () => {
      clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  /**
   * Handles reset view - uses shared function that handles immersive mode.
   */
  const handleResetView = useCallback(() => {
    resetViewWithImmersive();
  }, []);

  /**
   * Handles swipe gestures on bottom controls for asset navigation.
   */
  const handleSwipe = useCallback(({ dir }) => {
    if (assets.length <= 1) return;
    
    if (dir === 'left') {
      loadNextAsset();
    } else if (dir === 'right') {
      loadPrevAsset();
    }
  }, [assets.length]);

  // Setup swipe detection on bottom controls
  useSwipe(swipeTargetRef, {
    direction: 'horizontal',
    threshold: 40,
    onSwipe: handleSwipe,
  });

  const handleToggleFullscreen = useCallback(async () => {
    // Use the app root for fullscreen so all UI stays visible
    const fullscreenRoot = document.getElementById('app');
    const viewerEl = document.getElementById('viewer');
    if (!fullscreenRoot) return;

    try {
      // Fade out before toggling
      if (viewerEl) {
        viewerEl.classList.remove('fs-fade-in');
        viewerEl.classList.add('fs-fade-out');
      }
      
      // Wait for fade-out to complete
      await new Promise((r) => setTimeout(r, 150));
      
      if (document.fullscreenElement === fullscreenRoot) {
        await document.exitFullscreen();
      } else {
        await fullscreenRoot.requestFullscreen();
      }
      
      // After fullscreen settles, resize then fade in
      setTimeout(() => {
        requestAnimationFrame(() => {
          resize();
          requestRender();
          if (viewerEl) {
            viewerEl.classList.remove('fs-fade-out');
            viewerEl.classList.add('fs-fade-in');
            // Clean up class after transition
            setTimeout(() => viewerEl.classList.remove('fs-fade-in'), 250);
          }
        });
      }, 500);
    } catch (err) {
      console.warn('Fullscreen toggle failed:', err);
      // Ensure we restore visibility on error
      if (viewerEl) {
        viewerEl.classList.remove('fs-fade-out');
        viewerEl.classList.add('fs-fade-in');
      }
    }
  }, []);

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

  /**
   * Title card actions: file picker
   */
  const formatAccept = getFormatAccept();

  const handlePickFile = useCallback(() => {
    (async () => {
      await new Promise((r) => setTimeout(r, PANEL_TRANSITION_MS));
      fileInputRef.current?.click();
    })();
  }, []);

  const handleFileChange = useCallback(async (event) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      await handleMultipleFiles(Array.from(files));
      event.target.value = '';
    }
  }, []);

  /**
   * Title card actions: storage dialog
   */
  const handleOpenStorage = useCallback(() => {
    (async () => {
      await new Promise((r) => setTimeout(r, PANEL_TRANSITION_MS));
      setStorageDialogInitialTier(null);
      setStorageDialogOpen(true);
    })();
  }, []);

  const handleCloseStorage = useCallback(() => {
    setStorageDialogOpen(false);
    setStorageDialogInitialTier(null);
  }, []);

  const handleSourceConnect = useCallback(async (source) => {
    setStorageDialogOpen(false);
    setStorageDialogInitialTier(null);
    try {
      await loadFromStorageSource(source);
    } catch (err) {
      addLog('Failed to load from storage: ' + (err?.message || err));
    }
  }, [addLog]);

  /**
   * Title card actions: load demo collection
   */
  const handleLoadDemo = useCallback(async () => {
    try {
      // Fade out landing card before starting load
      setLandingVisible(false);
      await new Promise((r) => setTimeout(r, PANEL_TRANSITION_MS));
      let demo = getSource('demo-public-url');
      if (!demo) {
        // Demo collection (cloud)
        const cloudUrls = [
          'https://pub-db16fc5228e844edb71f8282c2992658.r2.dev/splat_1/_DSF1672.sog',
          'https://pub-db16fc5228e844edb71f8282c2992658.r2.dev/splat_1/_DSF1891.sog',
          'https://pub-db16fc5228e844edb71f8282c2992658.r2.dev/splat_1/_DSF3354.sog',
        ];

        demo = createPublicUrlSource({ id: 'demo-public-url', name: 'Demo URL collection', assetPaths: cloudUrls });
        registerSource(demo);
        try { await saveSource(demo.toJSON()); } catch (err) { console.warn('Failed to persist demo source:', err); }
      }

      try {
        await demo.connect?.();
      } catch (err) {
        console.warn('Demo connect failed (continuing):', err);
      }

      await loadFromStorageSource(demo);
    } catch (err) {
      addLog('Failed to load demo: ' + (err?.message || err));
      console.warn('Failed to load demo:', err);
    }
  }, [addLog]);

  /**
   * Detects mobile device and orientation.
   * Uses orientationchange event and matchMedia for reliable mobile detection.
   */
  useEffect(() => {
    const updateMobileState = () => {
      const mobile = Math.min(window.innerWidth, window.innerHeight) <= 768;
      // Prefer matchMedia for orientation as it's more reliable on mobile
      const portraitQuery = window.matchMedia?.('(orientation: portrait)');
      const portrait = portraitQuery ? portraitQuery.matches : window.innerHeight > window.innerWidth;
      setMobileState(mobile, portrait);
    };
    
    updateMobileState();

    // Listen to resize as fallback
    window.addEventListener('resize', updateMobileState);

    // Dedicated orientation change event for mobile devices
    window.addEventListener('orientationchange', updateMobileState);

    // matchMedia change listener for orientation (most reliable)
    const portraitQuery = window.matchMedia?.('(orientation: portrait)');
    portraitQuery?.addEventListener?.('change', updateMobileState);

    return () => {
      window.removeEventListener('resize', updateMobileState);
      window.removeEventListener('orientationchange', updateMobileState);
      portraitQuery?.removeEventListener?.('change', updateMobileState);
    };
  }, [setMobileState]);

  /**
   * Initialize Three.js viewer on mount.
   * Sets up renderer, camera, controls, and render loop.
   */
  useEffect(() => {
    const viewerEl = document.getElementById('viewer');
    if (!viewerEl) return;
    
    initViewer(viewerEl);
    startRenderLoop();
    void initVrSupport(viewerEl);
    setViewerReady(true);
    
    // Handle window resize
    window.addEventListener('resize', resize);
    resize();
    
    return () => {
      window.removeEventListener('resize', resize);
    };
  }, []);

  // Auto-load the default collection (if any) once the viewer is ready
  useEffect(() => {
    if (!viewerReady || defaultLoadAttempted.current || assets.length > 0) {
      return;
    }

    defaultLoadAttempted.current = true;

    const tryLoadDefaultSource = async () => {
      try {
        const sources = getSourcesArray();
        const defaultSource = sources.find((source) => source?.config?.isDefault);
        if (!defaultSource) return;

        if (!defaultSource.isConnected()) {
          const result = await defaultSource.connect(false);
          if (!result?.success) {
            if (result?.needsPermission) {
              setStatus(`"${defaultSource.name}" needs permission to load the default collection.`);
            } else if (result?.error) {
              setStatus(`Could not load default collection: ${result.error}`);
            }
            return;
          }
        }

        await loadFromStorageSource(defaultSource);
      } catch (err) {
        setStatus(`Failed to load default collection: ${err?.message || err}`);
      }
    };

    tryLoadDefaultSource();
  }, [viewerReady, assets.length, setStatus]);

  // Keep landingVisible in sync: show when no assets, hide when assets present
  useEffect(() => {
    if (assets.length === 0) {
      setLandingVisible(true);
    }
  }, [assets.length]);

  return (
    <div class={`page ${panelOpen ? 'panel-open' : ''}`}>
      <AssetSidebar />
      <input 
        ref={fileInputRef}
        type="file" 
        accept={formatAccept} 
        multiple 
        hidden 
        onChange={handleFileChange}
      />
      <TitleCard
        show={landingVisible && assets.length === 0}
        onPickFile={handlePickFile}
        onOpenStorage={handleOpenStorage}
        onLoadDemo={handleLoadDemo}
      />
        <Viewer viewerReady={viewerReady} />
      {/* Separate swipe target near bottom controls (debug green) */}
      <div class="bottom-swipe-target" ref={swipeTargetRef} />
      {isMobile && isPortrait ? <MobileSheet /> : <SidePanel />}
      {/* Bottom controls container: sidebar index (left), nav (center), fullscreen+reset (right) */}
      <div class="bottom-controls" ref={bottomControlsRef}>
        {/* Left: Asset index button */}
        <div class="bottom-controls-left">
          {assets.length > 0 && (
            <button
              class="bottom-page-btn"
              onClick={toggleAssetSidebar}
              title="Open asset browser"
            >
              {currentAssetIndex + 1} / {assets.length}
            </button>
          )}
        </div>
{hasMesh && assets.length > 0 && (
  <>
        {/* Center: Navigation buttons */}
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

        {/* Right: Fullscreen and reset buttons */}
        <div class="bottom-controls-right">
            <>
            
              <button 
                class="bottom-page-btn" 
                onClick={handleResetView}
                aria-label="Reset camera view"
                title="Reset view (R)"
              >
                <FocusIcon size={18} />
              </button>
             
              <button
                class="bottom-page-btn"
                onClick={handleToggleFullscreen}
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              >
                <FontAwesomeIcon icon={isFullscreen ? faCompressAlt : faExpandAlt} />
              </button>
{isMobile && <button
                class={`bottom-page-btn immersive-toggle ${immersiveMode ? 'is-active' : 'is-inactive'}`}
                onClick={handleImmersiveToggle}
                aria-pressed={immersiveMode}
                aria-label={immersiveMode ? 'Disable immersive mode' : 'Enable immersive mode'}
                title={immersiveMode ? 'Disable immersive mode' : 'Enable immersive mode'}
              >
                <Rotate3DIcon size={18} />
              </button>}
            </>
        </div>
        </>
)}
      </div>

      <ConnectStorageDialog
        isOpen={storageDialogOpen}
        onClose={handleCloseStorage}
        onConnect={handleSourceConnect}
        initialTier={storageDialogInitialTier}
      />
    </div>
  );
}

export default App;
