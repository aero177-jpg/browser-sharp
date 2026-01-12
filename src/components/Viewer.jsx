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
import { restoreHomeView, resetViewWithImmersive } from '../cameraUtils';
import { cancelLoadZoomAnimation, startAnchorTransition } from '../cameraAnimations';
import { loadNextAsset, loadPrevAsset, resize, initDragDrop } from '../fileLoader';


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

function Viewer({ viewerReady }) {
  // Store state
  const debugLoadingMode = useStore((state) => state.debugLoadingMode);
  
  // Store actions
  const addLog = useStore((state) => state.addLog);
  const togglePanel = useStore((state) => state.togglePanel);
  
  // Ref for viewer container
  const viewerRef = useRef(null);

  const [hasMesh, setHasMesh] = useState(false);
  const hasMeshRef = useRef(false);

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
   * Load demo public URL collection (create it if missing) and open it
   */
  const handleLoadDemo = useCallback(async () => {
    console.log('Loading demo URL collection...');
    try {
      let demo = getSource('demo-public-url');
      if (!demo) {
        // Fallback: create the demo source if it wasn't registered yet
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

      // Ensure source is connected before loading
      try {
        await demo.connect?.();
      } catch (err) {
        console.warn('Demo connect failed (continuing):', err);
      }

      // Load the demo collection
      await loadFromStorageSource(demo);

    } catch (err) {
      addLog('Failed to load demo: ' + (err?.message || err));
      console.warn('Failed to load demo:', err);
    }
  }, [addLog]);

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
    </div>
  );
}

export default Viewer;
