/**
 * Slideshow options modal.
 * Provides quick access to slideshow-related settings.
 */

import { useCallback } from 'preact/hooks';
import { useStore } from '../store';
import { saveCustomAnimationSettings } from '../fileStorage';
import { updateCustomAnimationInCache, clearCustomAnimationInCache } from '../splatManager';
import Modal from './Modal';

const SLIDE_MODE_OPTIONS = [
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'fade', label: 'Fade' },
];

const CONTINUOUS_SIZE_OPTIONS = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

const ZOOM_PROFILE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'near', label: 'Near' },
  { value: 'medium', label: 'Medium' },
  { value: 'far', label: 'Far' },
];

function SlideshowOptionsModal({ isOpen, onClose }) {
  const slideMode = useStore((state) => state.slideMode);
  const continuousMotionSize = useStore((state) => state.continuousMotionSize);
  const continuousMotionDuration = useStore((state) => state.continuousMotionDuration);
  const slideshowContinuousMode = useStore((state) => state.slideshowContinuousMode);
  const continuousDollyZoom = useStore((state) => state.continuousDollyZoom);
  const slideshowDuration = useStore((state) => state.slideshowDuration);
  const assets = useStore((state) => state.assets);
  const currentAssetIndex = useStore((state) => state.currentAssetIndex);
  const fileCustomAnimation = useStore((state) => state.fileCustomAnimation);
  const currentFileName = useStore((state) => state.fileInfo?.name);

  const setSlideModeStore = useStore((state) => state.setSlideMode);
  const setContinuousMotionSizeStore = useStore((state) => state.setContinuousMotionSize);
  const setContinuousMotionDurationStore = useStore((state) => state.setContinuousMotionDuration);
  const setSlideshowContinuousModeStore = useStore((state) => state.setSlideshowContinuousMode);
  const setContinuousDollyZoomStore = useStore((state) => state.setContinuousDollyZoom);
  const setSlideshowDurationStore = useStore((state) => state.setSlideshowDuration);
  const setFileCustomAnimation = useStore((state) => state.setFileCustomAnimation);

  const handleContinuousDurationChange = useCallback((e) => {
    const value = Number(e.target.value);
    setContinuousMotionDurationStore(value);
  }, [setContinuousMotionDurationStore]);

  const handleZoomProfileChange = useCallback((e) => {
    const zoomProfile = e.target.value;
    setFileCustomAnimation({ zoomProfile });
    const currentAssetId = assets?.[currentAssetIndex]?.id;

    if (currentFileName && currentFileName !== '-') {
      const payload = zoomProfile === 'default' ? {} : { zoomProfile };
      saveCustomAnimationSettings(currentFileName, payload)
        .catch(err => {
          console.warn('Failed to save custom animation settings:', err);
        });
    }

    if (currentAssetId) {
      if (zoomProfile === 'default') {
        clearCustomAnimationInCache(currentAssetId);
      } else {
        updateCustomAnimationInCache(currentAssetId, { zoomProfile });
      }
    }
  }, [setFileCustomAnimation, currentFileName, assets, currentAssetIndex]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth={380} >
       <h3 style={{marginBottom: "0px"}}>Slideshow Options</h3>
      <div class="settings-group" style={{ padding: '6px 2px' }}>
        <div class="group-content" style={{ display: 'flex', marginTop: '14px', flexDirection: 'column', gap: '12px' }}>
          <div class="control-row select-row">
            <span class="control-label">Slide</span>
            <select value={slideMode} onChange={(e) => setSlideModeStore(e.target.value)}>
              {SLIDE_MODE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {slideshowContinuousMode && slideMode !== 'fade' && (
            <div class="control-row select-row">
              <span class="control-label">Transition range</span>
              <select value={continuousMotionSize} onChange={(e) => setContinuousMotionSizeStore(e.target.value)}>
                {CONTINUOUS_SIZE_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          )}

          {slideMode === 'zoom' && (
            <div class="control-row select-row">
              <span class="control-label">Zoom target</span>
              <select
                value={fileCustomAnimation?.zoomProfile ?? 'default'}
                onChange={handleZoomProfileChange}
              >
                {ZOOM_PROFILE_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          )}

          {slideMode === 'zoom' && slideshowContinuousMode && (
            <div class="control-row animate-toggle-row">
              <span class="control-label">Dolly Zoom</span>
              <label class="switch">
                <input
                  type="checkbox"
                  checked={continuousDollyZoom}
                  onChange={(e) => setContinuousDollyZoomStore(e.target.checked)}
                />
                <span class="switch-track" aria-hidden="true" />
              </label>
            </div>
          )}

          {slideMode !== 'fade' && (
            <div class="control-row animate-toggle-row">
              <span class="control-label">Continuous Mode</span>
              <label class="switch">
                <input
                  type="checkbox"
                  checked={slideshowContinuousMode}
                  onChange={(e) => setSlideshowContinuousModeStore(e.target.checked)}
                />
                <span class="switch-track" aria-hidden="true" />
              </label>
            </div>
          )}

          {slideshowContinuousMode && slideMode !== 'fade' ? (
            <div class="control-row">
              <span class="control-label">Duration</span>
              <div class="control-track">
                <input
                  type="range"
                  min="3"
                  max="20"
                  step="1"
                  value={Math.max(1, (continuousMotionDuration ?? 2) - 1)}
                  onInput={handleContinuousDurationChange}
                />
                <span class="control-value">{Math.max(1, (continuousMotionDuration ?? 2) - 1)}s</span>
              </div>
            </div>
          ) : (
            <div class="control-row">
              <span class="control-label">Hold Time</span>
              <div class="control-track">
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={slideshowDuration}
                  onInput={(e) => setSlideshowDurationStore(Number(e.target.value))}
                />
                <span class="control-value">{slideshowDuration}s</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default SlideshowOptionsModal;
