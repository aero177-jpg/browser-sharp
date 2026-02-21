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
import { initViewer, startRenderLoop, requestRender } from '../viewer';
import { resize, loadFromStorageSource, loadNextAsset, loadPrevAsset } from '../fileLoader';
import { resetViewWithImmersive } from '../cameraUtils';
import useOutsideClick from '../utils/useOutsideClick';
import useSwipe from '../utils/useSwipe';
import { initVrSupport } from '../vrMode';
import { loadR2Settings } from '../storage/r2Settings.js';
import ConnectStorageDialog from './ConnectStorageDialog';
import ControlsModal from './ControlsModal';
import { useCollectionUploadFlow } from './useCollectionUploadFlow.js';
import { useViewerDrop } from './useViewerDrop.jsx';
import PwaReloadPrompt from './PwaReloadPrompt';
import PwaInstallPrompt from './PwaInstallPrompt';
import SlideshowOptionsModal from './SlideshowOptionsModal';
import AddDemoCollectionsModal from './AddDemoCollectionsModal';
import { useCollectionRouting } from './useCollectionRouting.js';
import { getImportUrlFromLocation, clearImportUrlFromLocation } from '../utils/importFromUrl.js';
import ImportFromUrlModal from './ImportFromUrlModal';
import { resetLandingView } from '../utils/resetLandingView.js';
import BottomControls from './BottomControls';
import useMobileState from '../utils/useMobileState';
import { fadeInViewer, fadeOutViewer, restoreViewerVisibility } from '../utils/viewerFade';
import useDemoCollections from './useDemoCollections';

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
  const setCurrentAssetIndex = useStore((state) => state.setCurrentAssetIndex);
  const setActiveSourceId = useStore((state) => state.setActiveSourceId);
  const setAssets = useStore((state) => state.setAssets);
  const setStatus = useStore((state) => state.setStatus);
  const addLog = useStore((state) => state.addLog);
  const activeSourceId = useStore((state) => state.activeSourceId);
  const focusSettingActive = useStore((state) => state.focusSettingActive);
  const controlsModalOpen = useStore((state) => state.controlsModalOpen);
  const setControlsModalOpen = useStore((state) => state.setControlsModalOpen);
  const controlsModalDefaultSubsections = useStore((state) => state.controlsModalDefaultSubsections);
  
  // Local state for viewer initialization
  const [viewerReady, setViewerReady] = useState(false);
  // Landing screen visibility (controls TitleCard fade-in/out)
  const [landingVisible, setLandingVisible] = useState(() => assets.length === 0 && !activeSourceId);
  const [hasDefaultSource, setHasDefaultSource] = useState(false);
  const isLandingEmptyState = landingVisible && assets.length === 0 && !activeSourceId;
  
  const defaultLoadAttempted = useRef(false);

  // File input + storage dialog state for title card actions
  const [storageDialogOpen, setStorageDialogOpen] = useState(false);
  const [storageDialogInitialTier, setStorageDialogInitialTier] = useState(null);

  // Fullscreen state
  const swipeTargetRef = useRef(null);

  const [slideshowOptionsOpen, setSlideshowOptionsOpen] = useState(false);

  // Remote import via ?import= query param
  const [pendingImportUrl, setPendingImportUrl] = useState(null);

  // Outside click handler to close side panel
  useOutsideClick(
    togglePanel,
    ['.side', '.mobile-sheet', '.panel-toggle', '.bottom-page-btn', '.bottom-controls', '.modal-overlay', '.modal-content'],
    panelOpen && !focusSettingActive
  );

  const {
    demoCollectionsModalOpen,
    setDemoCollectionsModalOpen,
    handleLoadDemo,
    handleInstallDemoCollections,
    demoCollectionOptions,
  } = useDemoCollections({
    addLog,
    setLandingVisible,
    panelTransitionMs: PANEL_TRANSITION_MS,
  });

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

  const handleDeviceRotate = useCallback(async () => {
    const viewerEl = document.getElementById('viewer');
    if (!viewerEl) return;

    try {
      await fadeOutViewer(viewerEl);
      fadeInViewer(viewerEl, { resize, requestRender, settleMs: 0 });
    } catch (err) {
      console.warn('Device rotation handling failed:', err);
      restoreViewerVisibility(viewerEl);
    }
  }, [resize, requestRender]);

  /**
   * Title card actions: file picker
   */
  const {
    uploadInputRef,
    uploadAccept,
    openUploadPicker,
    handleUploadChange,
    uploadModal,
    handleAssets,
    handleImages,
  } = useCollectionUploadFlow({
    queueAction: 'replace',
    allowAssets: true,
    allowImages: true,
    onError: (message) => setStatus(message),
  });

  const handlePickFile = useCallback(() => {
    (async () => {
      await new Promise((r) => setTimeout(r, PANEL_TRANSITION_MS));
      openUploadPicker();
    })();
  }, [openUploadPicker]);

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
   * Handle selecting a source from the collections modal
   */
  const handleSelectSource = useCallback(async (source) => {
    try {
      setLandingVisible(false);

      const r2Settings = loadR2Settings();
      const isR2Locked = source?.type === 'r2-bucket'
        && Boolean(r2Settings?.requiresPassword)
        && r2Settings?.accountId === source?.config?.config?.accountId
        && r2Settings?.bucket === source?.config?.config?.bucket;

      if (isR2Locked) {
        setAssets([]);
        setCurrentAssetIndex(-1);
        setActiveSourceId(source.id);
        return;
      }

      await loadFromStorageSource(source);
    } catch (err) {
      addLog('Failed to load from source: ' + (err?.message || err));
      console.warn('Failed to load from source:', err);
    }
  }, [addLog, setActiveSourceId, setAssets, setCurrentAssetIndex]);

  /**
   * Handle opening cloud GPU dialog from collections modal
   */
  const handleOpenCloudGpu = useCallback(() => {
    setStorageDialogInitialTier('cloud-gpu');
    setStorageDialogOpen(true);
  }, []);

  useMobileState({
    setMobileState,
    onRotate: handleDeviceRotate,
  });

  const { dropOverlay, dropModal } = useViewerDrop({
    activeSourceId,
    setStatus,
    handleAssets,
    handleImages,
  });

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

  useCollectionRouting({
    viewerReady,
    activeSourceId,
    setHasDefaultSource,
    setLandingVisible,
    addLog,
  });

  // Detect ?import= query parameter once the viewer is ready
  useEffect(() => {
    if (!viewerReady) return;
    const url = getImportUrlFromLocation();
    if (url) {
      setPendingImportUrl(url);
    }
  }, [viewerReady]);

  // Auto-load the default collection (if any) once the viewer is ready
  useEffect(() => {
    // Routing contract:
    // - "/" stays on home
    // - "/:collection" attempts to load that collection
    // So default-source autoload is intentionally disabled.
    void viewerReady;
    void defaultLoadAttempted.current;
    void assets.length;
    void setStatus;
  }, [viewerReady, assets.length, setStatus]);

  // Keep landingVisible in sync: show when no assets, hide when assets present
  useEffect(() => {
    if (hasDefaultSource) {
      setLandingVisible(false);
      return;
    }
    if (assets.length === 0 && !activeSourceId) {
      setLandingVisible(true);
    } else if (activeSourceId) {
      setLandingVisible(false);
    }
  }, [assets.length, activeSourceId, hasDefaultSource]);

  useEffect(() => {
    if (!isLandingEmptyState) return;

    resetLandingView();
    resetViewWithImmersive();
  }, [isLandingEmptyState]);

  return (
    <div class={`page ${panelOpen ? 'panel-open' : ''} ${isLandingEmptyState ? 'landing-empty' : ''}`}>
      <AssetSidebar />
      <input 
        ref={uploadInputRef}
        type="file" 
        {...(uploadAccept ? { accept: uploadAccept } : {})}
        multiple 
        hidden 
        onChange={handleUploadChange}
      />
      <TitleCard
        show={isLandingEmptyState}
        onPickFile={handlePickFile}
        onOpenStorage={handleOpenStorage}
        onLoadDemo={handleLoadDemo}
        onSelectSource={handleSelectSource}
        onOpenCloudGpu={handleOpenCloudGpu}
        onInstallDemoCollections={handleInstallDemoCollections}
        demoCollectionOptions={demoCollectionOptions}
      />
        <Viewer viewerReady={viewerReady} dropOverlay={dropOverlay} />
      {/* Separate swipe target near bottom controls (debug green) */}
      {!isLandingEmptyState && (
        <div class="bottom-swipe-target" ref={swipeTargetRef} />
      )}
      {!isLandingEmptyState && (isMobile && isPortrait ? <MobileSheet /> : <SidePanel />)}
      <BottomControls onOpenSlideshowOptions={() => setSlideshowOptionsOpen(true)} />

      <ConnectStorageDialog
        isOpen={storageDialogOpen}
        onClose={handleCloseStorage}
        onConnect={handleSourceConnect}
        initialTier={storageDialogInitialTier}
      />
      <ControlsModal
        isOpen={controlsModalOpen}
        onClose={() => setControlsModalOpen(false)}
        defaultOpenSubsections={controlsModalDefaultSubsections}
      />
      <SlideshowOptionsModal
        isOpen={slideshowOptionsOpen}
        onClose={() => setSlideshowOptionsOpen(false)}
      />
      <AddDemoCollectionsModal
        isOpen={demoCollectionsModalOpen}
        onClose={() => setDemoCollectionsModalOpen(false)}
        onInstall={handleInstallDemoCollections}
        options={demoCollectionOptions}
      />
      <PwaReloadPrompt />
      <PwaInstallPrompt />
      <ImportFromUrlModal
        isOpen={Boolean(pendingImportUrl)}
        importUrl={pendingImportUrl}
        onClose={() => {
          setPendingImportUrl(null);
          clearImportUrlFromLocation();
        }}
        addLog={addLog}
      />
      {dropModal}
      {uploadModal}
    </div>
  );
}

export default App;
