/**
 * Mobile sheet component for portrait orientation.
 * Swipeable bottom sheet drawer with drag handle interaction.
 */

import { useRef, useCallback, useState } from 'preact/hooks';
import { useStore } from '../store';
import CameraControls from './CameraControls';
import AnimationSettings from './AnimationSettings';
import AssetGallery from './AssetGallery';
import { getFormatAccept } from '../formats/index';
import { handleMultipleFiles } from '../fileLoader';

/** File input accept attribute value */
const formatAccept = getFormatAccept();

/** Minimum swipe distance to trigger open/close */
const SWIPE_THRESHOLD = 50;

function MobileSheet() {
  // Store state
  const panelOpen = useStore((state) => state.panelOpen);
  const togglePanel = useStore((state) => state.togglePanel);

  // Refs
  const fileInputRef = useRef(null);
  const touchStartRef = useRef(null);

  // Local state
  const [isDragging, setIsDragging] = useState(false);

  /**
   * Handle drag handle click to toggle
   */
  const handleDragHandleClick = useCallback(() => {
    togglePanel();
  }, [togglePanel]);

  /**
   * Handle touch start - record starting position
   */
  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    touchStartRef.current = {
      y: touch.clientY,
      time: Date.now()
    };
    setIsDragging(true);
  }, []);

  /**
   * Handle touch end - determine swipe direction and toggle
   */
  const handleTouchEnd = useCallback((e) => {
    if (!touchStartRef.current) return;

    const touch = e.changedTouches[0];
    const deltaY = touch.clientY - touchStartRef.current.y;
    const deltaTime = Date.now() - touchStartRef.current.time;
    const velocity = Math.abs(deltaY) / deltaTime;

    // Swipe up (negative deltaY) to open, swipe down (positive deltaY) to close
    if (Math.abs(deltaY) > SWIPE_THRESHOLD || velocity > 0.5) {
      if (deltaY < 0 && !panelOpen) {
        // Swiped up - open
        togglePanel();
      } else if (deltaY > 0 && panelOpen) {
        // Swiped down - close
        togglePanel();
      }
    }

    touchStartRef.current = null;
    setIsDragging(false);
  }, [panelOpen, togglePanel]);

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
    <div class={`mobile-sheet ${panelOpen ? 'open' : 'closed'}`}>
      {/* Drag handle with enlarged touch target - outside scroll container */}
      <div class="drag-handle">
        <div 
          class="drag-handle-touch-target"
          onClick={handleDragHandleClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        />
        <div class="drag-handle-bar" />
      </div>
      
      {/* Scrollable content container */}
      <div class="mobile-sheet-content">
        <CameraControls />
        <AnimationSettings />
        <AssetGallery />
      </div>
    </div>
  );
}

export default MobileSheet;
