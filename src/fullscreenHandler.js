/**
 * Fullscreen handler utility.
 * Manages moving UI elements into/out of the fullscreen viewer element.
 */

// Elements to move into fullscreen viewer (selector : key)
const FULLSCREEN_ELEMENTS = [
  { selector: '.panel-toggle', key: 'panelToggle' },
  { selector: '.side', key: 'sidePanel' },
  { selector: '.asset-sidebar', key: 'assetSidebar' },
  { selector: '.sidebar-hover-target', key: 'sidebarHoverTarget' },
  { selector: '.bottom-controls', key: 'bottomControls' },
  { selector: '.mobile-sheet', key: 'mobileSheet' },
  { selector: '#fps-counter', key: 'fpsCounter' },
];

// Track original parents for restoration
const originalParents = {};

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
  const handleFullscreenChange = () => {
    const isFullscreen = document.fullscreenElement === viewerEl;
    
    if (isFullscreen) {
      moveElementsToFullscreen(viewerEl, extraElement);
    } else {
      restoreElementsFromFullscreen(extraElement);
    }

    if (onStateChange) {
      onStateChange(isFullscreen);
    }
  };

  document.addEventListener('fullscreenchange', handleFullscreenChange);
  
  return () => {
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
  };
}
