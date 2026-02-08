/**
 * Viewer component.
 * Three.js canvas wrapper that handles:
 * - Mouse/touch interactions (double-click to set anchor)
 * - Keyboard shortcuts for navigation and view control
 */

import { useEffect, useCallback, useRef, useState } from 'preact/hooks';
import { useStore } from '../store';
import { 
  camera, 
  controls, 
  renderer, 
  raycaster,
  scene,
  currentMesh, 
  setCurrentMesh,
  updateDollyZoomBaselineFromCamera,
  requestRender,
  THREE,
  SplatMesh,
} from '../viewer';
import { restoreHomeView, resetViewWithImmersive } from '../cameraUtils';
import { startAnchorTransition } from '../cameraAnimations';
import { cancelLoadZoomAnimation } from '../customAnimations';
import { cancelContinuousZoomAnimation, cancelContinuousOrbitAnimation, cancelContinuousVerticalOrbitAnimation } from '../cameraAnimations';
import { startSlideshow, stopSlideshow } from '../slideshowController';
import { loadNextAsset, loadPrevAsset, resize } from '../fileLoader';
import { resetSplatManager } from '../splatManager';
import { clearBackground } from '../backgroundManager';
import { getSource } from '../storage/index.js';
import { registerTapListener } from '../utils/tapDetector';
import ViewerEmptyState from './ViewerEmptyState.jsx';
import UploadStatusOverlay from './UploadStatusOverlay.jsx';


/** Tags that should not trigger keyboard shortcuts */
const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

/**
 * Checks if an event target is an input element.
 * @param {EventTarget} target - Event target to check
 * @returns {boolean} True if target is an input element
 */
const isInputElement = (target) => {
  const tag = target?.tagName;
  return INPUT_TAGS.has(tag) || target?.isContentEditable;
};

/**
 * Formats a 3D point for logging.
 * @param {THREE.Vector3} point - Point to format
 * @returns {string} Formatted string
 */
const formatPoint = (point) => 
  `${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)}`;


