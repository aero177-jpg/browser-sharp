/**
 * Main App component.
 * Root component that initializes the Three.js viewer and
 * orchestrates the main layout (viewer + side panel/mobile sheet).
 */

import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../store';
import Viewer from './Viewer';
import SidePanel from './SidePanel';
import MobileSheet from './MobileSheet';
import { initViewer, startRenderLoop } from '../viewer';
import { resize } from '../fileLoader';

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

  /**
   * Detects mobile device and orientation.
   */
  useEffect(() => {
    const updateMobileState = () => {
      const mobile = Math.min(window.innerWidth, window.innerHeight) <= 768;
      const portrait = window.innerHeight > window.innerWidth;
      setMobileState(mobile, portrait);
      
      // Open panel on desktop by default (only on first load)
      if (!mobile && !panelOpen) {
        togglePanel();
      }
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
      <Viewer viewerReady={viewerReady} />
      {isMobile && isPortrait ? <MobileSheet /> : <SidePanel />}
    </div>
  );
}

export default App;
