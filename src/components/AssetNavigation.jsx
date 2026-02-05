/**
 * AssetNavigation component
 * Provides back/forward buttons and swipe gestures for asset navigation.
 */
import { useCallback, useRef } from 'preact/hooks';
import useSwipe from '../utils/useSwipe';
import { useStore } from '../store';
import { loadNextAsset, loadPrevAsset } from '../fileLoader';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight, faPause, faPlay } from '@fortawesome/free-solid-svg-icons';
import { startSlideshow, stopSlideshow } from '../slideshowController';

function AssetNavigation() {
  const assets = useStore((state) => state.assets);
  const slideshowMode = useStore((state) => state.slideshowMode);
  const slideshowPlaying = useStore((state) => state.slideshowPlaying);
  const hasMultipleAssets = assets.length > 1;
  const swipeRef = useRef(null);

  const handleSwipe = useCallback(({ dir }) => {
    if (dir === 'left') {
      loadNextAsset();
    } else if (dir === 'right') {
      loadPrevAsset();
    }
  }, []);

  // useSwipe hook for horizontal swipes
  useSwipe(swipeRef, {
    direction: 'horizontal',
    threshold: 40,
    onSwipe: handleSwipe,
  });

  if (!hasMultipleAssets) {
    return null;
  }

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      <button
        class="bottom-page-btn"
        onClick={loadPrevAsset}
        aria-label="Previous asset"
        title="Previous asset"
      >
        <FontAwesomeIcon icon={faChevronLeft} />
      </button>
      {slideshowMode && (
        <button
          class="bottom-page-btn"
          onClick={slideshowPlaying ? stopSlideshow : startSlideshow}
          aria-label={slideshowPlaying ? 'Pause slideshow' : 'Play slideshow'}
          title={slideshowPlaying ? 'Pause slideshow' : 'Play slideshow'}
        >
          <FontAwesomeIcon icon={slideshowPlaying ? faPause : faPlay} />
        </button>
      )}
      <button
        class="bottom-page-btn"
        onClick={loadNextAsset}
        aria-label="Next asset"
        title="Next asset"
      >
        <FontAwesomeIcon icon={faChevronRight} />
      </button>
    </div>
  );
}

export default AssetNavigation;
