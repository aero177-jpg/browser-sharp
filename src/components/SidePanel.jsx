/**
 * Side panel component for desktop and landscape modes.
 * Contains file upload controls, debug info display, and settings panels.
 * Collapsible via toggle button.
 */

import { useState, useCallback, useRef } from 'preact/hooks';
import { useStore } from '../store';
import CameraControls from './CameraControls';
import AnimationSettings from './AnimationSettings';
import DebugSettings from './DebugSettings';
import StorageSourceList from './StorageSourceList';
import ConnectStorageDialog from './ConnectStorageDialog';
import { loadFromStorageSource } from '../fileLoader';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft } from '@fortawesome/free-solid-svg-icons';

function SidePanel() {
  // Store state
  const status = useStore((state) => state.status);
  const fileInfo = useStore((state) => state.fileInfo);
  const isMobile = useStore((state) => state.isMobile);
  const panelOpen = useStore((state) => state.panelOpen); // assumes this exists
  // Store actions
  const togglePanel = useStore((state) => state.togglePanel);

  const hoverOpenTimeoutRef = useRef(null);

  // Open the panel if it is currently closed (used for hover target)
  const openPanel = useCallback(() => {
    if (!panelOpen) {
      togglePanel();
    }
  }, [panelOpen, togglePanel]);

  const handleHoverEnter = useCallback(() => {
    if (hoverOpenTimeoutRef.current) {
      clearTimeout(hoverOpenTimeoutRef.current);
    }
    hoverOpenTimeoutRef.current = setTimeout(() => {
      openPanel();
      hoverOpenTimeoutRef.current = null;
    }, 500);
  }, [openPanel]);

  const handleHoverLeave = useCallback(() => {
    if (hoverOpenTimeoutRef.current) {
      clearTimeout(hoverOpenTimeoutRef.current);
      hoverOpenTimeoutRef.current = null;
    }
  }, []);
  
  // Storage dialog state
  const [storageDialogOpen, setStorageDialogOpen] = useState(false);
  const [storageDialogInitialTier, setStorageDialogInitialTier] = useState(null);
  
  const handleOpenStorageDialog = useCallback(() => {
    setStorageDialogInitialTier(null);
    setStorageDialogOpen(true);
  }, []);

  const handleOpenCloudGpuDialog = useCallback(() => {
    setStorageDialogInitialTier('cloud-gpu');
    setStorageDialogOpen(true);
  }, []);
  
  const handleCloseStorageDialog = useCallback(() => {
    setStorageDialogOpen(false);
    setStorageDialogInitialTier(null);
  }, []);
  
  const handleSourceConnect = useCallback((source) => {
    // Load assets from the newly connected source
    loadFromStorageSource(source);
  }, []);
  
  const handleSelectSource = useCallback((source) => {
    // Load assets from selected source
    loadFromStorageSource(source);
  }, []);

  return (
    <>
      {/* Panel toggle button */}
      <button
        class={`panel-toggle${panelOpen ? ' open' : ''}`}
        aria-label="Toggle info panel"
        type="button"
        onClick={togglePanel}
      >
        <FontAwesomeIcon icon={faChevronLeft} />
      </button>
      {/* Right-edge hover target to open the side panel */}
        <div
            class="sidepanel-hover-target"
            onMouseEnter={handleHoverEnter}
            onMouseLeave={handleHoverLeave}
          />
      {/* Side panel content */}
      <div class="side">
        {/* File info display - hidden on mobile */}
        {!isMobile && (
          <div class="debug">
            <div class="row">
              <span>Status</span>
              <span>{status}</span>
            </div>
            <div class="row">
              <span>File</span>
              <span>{fileInfo.name}</span>
            </div>
            <div class="row">
              <span>Size</span>
              <span>{fileInfo.size}</span>
            </div>
            <div class="row">
              <span>Splats</span>
              <span>{fileInfo.splatCount}</span>
            </div>
            <div class="row">
              <span>Time</span>
              <span>{fileInfo.loadTime}</span>
            </div>
          </div>
        )}
        {/* Settings panels */}
        <CameraControls />
        <AnimationSettings />
        {/* Storage sources */}
        <StorageSourceList 
          onAddSource={handleOpenStorageDialog}
          onSelectSource={handleSelectSource}
          onOpenCloudGpu={handleOpenCloudGpuDialog}
        />
        <DebugSettings />
      </div>
      
      {/* Connect to Storage dialog */}
      <ConnectStorageDialog
        isOpen={storageDialogOpen}
        onClose={handleCloseStorageDialog}
        onConnect={handleSourceConnect}
        initialTier={storageDialogInitialTier}
      />
    </>
  );
}

export default SidePanel;
