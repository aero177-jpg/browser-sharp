/**
 * Fullscreen handler utility.
 * Uses the fullscreen root element and CSS to manage fullscreen UI.
 */

import { resize } from './fileLoader.js';
import { requestRender, suspendRenderLoop, resumeRenderLoop } from './viewer.js';
import { useStore } from './store.js';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';

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
];

const IMMERSIVE_CLASSES = ['immersive-active', 'immersive-mode', 'xr-immersive'];

const applyVisibilityHidden = (fullscreenRootEl, hidden) => {
  if (!fullscreenRootEl) return;
  fullscreenRootEl.classList.toggle('fullscreen-ui-hidden', hidden);
};

const setMobileSystemUiHidden = async (hidden) => {
  if (!Capacitor?.isNativePlatform?.()) return;

  try {
    if (hidden) {
      await StatusBar.hide();
    } else {
      await StatusBar.show();
    }
  } catch {
    // ignore
  }
};

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
  let tapStart = null;
  const TAP_MAX_DURATION_MS = 220;
  const TAP_MAX_MOVE_PX = 12;

  const resetUiVisibility = () => {
    uiHidden = false;
    applyVisibilityHidden(fullscreenRootEl, uiHidden);
    void setMobileSystemUiHidden(false);
  };

  const handlePointerDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    tapStart = {
      time: performance.now(),
      x: event.clientX,
      y: event.clientY,
    };
  };

  const handleViewerTap = (event) => {
    if (!tapStart) return;
    const dt = performance.now() - tapStart.time;
    const dx = event.clientX - tapStart.x;
    const dy = event.clientY - tapStart.y;
    const dist = Math.hypot(dx, dy);
    tapStart = null;

    if (dt > TAP_MAX_DURATION_MS || dist > TAP_MAX_MOVE_PX) return;
    if (!isFullscreenOrImmersive(fullscreenRootEl, viewerEl)) return;
    if (useStore.getState().focusSettingActive) return;
    if (useStore.getState().panelOpen) return;
    if (event.target.closest(VISIBILITY_TOGGLE_SELECTORS.join(','))) return;
    uiHidden = !uiHidden;
    applyVisibilityHidden(fullscreenRootEl, uiHidden);
    void setMobileSystemUiHidden(uiHidden);
  };

  const handlePointerCancel = () => {
    tapStart = null;
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
  fullscreenRootEl.addEventListener('pointerdown', handlePointerDown);
  fullscreenRootEl.addEventListener('pointerup', handleViewerTap);
  fullscreenRootEl.addEventListener('pointercancel', handlePointerCancel);
  
  return () => {
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    fullscreenRootEl.removeEventListener('pointerdown', handlePointerDown);
    fullscreenRootEl.removeEventListener('pointerup', handleViewerTap);
    fullscreenRootEl.removeEventListener('pointercancel', handlePointerCancel);
  };
}
