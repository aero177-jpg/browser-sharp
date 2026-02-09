/**
 * Slideshow options modal.
 * Provides quick access to slideshow-related settings.
 */

import { useCallback } from 'preact/hooks';
import { useStore } from '../store';
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

function SlideshowOptionsModal({ isOpen, onClose }) {
  const slideMode = useStore((state) => state.slideMode);
  const continuousMotionSize = useStore((state) => state.continuousMotionSize);
  const continuousMotionDuration = useStore((state) => state.continuousMotionDuration);
  const slideshowContinuousMode = useStore((state) => state.slideshowContinuousMode);
  const slideshowDuration = useStore((state) => state.slideshowDuration);

  const setSlideModeStore = useStore((state) => state.setSlideMode);
  const setContinuousMotionSizeStore = useStore((state) => state.setContinuousMotionSize);
  const setContinuousMotionDurationStore = useStore((state) => state.setContinuousMotionDuration);
  const setSlideshowContinuousModeStore = useStore((state) => state.setSlideshowContinuousMode);
  const setSlideshowDurationStore = useStore((state) => state.setSlideshowDuration);

  const handleContinuousDurationChange = useCallback((e) => {
    const value = Number(e.target.value);
    setContinuousMotionDurationStore(value);
  }, [setContinuousMotionDurationStore]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="slideshow-options-modal" maxWidth={420}>
      <div class="settings-group" style={{ padding: '6px 2px' }}>
        <div class="group-content" style={{ display: 'flex' }}>
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
