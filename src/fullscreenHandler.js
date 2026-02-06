/**
 * Fullscreen handler utility.
 * Uses the fullscreen root element and CSS to manage fullscreen UI.
 */

import { resize } from './fileLoader.js';
import { requestRender, suspendRenderLoop, resumeRenderLoop } from './viewer.js';
import { useStore } from './store.js';
import { registerTapListener } from './utils/tapDetector.js';

const waitForNextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const setViewerTransitionState = (viewerEl, active) => {
  if (!viewerEl) return;
  viewerEl.classList.toggle('fullscreen-refresh', Boolean(active));
};

const VISIBILITY_TOGGLE_SELECTORS = [
  '.asset-sidebar',
  '.bottom-controls',
  '.side',
  '.panel-toggle',
  '.mobile-sheet',
  '.sidebar-hover-target',
  '.sidepanel-hover-target',
  '.bottom-swipe-target',
  '.modal-overlay',
  '.modal-content',
];

const IMMERSIVE_CLASSES = ['immersive-active', 'immersive-mode', 'xr-immersive'];

const applyVisibilityHidden = (fullscreenRootEl, hidden) => {
  if (!fullscreenRootEl) return;
  fullscreenRootEl.classList.toggle('fullscreen-ui-hidden', hidden);
};

const applyCursorHidden = (viewerEl, hidden) => {
  if (!viewerEl) return;
  viewerEl.classList.toggle('cursor-hidden', hidden);
};

const setMobileSystemUiHidden = async () => {};

const isFullscreenOrImmersive = (fullscreenRootEl, viewerEl) =>
  document.fullscreenElement === fullscreenRootEl ||
  (viewerEl && IMMERSIVE_CLASSES.some((cls) => viewerEl.classList.contains(cls)));

/**
 * Sets up fullscreen change listener.
 * @param {HTMLElement} fullscreenRootEl - The fullscreen root element
 * @param {HTMLElement} viewerEl - The viewer element
 * @param {Function} [onStateChange] - Optional callback when fullscreen state changes
 * @returns {Function} Cleanup function to remove listener
 */
export function setupFullscreenHandler(fullscreenRootEl, viewerEl, onStateChange = null) {
  if (!fullscreenRootEl || !viewerEl) return () => {};

  let transitionPromise = null;
  let rerunRequested = false;
  let uiHidden = false;
  const TAP_MAX_DURATION_MS = 220;
  const TAP_MAX_MOVE_PX = 12;

  const resetUiVisibility = () => {
    uiHidden = false;
    applyVisibilityHidden(fullscreenRootEl, uiHidden);
    applyCursorHidden(viewerEl, uiHidden);
    void setMobileSystemUiHidden(false);
  };

  const shouldIgnoreTap = (event) => {
    if (!isFullscreenOrImmersive(fullscreenRootEl, viewerEl)) return true;
    if (useStore.getState().focusSettingActive) return true;
    if (useStore.getState().panelOpen) return true;
    if (event.target.closest(VISIBILITY_TOGGLE_SELECTORS.join(','))) return true;
    return false;
  };

  const handleViewerTap = () => {
    uiHidden = !uiHidden;
    applyVisibilityHidden(fullscreenRootEl, uiHidden);
    applyCursorHidden(viewerEl, uiHidden);
    void setMobileSystemUiHidden(uiHidden);
  };

  const processChange = async () => {
    const isFullscreen = document.fullscreenElement === fullscreenRootEl;

    setViewerTransitionState(viewerEl, true);
    suspendRenderLoop();

    try {
      resetUiVisibility();

      // Let layout settle before resizing and reloading content
      await waitForNextFrame();
      resize();
      requestRender();
    } catch (err) {
      console.warn('Fullscreen refresh failed:', err);
    } finally {
      setViewerTransitionState(viewerEl, false);
      resumeRenderLoop();
    }

    if (onStateChange) {
      onStateChange(isFullscreen);
    }
  };

  const handleFullscreenChange = () => {
    rerunRequested = true;
    if (transitionPromise) return;

    transitionPromise = (async () => {
      do {
        rerunRequested = false;
        await processChange();
      } while (rerunRequested);
    })().finally(() => {
      transitionPromise = null;
    });
  };

  document.addEventListener('fullscreenchange', handleFullscreenChange);
  const unregisterTapListener = registerTapListener(fullscreenRootEl, {
    onTap: handleViewerTap,
    shouldIgnore: shouldIgnoreTap,
    maxDurationMs: TAP_MAX_DURATION_MS,
    maxMovePx: TAP_MAX_MOVE_PX,
  });
  
  return () => {
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    unregisterTapListener();
    applyCursorHidden(viewerEl, false);
  };
}
