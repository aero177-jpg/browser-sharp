/**
 * Side panel component for desktop and landscape modes.
 * Contains file upload controls, debug info display, and settings panels.
 * Collapsible via toggle button.
 */

import { useRef, useCallback } from 'preact/hooks';
import { useStore } from '../store';
import CameraControls from './CameraControls';
import AnimationSettings from './AnimationSettings';
import AssetGallery from './AssetGallery';
import { getFormatAccept } from '../formats/index';
import { handleMultipleFiles } from '../fileLoader';

/** File input accept attribute value */
const formatAccept = getFormatAccept();

function SidePanel() {
  // Store state
  const status = useStore((state) => state.status);
  const fileInfo = useStore((state) => state.fileInfo);
  const isMobile = useStore((state) => state.isMobile);
  
  // Store actions
  const togglePanel = useStore((state) => state.togglePanel);

  // Ref for file input
  const fileInputRef = useRef(null);

  /**
   * Triggers file picker dialog.
   */
  const handlePickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * Handles file selection from file picker.
   */
  const handleFileChange = useCallback(async (event) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      await handleMultipleFiles(Array.from(files));
      event.target.value = '';
    }
  }, []);

  return (
    <>
      {/* Panel toggle button */}
      <button
        class="panel-toggle"
        aria-label="Toggle info panel"
        type="button"
        onClick={togglePanel}
      >
        {'<'}
      </button>
      
      {/* Side panel content */}
      <div class="side">
        {/* Header with file upload - hidden on mobile */}
        {!isMobile && (
          <div class="header">
            <div>
              <div class="title">3DGS File Upload</div>
            </div>
            <button class="primary" onClick={handlePickFile}>
              Choose File
            </button>
            <input 
              ref={fileInputRef}
              type="file" 
              accept={formatAccept} 
              multiple 
              hidden 
              onChange={handleFileChange}
            />
          </div>
        )}
        
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
        <AssetGallery />
      </div>
    </>
  );
}

export default SidePanel;
