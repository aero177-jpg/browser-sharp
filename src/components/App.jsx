/**
 * Main App component.
 * Root component that initializes the Three.js viewer and
 * orchestrates the main layout (viewer + side panel/mobile sheet).
 */

import { useEffect, useState, useCallback, useRef } from 'preact/hooks';
import { useStore } from '../store';
import Viewer from './Viewer';
import SidePanel from './SidePanel';
import MobileSheet from './MobileSheet';
import AssetSidebar from './AssetSidebar';
import AssetNavigation from './AssetNavigation';
import { initViewer, startRenderLoop, currentMesh } from '../viewer';
import { resize } from '../fileLoader';
import { resetViewWithImmersive } from '../cameraUtils';
import { setupFullscreenHandler } from '../fullscreenHandler';
import useOutsideClick from '../utils/useOutsideClick';
import useSwipe from '../utils/useSwipe';
import { loadNextAsset, loadPrevAsset } from '../fileLoader';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRotateRight } from '@fortawesome/free-solid-svg-icons';
import { faExpand, faCompress } from '@fortawesome/free-solid-svg-icons';
import { initVrSupport } from '../vrMode';

/** Delay before resize after panel toggle animation completes */
const PANEL_TRANSITION_MS = 350;

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
  
  // Local state for viewer initialization
  const [viewerReady, setViewerReady] = useState(false);
  
  // Track mesh state
  const [hasMesh, setHasMesh] = useState(false);
  const hasMeshRef = useRef(false);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const controlsRef = useRef(null);
  const bottomControlsRef = useRef(null);

  // Outside click handler to close side panel
  useOutsideClick(
    togglePanel,
    ['.side', '.mobile-sheet', '.panel-toggle', '.bottom-page-btn', '.bottom-controls'],
    panelOpen
  );

  // Setup fullscreen handler - re-run when controls mount
  useEffect(() => {
    const viewerEl = document.getElementById('viewer');
    if (!viewerEl) return;

    return setupFullscreenHandler(viewerEl, controlsRef.current, setIsFullscreen);
  }, [hasMesh]); // Re-run when hasMesh changes (when controls appear/disappear)

  /**
   * Track mesh loading state - only update state when value changes
   * to avoid unnecessary re-renders during animations
   */
  useEffect(() => {
    const checkMesh = () => {
      const meshPresent = !!currentMesh;
      if (meshPresent !== hasMeshRef.current) {
        hasMeshRef.current = meshPresent;
        setHasMesh(meshPresent);
      }
    };
    
    // Check immediately and set up interval to poll
    checkMesh();
    const interval = setInterval(checkMesh, 100);
    
    return () => clearInterval(interval);
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
  useSwipe(bottomControlsRef, {
    direction: 'horizontal',
    threshold: 40,
    onSwipe: handleSwipe,
  });

  const handleToggleFullscreen = useCallback(async () => {
    // Use the viewer element itself for fullscreen so the canvas expands
    const viewerEl = document.getElementById('viewer');
    if (!viewerEl) return;

    try {
      if (document.fullscreenElement === viewerEl) {
        await document.exitFullscreen();
      } else {
        await viewerEl.requestFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen toggle failed:', err);
    }
  }, []);

  /**
   * Detects mobile device and orientation.
   */
  useEffect(() => {
    const updateMobileState = () => {
      const mobile = Math.min(window.innerWidth, window.innerHeight) <= 768;
      const portrait = window.innerHeight > window.innerWidth;
      setMobileState(mobile, portrait);
    };
    
    updateMobileState();
    window.addEventListener('resize', updateMobileState);
    return () => window.removeEventListener('resize', updateMobileState);
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
    initVrSupport(viewerEl);
    setViewerReady(true);
    
    // Handle window resize
    window.addEventListener('resize', resize);
    resize();
    
    return () => {
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div class={`page ${panelOpen ? 'panel-open' : ''}`}>
      <AssetSidebar />
      <div class="viewer-container">
        <Viewer viewerReady={viewerReady} />
      </div>
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

        {/* Center: Navigation buttons */}
        <div class="bottom-controls-center">
          <AssetNavigation />
        </div>

        {/* Right: Fullscreen and reset buttons */}
        <div class="bottom-controls-right">
          {hasMesh && (
            <>
              <button
                class="bottom-page-btn"
                onClick={handleToggleFullscreen}
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              >
                <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
              </button>

              <button 
                class="bottom-page-btn" 
                onClick={handleResetView}
                aria-label="Reset camera view"
                title="Reset view (R)"
              >
                <FontAwesomeIcon icon={faRotateRight} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
