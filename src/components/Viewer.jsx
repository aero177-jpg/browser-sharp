/**
 * Viewer component.
 * Three.js canvas wrapper that handles:
 * - Drag and drop file loading
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
  updateDollyZoomBaselineFromCamera,
  requestRender,
  THREE,
  SplatMesh,
} from '../viewer';
import { restoreHomeView } from '../cameraUtils';
import { cancelLoadZoomAnimation, startAnchorTransition } from '../cameraAnimations';
import { recenterInImmersiveMode, isImmersiveModeActive } from '../immersiveMode';
import { loadNextAsset, loadPrevAsset, resize, initDragDrop, handleMultipleFiles } from '../fileLoader';
import { getFormatAccept } from '../formats/index';

/** Tags that should not trigger keyboard shortcuts */
const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

/** File input accept attribute value */
const formatAccept = getFormatAccept();

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

function Viewer({ viewerReady }) {
  // Store state
  const debugLoadingMode = useStore((state) => state.debugLoadingMode);
  const isMobile = useStore((state) => state.isMobile);
  const isPortrait = useStore((state) => state.isPortrait);
  
  // Store actions
  const addLog = useStore((state) => state.addLog);
  const togglePanel = useStore((state) => state.togglePanel);
  
  // Ref for viewer container and file input
  const viewerRef = useRef(null);
  const fileInputRef = useRef(null);

  // Track mesh state
  const [hasMesh, setHasMesh] = useState(false);

  /**
   * Track mesh loading state
   */
  useEffect(() => {
    const checkMesh = () => {
      setHasMesh(!!currentMesh);
    };
    
    // Check immediately and set up interval to poll
    checkMesh();
    const interval = setInterval(checkMesh, 100);
    
    return () => clearInterval(interval);
  }, []);

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

  /**
   * Sets up event listeners for viewer interactions.
   * Runs after viewer is initialized.
   */
  useEffect(() => {
    // Wait for viewer to be initialized
    if (!viewerReady || !controls || !renderer) {
      return;
    }

    // Initialize drag/drop (file picker is handled in SidePanel)
    initDragDrop();

    /**
     * Cancels any running load zoom animation.
     * Called on user interaction to allow manual control.
     */
    const cancelLoadZoomOnUserInput = () => {
      cancelLoadZoomAnimation();
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

      if (event.key === 't' || event.key === 'T') {
        event.preventDefault();
        togglePanel();
        return;
      }

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
  }, [viewerReady, addLog, togglePanel]);

  return (
    <div id="viewer" class={`viewer ${debugLoadingMode ? 'loading' : ''}`} ref={viewerRef}>
      <div class="loading-overlay">
        <div class="loading-spinner"></div>
      </div>
      {isMobile ? (
        !hasMesh && (
          <div class="drop-help mobile-file-picker">
            <button class="primary large-file-btn" onClick={handlePickFile}>
              Choose File
            </button>
            <div class="fine-print">Select PLY/SOG files • Spark + THREE 3DGS</div>
            <input 
              ref={fileInputRef}
              type="file" 
              accept={formatAccept} 
              multiple 
              hidden 
              onChange={handleFileChange}
            />
          </div>
        )
      ) : (
        !hasMesh && (
          <div class="drop-help">
            <div class="eyebrow">Drag PLY/SOG files or folders here</div>
            <div class="fine-print">Drop multiple files to browse • Spark + THREE 3DGS</div>
          </div>
        )
      )}
      {/* Reset view button - mobile only, shown when mesh is loaded */}
      {isMobile && hasMesh && (
        <button 
          class="reset-view-btn" 
          onClick={() => {
            if (isImmersiveModeActive()) {
              recenterInImmersiveMode(restoreHomeView, 600);
            } else {
              restoreHomeView();
            }
          }}
          aria-label="Reset camera view"
          title="Reset view (R)"
        >
          ⟲
        </button>
      )}
    </div>
  );
}

export default Viewer;