function Viewer({ viewerReady, dropOverlay }) {
  // Store state
  const debugLoadingMode = useStore((state) => state.debugLoadingMode);
  const metadataMissing = useStore((state) => state.metadataMissing);
  const isUploading = useStore((state) => state.isUploading);
  const uploadProgress = useStore((state) => state.uploadProgress);
  const setUploadState = useStore((state) => state.setUploadState);
  const isLoading = useStore((state) => state.isLoading);
  const assets = useStore((state) => state.assets);
  const currentAssetIndex = useStore((state) => state.currentAssetIndex);
  const activeSourceId = useStore((state) => state.activeSourceId);
  const panelOpen = useStore((state) => state.panelOpen);
  const assetSidebarOpen = useStore((state) => state.assetSidebarOpen);
  const slideshowMode = useStore((state) => state.slideshowMode);
  const slideshowPlaying = useStore((state) => state.slideshowPlaying);
  const setAnchorState = useStore((state) => state.setAnchorState);
  
  // Store actions
  const addLog = useStore((state) => state.addLog);
  const togglePanel = useStore((state) => state.togglePanel);

  const handleDismissUploadError = useCallback(() => {
    setUploadState({ isUploading: false, uploadProgress: null });
  }, [setUploadState]);
  
  // Ref for viewer container
  const viewerRef = useRef(null);

  const [hasMesh, setHasMesh] = useState(false);
  const hasMeshRef = useRef(false);
  const [showLargeFileNotice, setShowLargeFileNotice] = useState(false);
  const largeFileTimeoutRef = useRef(null);
  const [currentMeshAssetId, setCurrentMeshAssetId] = useState(null);
  const lastTapTimeRef = useRef(0);
  const cursorIdleTimeoutRef = useRef(null);

  const { hasOriginalMetadata, customMetadataMode } = useStore();

  const showEmptyState = Boolean(activeSourceId) && assets.length === 0 && !isLoading;
  const activeSource = activeSourceId ? getSource(activeSourceId) : null;

  const showEmptyUploadStatus = showEmptyState
    && isUploading
    && (uploadProgress?.total || uploadProgress?.upload?.total || uploadProgress?.estimate);

  const currentAsset = currentAssetIndex >= 0 ? assets[currentAssetIndex] : null;
  const currentAssetSize = currentAsset?.file?.size ?? currentAsset?.size ?? 0;

  useEffect(() => {
    if (!showEmptyState) return;
    if (!currentMesh) return;

    resetSplatManager();
    setCurrentMesh(null);
    clearBackground();
    const pageEl = document.querySelector('.page');
    if (pageEl) {
      pageEl.classList.remove('has-glow');
    }
    requestRender();
  }, [showEmptyState]);

  /**
   * Track mesh loading state - only update state when value changes
   * to avoid unnecessary re-renders during animations
   */
  useEffect(() => {
    const checkMesh = () => {
      const meshPresent = !!currentMesh;
      const meshAssetId = currentMesh?.userData?.assetId || null;
      if (meshPresent !== hasMeshRef.current) {
        hasMeshRef.current = meshPresent;
        setHasMesh(meshPresent);
      }
      setCurrentMeshAssetId((prev) => (prev === meshAssetId ? prev : meshAssetId));
    };
    
    // Check immediately and set up interval to poll
    checkMesh();
    const interval = setInterval(checkMesh, 100);
    
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (largeFileTimeoutRef.current) {
      clearTimeout(largeFileTimeoutRef.current);
      largeFileTimeoutRef.current = null;
    }

    setShowLargeFileNotice(false);

    const isLarge = Number.isFinite(currentAssetSize) && currentAssetSize >= 100 * 1024 * 1024;
    const isCurrentMeshActive = currentAsset?.id && currentMeshAssetId === currentAsset.id;
    if (!isLarge || isCurrentMeshActive) return;

    largeFileTimeoutRef.current = setTimeout(() => {
      const stillActive = currentAsset?.id && currentMeshAssetId !== currentAsset.id;
      if (stillActive) {
        setShowLargeFileNotice(true);
      }
    }, 2000);

    return () => {
      if (largeFileTimeoutRef.current) {
        clearTimeout(largeFileTimeoutRef.current);
        largeFileTimeoutRef.current = null;
      }
    };
  }, [currentAssetSize, currentAsset?.id, currentMeshAssetId]);


  /**
   * Handles reset view - uses shared function that handles immersive mode.
   */
  const handleResetView = useCallback(() => {
    resetViewWithImmersive();
  }, []);

  /**
   * Sets up event listeners for viewer interactions.
   * Runs after viewer is initialized.
   */
  useEffect(() => {
    // Wait for viewer to be initialized
    if (!viewerReady || !controls || !renderer) {
      return;
    }

    const shouldIgnoreViewerInput = () => panelOpen || assetSidebarOpen;

    const handleTap = () => {
      const now = Date.now();
      if (now - lastTapTimeRef.current < 300) return;
      lastTapTimeRef.current = now;

      if (!slideshowMode) return;

      if (slideshowPlaying) {
        stopSlideshow();
      } else {
        startSlideshow();
      }
    };

    const unregisterTapListener = registerTapListener(renderer.domElement, {
      onTap: handleTap,
      shouldIgnore: shouldIgnoreViewerInput,
      maxDurationMs: 500,
      maxMovePx: 10,
    });

    /**
     * Cancels any running load zoom animation.
     * Called on user interaction to allow manual control.
     */
    const cancelLoadZoomOnUserInput = () => {
      if (shouldIgnoreViewerInput()) return;
      cancelLoadZoomAnimation();
      cancelContinuousZoomAnimation();
      cancelContinuousOrbitAnimation();
      cancelContinuousVerticalOrbitAnimation();
    };

    // Cancel animation on any user input
    controls.addEventListener('start', cancelLoadZoomOnUserInput);
    renderer.domElement.addEventListener('pointerdown', cancelLoadZoomOnUserInput);
    renderer.domElement.addEventListener('wheel', cancelLoadZoomOnUserInput, { passive: true });
    renderer.domElement.addEventListener('touchstart', cancelLoadZoomOnUserInput);

    /**
     * Handles double-click to set new orbit anchor point.
     * Raycasts to find splat under cursor and animates to that point.
     * @param {MouseEvent} event - Double-click event
     */
    const handleDoubleClick = (event) => {
      if (!currentMesh) return;

      // Convert screen coordinates to normalized device coordinates
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );

      // Raycast to find splat intersection
      raycaster.setFromCamera(mouse, camera);
      const intersects = [];
      raycaster.intersectObjects(scene.children, true, intersects);
      const splatHit = intersects.find((i) => i.object instanceof SplatMesh) ?? null;

      if (splatHit) {
        // Animate to hit point
        startAnchorTransition(splatHit.point, {
          duration: 700,
          onComplete: () => {
            updateDollyZoomBaselineFromCamera();
            requestRender();
          },
        });
        setAnchorState({
          active: true,
          distance: typeof splatHit.distance === 'number' ? splatHit.distance : null,
        });
        const distanceText = splatHit.distance != null 
          ? ` (distance: ${splatHit.distance.toFixed(2)})` 
          : '';
        addLog(`Anchor set: ${formatPoint(splatHit.point)}${distanceText}`);
      } else {
        addLog('No splat found under cursor for anchor');
      }
    };

    renderer.domElement.addEventListener('dblclick', handleDoubleClick);

    /**
     * Global keyboard shortcuts handler.
     * - T: Toggle side panel
     * - Space: Reset to home view
     * - Arrow keys: Navigate between assets
     * @param {KeyboardEvent} event - Keyboard event
     */
    const handleKeydown = (event) => {
      // Ignore when typing in input fields
      if (isInputElement(event.target)) {
        return;
      }

      if (document.querySelector('.modal-overlay')) {
        return;
      }

      cancelLoadZoomAnimation();


      if (event.code === 'KeyR' || event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        restoreHomeView();
        return;
      }

      if (event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        if (slideshowMode) {
          if (slideshowPlaying) {
            stopSlideshow();
          } else {
            startSlideshow();
          }
        }
        return;
      }

      // Arrow key navigation
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        loadNextAsset();
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        loadPrevAsset();
        return;
      }
    };

    document.addEventListener('keydown', handleKeydown);

    return () => {
      if (controls) {
        controls.removeEventListener('start', cancelLoadZoomOnUserInput);
      }
      if (renderer?.domElement) {
        renderer.domElement.removeEventListener('pointerdown', cancelLoadZoomOnUserInput);
        renderer.domElement.removeEventListener('wheel', cancelLoadZoomOnUserInput);
        renderer.domElement.removeEventListener('touchstart', cancelLoadZoomOnUserInput);
        renderer.domElement.removeEventListener('dblclick', handleDoubleClick);
      }
      document.removeEventListener('keydown', handleKeydown);
      unregisterTapListener();
    };
  }, [viewerReady, addLog, togglePanel, setAnchorState, panelOpen, assetSidebarOpen, slideshowMode, slideshowPlaying]);

  useEffect(() => {
    const viewerEl = viewerRef.current;
    if (!viewerEl) return;

    const CURSOR_IDLE_MS = 500;

    const clearCursorTimeout = () => {
      if (cursorIdleTimeoutRef.current) {
        clearTimeout(cursorIdleTimeoutRef.current);
        cursorIdleTimeoutRef.current = null;
      }
    };

    const showCursor = () => {
      viewerEl.classList.remove('cursor-hidden');
    };

    const hideCursor = () => {
      viewerEl.classList.add('cursor-hidden');
    };

    const scheduleCursorHide = () => {
      if (!slideshowMode || !slideshowPlaying) return;
      clearCursorTimeout();
      showCursor();
      cursorIdleTimeoutRef.current = setTimeout(() => {
        if (slideshowMode && slideshowPlaying) {
          hideCursor();
        }
      }, CURSOR_IDLE_MS);
    };

    const handleActivity = () => {
      if (!slideshowMode || !slideshowPlaying) return;
      scheduleCursorHide();
    };

    if (slideshowMode && slideshowPlaying) {
      scheduleCursorHide();
    } else {
      clearCursorTimeout();
      showCursor();
    }

    viewerEl.addEventListener('pointermove', handleActivity);
    viewerEl.addEventListener('pointerdown', handleActivity);
    viewerEl.addEventListener('wheel', handleActivity, { passive: true });
    viewerEl.addEventListener('touchstart', handleActivity, { passive: true });
    document.addEventListener('keydown', handleActivity);

    return () => {
      clearCursorTimeout();
      viewerEl.classList.remove('cursor-hidden');
      viewerEl.removeEventListener('pointermove', handleActivity);
      viewerEl.removeEventListener('pointerdown', handleActivity);
      viewerEl.removeEventListener('wheel', handleActivity);
      viewerEl.removeEventListener('touchstart', handleActivity);
      document.removeEventListener('keydown', handleActivity);
    };
  }, [slideshowMode, slideshowPlaying]);

  return (
    <div id="viewer" class={`viewer ${debugLoadingMode ? 'loading' : ''} ${showEmptyState ? 'is-empty' : ''}`} ref={viewerRef}>
      {dropOverlay}
      {showEmptyState && !showEmptyUploadStatus && (
        <ViewerEmptyState source={activeSource} />
      )}
      {showEmptyUploadStatus && (
        <div class="viewer-empty-state">
          <UploadStatusOverlay
            isUploading={isUploading}
            uploadProgress={uploadProgress}
            variant="first-load"
            onDismiss={handleDismissUploadError}
          />
        </div>
      )}
      {!showEmptyState && (
        <UploadStatusOverlay
          isUploading={isUploading}
          uploadProgress={uploadProgress}
          onDismiss={handleDismissUploadError}
        />
      )}
      {metadataMissing && (
        <div class="metadata-warning">
          No metadata. Adjust camera settings to save a new view.
        </div>
      )}
      {!hasOriginalMetadata && customMetadataMode && (
        <div className="metadata-missing-overlay">
          <div className="metadata-missing-badge">
            <span className="metadata-missing-icon">⚠️</span>
            <span className="metadata-missing-text">
              No metadata detected
            </span>
          </div>
          <div className="metadata-missing-hint">
            Use Camera Settings to adjust view, then save
          </div>
        </div>
      )}
      {showLargeFileNotice && (
        <div className="large-file-overlay">
          <div className="large-file-badge">
            <span className="large-file-spinner" aria-hidden="true" />
            <span>Loading file...</span>
          </div>
        </div>
      )}
      <div class="loading-overlay">
        <div class="loading-spinner"></div>
      </div>
    </div>
  );
}

export default Viewer;
