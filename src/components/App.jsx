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
import { initViewer, startRenderLoop, currentMesh } from '../viewer';
import { resize } from '../fileLoader';
import { resetViewWithImmersive } from '../cameraUtils';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRotateRight } from '@fortawesome/free-solid-svg-icons';
import { faExpand, faCompress } from '@fortawesome/free-solid-svg-icons';

/** Delay before resize after panel toggle animation completes */
const PANEL_TRANSITION_MS = 350;

function App() {
  // Store state
  const panelOpen = useStore((state) => state.panelOpen);
  const isMobile = useStore((state) => state.isMobile);
  const isPortrait = useStore((state) => state.isPortrait);
  const setMobileState = useStore((state) => state.setMobileState);
  const togglePanel = useStore((state) => state.togglePanel);
  
  // Local state for viewer initialization
  const [viewerReady, setViewerReady] = useState(false);
  
  // Track mesh state
  const [hasMesh, setHasMesh] = useState(false);
  const hasMeshRef = useRef(false);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const controlsRef = useRef(null);
  const originalParentsRef = useRef({});

  // Track fullscreen changes and move UI into viewer
  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement;
      setIsFullscreen(!!fsEl);

      const viewerEl = document.getElementById('viewer');
      if (!viewerEl) return;

      // All UI elements that need to be accessible in fullscreen
      const panelToggle = document.querySelector('.panel-toggle');
      const sidePanel = document.querySelector('.side');
      const assetSidebar = document.querySelector('.asset-sidebar');
      const sidebarHoverTarget = document.querySelector('.sidebar-hover-target');
      const sidebarTriggerBtn = document.querySelector('.sidebar-trigger-btn.left');
      const mobileSheet = document.querySelector('.mobile-sheet');
      const controlsEl = controlsRef.current;

      if (fsEl === viewerEl) {
        // Entering fullscreen - move UI inside viewer
        const elementsToMove = [
          { el: panelToggle, key: 'panelToggle' },
          { el: sidePanel, key: 'sidePanel' },
          { el: assetSidebar, key: 'assetSidebar' },
          { el: sidebarHoverTarget, key: 'sidebarHoverTarget' },
          { el: sidebarTriggerBtn, key: 'sidebarTriggerBtn' },
          { el: mobileSheet, key: 'mobileSheet' },
          { el: controlsEl, key: 'controls' }
        ];

        elementsToMove.forEach(({ el, key }) => {
          if (el && el.parentElement !== viewerEl) {
            originalParentsRef.current[key] = el.parentElement;
            viewerEl.appendChild(el);
          }
        });
      } else {
        // Exiting fullscreen - restore to original parents
        const elementsToRestore = [
          { el: panelToggle, key: 'panelToggle' },
          { el: sidePanel, key: 'sidePanel' },
          { el: assetSidebar, key: 'assetSidebar' },
          { el: sidebarHoverTarget, key: 'sidebarHoverTarget' },
          { el: sidebarTriggerBtn, key: 'sidebarTriggerBtn' },
          { el: mobileSheet, key: 'mobileSheet' },
          { el: controlsEl, key: 'controls' }
        ];

        elementsToRestore.forEach(({ el, key }) => {
          const originalParent = originalParentsRef.current[key];
          if (el && originalParent && el.parentElement !== originalParent) {
            originalParent.appendChild(el);
          }
        });
      }
    };

    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

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

  const handleToggleFullscreen = useCallback(async () => {
    // Use the viewer element itself for fullscreen so the canvas expands
    const viewerEl = document.getElementById('viewer');
    if (!viewerEl) return;

    try {
      if (!document.fullscreenElement) {
        await viewerEl.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
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
      <Viewer viewerReady={viewerReady} />
      {isMobile && isPortrait ? <MobileSheet /> : <SidePanel />}
      {/* Mobile-only controls shown when mesh is loaded */}
      {hasMesh && (
        <div ref={controlsRef} style={{ display: 'flex', gap: '8px', position: 'relative' }}>
          <button
            style={{ width: "50px", height: "32px", fontSize: "14px", right: "80px" }}
            class="sidebar-trigger-btn right"
            onClick={handleToggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
          </button>

          <button 
            style={{width:"50px", height:"32px", fontSize: "14px"}}
            class="sidebar-trigger-btn right" 
            onClick={handleResetView}
            aria-label="Reset camera view"
            title="Reset view (R)"
          >
            <FontAwesomeIcon icon={faRotateRight} />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
