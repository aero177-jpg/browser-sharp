/**
 * Fullscreen control hook using browser fullscreen only.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';

const getAppElement = () => document.getElementById('app') || document.documentElement;

const getFullscreenElement = () => {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
};

const isBrowserWindowFullscreen = () => {
  if (typeof window === 'undefined' || typeof window.screen === 'undefined') {
    return false;
  }

  const tolerancePx = 2;
  return (
    window.innerWidth >= window.screen.width - tolerancePx &&
    window.innerHeight >= window.screen.height - tolerancePx
  );
};

export default function useFullscreenControls({ resize, requestRender } = {}) {
  const [isRegularFullscreen, setIsRegularFullscreen] = useState(false);

  useEffect(() => {
    const syncRegularFullscreen = () => {
      const appEl = getAppElement();
      const hasFullscreenElement = Boolean(getFullscreenElement());
      const hasFallbackClass = Boolean(appEl?.classList?.contains('ios-fullscreen-fallback'));
      setIsRegularFullscreen(hasFullscreenElement || hasFallbackClass || isBrowserWindowFullscreen());
    };

    syncRegularFullscreen();
    document.addEventListener('fullscreenchange', syncRegularFullscreen);
    document.addEventListener('webkitfullscreenchange', syncRegularFullscreen);
    window.addEventListener('resize', syncRegularFullscreen);
    window.addEventListener('orientationchange', syncRegularFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', syncRegularFullscreen);
      document.removeEventListener('webkitfullscreenchange', syncRegularFullscreen);
      window.removeEventListener('resize', syncRegularFullscreen);
      window.removeEventListener('orientationchange', syncRegularFullscreen);
    };
  }, []);

  const handleToggleRegularFullscreen = useCallback(async () => {
    const appEl = getAppElement();
    if (!appEl) return;

    const requestFullscreen = appEl.requestFullscreen || appEl.webkitRequestFullscreen;
    const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;

    try {
      if (getFullscreenElement()) {
        if (exitFullscreen) {
          await Promise.resolve(exitFullscreen.call(document));
        }
        appEl.classList.remove('ios-fullscreen-fallback');
      } else {
        if (requestFullscreen) {
          await Promise.resolve(requestFullscreen.call(appEl));
        } else {
          appEl.classList.toggle('ios-fullscreen-fallback');
        }
      }

      requestAnimationFrame(() => {
        if (resize) resize();
        if (requestRender) requestRender();
      });
    } catch (err) {
      if (!getFullscreenElement()) {
        appEl.classList.toggle('ios-fullscreen-fallback');
      }
      console.warn('Regular fullscreen toggle failed:', err);
    }
  }, [resize, requestRender]);

  return {
    isRegularFullscreen,
    handleToggleRegularFullscreen,
  };
}
