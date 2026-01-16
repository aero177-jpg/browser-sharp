/**
 * Fullscreen handler utility.
 * Manages moving UI elements into/out of the fullscreen viewer element and
 * orchestrates a clean viewer reload after fullscreen transitions.
 */

import { resize, reloadCurrentAsset } from './fileLoader.js';
import { requestRender, suspendRenderLoop, resumeRenderLoop } from './viewer.js';

// Elements to move into fullscreen viewer (selector : key)
const FULLSCREEN_ELEMENTS = [
  { selector: '.panel-toggle', key: 'panelToggle' },
  { selector: '.side', key: 'sidePanel' },
  { selector: '.asset-sidebar', key: 'assetSidebar' },
  { selector: '.sidebar-hover-target', key: 'sidebarHoverTarget' },
  { selector: '.sidepanel-hover-target', key: 'sidepanelHoverTarget' },
  { selector: '.bottom-swipe-target', key: 'bottomSwipeTarget' },
  { selector: '.bottom-controls', key: 'bottomControls' },
  { selector: '.mobile-sheet', key: 'mobileSheet' },
  { selector: '#fps-counter', key: 'fpsCounter' },
];

// Track original parents for restoration
const originalParents = {};

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

const ensureFadeSetup = (el) => {
  if (el.dataset.fsFadeInit) return;
  const existing = (el.style.transition || '').trim();
  const fade = 'opacity 200ms ease';
  el.style.transition = existing ? `${existing}, ${fade}` : fade;
  el.dataset.fsFadeInit = '1';
};

const applyVisibilityHidden = (viewerEl, hidden) => {
  VISIBILITY_TOGGLE_SELECTORS.map((selector) => document.querySelector(selector))
    .filter(Boolean)
    .forEach((el) => {
      ensureFadeSetup(el);
      el.style.opacity = hidden ? '0' : '1';
      el.style.pointerEvents = hidden ? 'none' : '';
    });
  if (viewerEl) viewerEl.classList.toggle('fullscreen-ui-hidden', hidden);
};

const isFullscreenOrImmersive = (viewerEl) =>
  document.fullscreenElement === viewerEl ||
  (viewerEl && IMMERSIVE_CLASSES.some((cls) => viewerEl.classList.contains(cls)));

/**
 * Moves UI elements into the fullscreen viewer element.
 * @param {HTMLElement} viewerEl - The viewer element
 * @param {HTMLElement} [extraElement] - Optional extra element to move (e.g., mobile controls)
 */
export function moveElementsToFullscreen(viewerEl, extraElement = null) {
  FULLSCREEN_ELEMENTS.forEach(({ selector, key }) => {
    const el = document.querySelector(selector);
    if (el && el.parentElement !== viewerEl) {
      originalParents[key] = el.parentElement;
      viewerEl.appendChild(el);
    }
  });

  // Handle optional extra element
  if (extraElement && extraElement.parentElement !== viewerEl) {
    originalParents.extra = extraElement.parentElement;
    viewerEl.appendChild(extraElement);
  }
}

/**
 * Restores UI elements to their original parent elements.
 * @param {HTMLElement} [extraElement] - Optional extra element to restore
 */
export function restoreElementsFromFullscreen(extraElement = null) {
  FULLSCREEN_ELEMENTS.forEach(({ selector, key }) => {
    const el = document.querySelector(selector);
    const originalParent = originalParents[key];
    if (el && originalParent && el.parentElement !== originalParent) {
      originalParent.appendChild(el);
    }
  });

  // Handle optional extra element
  if (extraElement && originalParents.extra) {
    const originalParent = originalParents.extra;
    if (extraElement.parentElement !== originalParent) {
      originalParent.appendChild(extraElement);
    }
  }
}

/**
 * Sets up fullscreen change listener.
 * @param {HTMLElement} viewerEl - The viewer element
 * @param {HTMLElement} [extraElement] - Optional extra element to move
 * @param {Function} [onStateChange] - Optional callback when fullscreen state changes
 * @returns {Function} Cleanup function to remove listener
 */
export function setupFullscreenHandler(viewerEl, extraElement = null, onStateChange = null) {
  if (!viewerEl) return () => {};

  let transitionPromise = null;
  let rerunRequested = false;
  let uiHidden = false;

  const resetUiVisibility = () => {
    uiHidden = false;
    applyVisibilityHidden(viewerEl, uiHidden);
  };

  const handleViewerTap = (event) => {
    if (!isFullscreenOrImmersive(viewerEl)) return;
    if (event.target.closest(VISIBILITY_TOGGLE_SELECTORS.join(','))) return;
    uiHidden = !uiHidden;
    applyVisibilityHidden(viewerEl, uiHidden);
  };

  const processChange = async () => {
    const isFullscreen = document.fullscreenElement === viewerEl;

    setViewerTransitionState(viewerEl, true);
    suspendRenderLoop();

    try {
      if (isFullscreen) {
        moveElementsToFullscreen(viewerEl, extraElement);
      } else {
        restoreElementsFromFullscreen(extraElement);
      }
      resetUiVisibility();

      // Let layout settle before resizing and reloading content
      await waitForNextFrame();
      resize();
      requestRender();

      // Reload the current asset so the new layout renders cleanly
      await reloadCurrentAsset();
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
  viewerEl.addEventListener('pointerup', handleViewerTap);
  
  return () => {
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    viewerEl.removeEventListener('pointerup', handleViewerTap);
  };
}
