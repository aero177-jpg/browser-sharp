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
import { initViewer, startRenderLoop, currentMesh } from '../viewer';
import { resize, loadFromStorageSource, loadNextAsset, loadPrevAsset, handleMultipleFiles } from '../fileLoader';
import { resetViewWithImmersive } from '../cameraUtils';
import { setupFullscreenHandler } from '../fullscreenHandler';
import useOutsideClick from '../utils/useOutsideClick';
import useSwipe from '../utils/useSwipe';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRotateRight } from '@fortawesome/free-solid-svg-icons';
import { faExpand, faCompress } from '@fortawesome/free-solid-svg-icons';
import { initVrSupport } from '../vrMode';
import { getSourcesArray } from '../storage/index.js';
import { getSource, createPublicUrlSource, registerSource, saveSource } from '../storage/index.js';
import { getFormatAccept } from '../formats/index';
import ConnectStorageDialog from './ConnectStorageDialog';

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
  const setStatus = useStore((state) => state.setStatus);
  const addLog = useStore((state) => state.addLog);
  
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

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const controlsRef = useRef(null);
  const bottomControlsRef = useRef(null);
  const swipeTargetRef = useRef(null);

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
   * Title card actions: file picker
   */
  const formatAccept = getFormatAccept();

  const handlePickFile = useCallback(() => {
    (async () => {
      setLandingVisible(false);
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
      setStorageDialogOpen(true);
    })();
  }, []);

  const handleCloseStorage = useCallback(() => {
    setStorageDialogOpen(false);
  }, []);

  const handleSourceConnect = useCallback(async (source) => {
    setStorageDialogOpen(false);
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
        const demoUrls = [
          'https://xifbwkfsvurtuugvseqi.supabase.co/storage/v1/object/public/testbucket/sog_folder/_DSF1672.sog',
          'https://xifbwkfsvurtuugvseqi.supabase.co/storage/v1/object/public/testbucket/sog_folder/_DSF1749.sog',
          'https://xifbwkfsvurtuugvseqi.supabase.co/storage/v1/object/public/testbucket/sog_folder/_DSF1891.sog',
          'https://xifbwkfsvurtuugvseqi.supabase.co/storage/v1/object/public/testbucket/sog_folder/_DSF2158.sog',
          'https://xifbwkfsvurtuugvseqi.supabase.co/storage/v1/object/public/testbucket/sog_folder/_DSF2784.sog',
          'https://xifbwkfsvurtuugvseqi.supabase.co/storage/v1/object/public/testbucket/sog_folder/_DSF2810-Pano.sog',
          'https://xifbwkfsvurtuugvseqi.supabase.co/storage/v1/object/public/testbucket/sog_folder/_DSF3354.sog',
          'https://xifbwkfsvurtuugvseqi.supabase.co/storage/v1/object/public/testbucket/sog_folder/_DSF7664.sog',
          'https://xifbwkfsvurtuugvseqi.supabase.co/storage/v1/object/public/testbucket/sog_folder/20221007203015_IMG_0329.sog',
          'https://xifbwkfsvurtuugvseqi.supabase.co/storage/v1/object/public/testbucket/sog_folder/APC_0678.sog',
          'https://xifbwkfsvurtuugvseqi.supabase.co/storage/v1/object/public/testbucket/sog_folder/IMG_9728.sog',
          'https://xifbwkfsvurtuugvseqi.supabase.co/storage/v1/object/public/testbucket/sog_folder/PXL_20230822_061301870.sog',
          'https://xifbwkfsvurtuugvseqi.supabase.co/storage/v1/object/public/testbucket/sog_folder/PXL_20240307_200213904.sog',
        ];
        demo = createPublicUrlSource({ id: 'demo-public-url', name: 'Demo URL collection', assetPaths: demoUrls });
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

        {/* Center: Navigation buttons */}
        <div class="bottom-controls-center">
          <AssetNavigation />
        </div>

        {/* Right: Fullscreen and reset buttons */}
        <div class="bottom-controls-right">
          {hasMesh && assets.length > 0 && (
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

      <ConnectStorageDialog
        isOpen={storageDialogOpen}
        onClose={handleCloseStorage}
        onConnect={handleSourceConnect}
      />
    </div>
  );
}

export default App;
