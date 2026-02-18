/**
 * Fullscreen control hook with viewer fade transitions.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { setupFullscreenHandler } from '../fullscreenHandler';
import { fadeInViewer, fadeOutViewer, restoreViewerVisibility } from './viewerFade';

export default function useFullscreenControls({ hasMesh, resize, requestRender } = {}) {
  const [isFullscreenMode, setIsFullscreenMode] = useState(false);
  const [isRegularFullscreen, setIsRegularFullscreen] = useState(false);

  useEffect(() => {
    const fullscreenRoot = document.getElementById('app');
    const viewerEl = document.getElementById('viewer');
    if (!fullscreenRoot || !viewerEl) return;

    return setupFullscreenHandler(fullscreenRoot, viewerEl, setIsFullscreenMode);
  }, [hasMesh]);

  useEffect(() => {
    const syncRegularFullscreen = () => {
      const fullscreenRoot = document.getElementById('app');
      setIsRegularFullscreen(Boolean(document.fullscreenElement));
      if (!document.fullscreenElement && fullscreenRoot?.classList.contains('fullscreen-mode-fallback')) {
        fullscreenRoot.classList.remove('fullscreen-mode-fallback');
        setIsFullscreenMode(false);
      }
    };

    syncRegularFullscreen();
    document.addEventListener('fullscreenchange', syncRegularFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncRegularFullscreen);
  }, []);

  const handleToggleFullscreenMode = useCallback(async () => {
    const fullscreenRoot = document.getElementById('app');
    const viewerEl = document.getElementById('viewer');
    if (!fullscreenRoot) return;

    try {
      await fadeOutViewer(viewerEl);

      if (fullscreenRoot.classList.contains('fullscreen-mode-fallback')) {
        fullscreenRoot.classList.remove('fullscreen-mode-fallback');
        setIsFullscreenMode(false);
        resize();
        requestRender();
      } else if (document.fullscreenElement === fullscreenRoot) {
        await document.exitFullscreen();
      } else if (document.fullscreenElement === document.documentElement) {
        fullscreenRoot.classList.add('fullscreen-mode-fallback');
        setIsFullscreenMode(true);
        resize();
        requestRender();
      } else {
        await fullscreenRoot.requestFullscreen();
      }

      fadeInViewer(viewerEl, { resize, requestRender });
    } catch (err) {
      console.warn('Fullscreen toggle failed:', err);
      restoreViewerVisibility(viewerEl);
    }
  }, [resize, requestRender]);

  const handleToggleRegularFullscreen = useCallback(async () => {
    const viewerEl = document.getElementById('viewer');
    const fullscreenRoot = document.getElementById('app');

    try {
      await fadeOutViewer(viewerEl);

      if (document.fullscreenElement) {
        if (fullscreenRoot?.classList.contains('fullscreen-mode-fallback')) {
          fullscreenRoot.classList.remove('fullscreen-mode-fallback');
          setIsFullscreenMode(false);
        }
        await document.exitFullscreen();
      } else {
        if (fullscreenRoot?.classList.contains('fullscreen-mode-fallback')) {
          fullscreenRoot.classList.remove('fullscreen-mode-fallback');
          setIsFullscreenMode(false);
        }
        await document.documentElement.requestFullscreen();
      }

      fadeInViewer(viewerEl, { resize, requestRender });
    } catch (err) {
      console.warn('Regular fullscreen toggle failed:', err);
      restoreViewerVisibility(viewerEl);
    }
  }, [resize, requestRender]);

  return {
    isFullscreenMode,
    isRegularFullscreen,
    handleToggleFullscreenMode,
    handleToggleRegularFullscreen,
  };
}
