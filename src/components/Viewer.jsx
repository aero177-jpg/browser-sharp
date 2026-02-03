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
import { loadNextAsset, loadPrevAsset, resize } from '../fileLoader';
import { resetSplatManager } from '../splatManager';
import { clearBackground } from '../backgroundManager';
import { getSource } from '../storage/index.js';
import ViewerEmptyState from './ViewerEmptyState.jsx';


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

const formatEta = (seconds) => {
  const remaining = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

function Viewer({ viewerReady }) {
  // Store state
  const debugLoadingMode = useStore((state) => state.debugLoadingMode);
  const metadataMissing = useStore((state) => state.metadataMissing);
  const isUploading = useStore((state) => state.isUploading);
  const uploadProgress = useStore((state) => state.uploadProgress);
  const isLoading = useStore((state) => state.isLoading);
  const assets = useStore((state) => state.assets);
  const activeSourceId = useStore((state) => state.activeSourceId);
  const setAnchorState = useStore((state) => state.setAnchorState);
  
  // Store actions
  const addLog = useStore((state) => state.addLog);
  const togglePanel = useStore((state) => state.togglePanel);
  
  // Ref for viewer container
  const viewerRef = useRef(null);

  const [hasMesh, setHasMesh] = useState(false);
  const hasMeshRef = useRef(false);

  const { hasOriginalMetadata, customMetadataMode } = useStore();

  const showEmptyState = Boolean(activeSourceId) && assets.length === 0 && !isLoading;
  const activeSource = activeSourceId ? getSource(activeSourceId) : null;

  const showUploadProgress = isUploading && (uploadProgress?.total || uploadProgress?.upload?.total || uploadProgress?.estimate);

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
   * Sets up event listeners for viewer interactions.
   * Runs after viewer is initialized.
   */
  useEffect(() => {
    // Wait for viewer to be initialized
    if (!viewerReady || !controls || !renderer) {
      return;
    }

    /**
     * Cancels any running load zoom animation.
     * Called on user interaction to allow manual control.
     */
    const cancelLoadZoomOnUserInput = () => {
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

      cancelLoadZoomAnimation();


      if (event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        restoreHomeView();
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
    };
  }, [viewerReady, addLog, togglePanel, setAnchorState]);

  const uploadStage = uploadProgress?.stage || (uploadProgress?.estimate ? 'processing' : 'upload');
  const uploadDone = Boolean(uploadProgress?.upload?.done);
  const estimate = uploadProgress?.estimate || null;
  const hasFileCount = Number.isFinite(uploadProgress?.total);
  const fileCompleted = hasFileCount ? (uploadProgress?.completed || 0) : 0;
  const fileTotal = hasFileCount ? uploadProgress?.total : 0;
  const uploadBytesTotal = uploadProgress?.upload?.total || 0;
  const uploadBytesLoaded = uploadProgress?.upload?.loaded || 0;

  const uploadPercent = uploadBytesTotal
    ? Math.min(100, Math.round((uploadBytesLoaded / uploadBytesTotal) * 100))
    : null;
  const estimatePercent = estimate?.stageProgress != null
    ? Math.min(100, Math.round(estimate.stageProgress * 100))
    : null;
  const fallbackPercent = fileTotal
    ? Math.min(100, Math.round((fileCompleted / fileTotal) * 100))
    : 0;

  const progressPercent = uploadStage === 'upload'
    ? (uploadPercent ?? fallbackPercent)
    : (estimatePercent ?? fallbackPercent);

  const etaSeconds = estimate?.remainingMs != null
    ? Math.ceil(estimate.remainingMs / 1000)
    : 0;
  const etaLabel = showUploadProgress && etaSeconds ? formatEta(etaSeconds) : '';
  
  const currentFile = estimate?.currentFile || 0;
  const totalFiles = estimate?.totalFiles || 0;
  const isWarmup = uploadStage === 'warmup';
  const isProcessing = uploadStage === 'processing';
  
  const stageLabel = uploadStage === 'upload'
    ? (uploadDone ? 'Upload complete' : 'Uploading')
    : isWarmup
    ? 'GPU warm-up'
    : isProcessing && totalFiles > 1
    ? `Processing ${currentFile}/${totalFiles}`
    : 'Processing (est.)';

  const fileCountLabel = isProcessing && totalFiles > 1 && currentFile > 0
    ? `${currentFile}/${totalFiles}`
    : fileTotal > 0
    ? `${fileCompleted}/${fileTotal}`
    : '';

  const estimateElapsedMs = estimate?.elapsedMs || 0;
  const estimateFileCount = totalFiles || fileTotal || 1;
  const warnAfterMs = 60000 + estimateFileCount * 30000;
  const failAfterMs = 300000 + estimateFileCount * 50000;
  const showSlowWarning = (isWarmup || isProcessing) && !estimate?.done && estimateElapsedMs > warnAfterMs;
  const showFailWarning = (isWarmup || isProcessing) && !estimate?.done && estimateElapsedMs > failAfterMs;
  const warningText = showFailWarning
    ? 'This is taking longer than expected and may have failed. Collection will refresh when ready.'
    : showSlowWarning
    ? 'Taking longer than expected. Collection will refresh when ready.'
    : '';

  return (
    <div id="viewer" class={`viewer ${debugLoadingMode ? 'loading' : ''} ${showEmptyState ? 'is-empty' : ''}`} ref={viewerRef}>
      {showEmptyState && (
        <ViewerEmptyState source={activeSource} />
      )}
      {showUploadProgress && (
        <div class="viewer-upload-overlay">
          <div class="viewer-upload-title">{stageLabel}</div>
          <div class="viewer-upload-meta">
            {fileCountLabel && (
              <span>{fileCountLabel}</span>
            )}
            {etaLabel && <span class="viewer-upload-eta">{etaLabel}</span>}
          </div>
          {warningText && (
            <div class="viewer-upload-warning">{warningText}</div>
          )}
          <div class="viewer-upload-bar">
            <div class="viewer-upload-bar-fill" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
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
      <div class="loading-overlay">
        <div class="loading-spinner"></div>
      </div>
    </div>
  );
}

export default Viewer;
