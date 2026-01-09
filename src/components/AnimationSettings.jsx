/**
 * Animation settings component.
 * Controls for load animation behavior including enable/disable,
 * animation style (intensity), and sweep direction.
 */

import { useCallback } from 'preact/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faRotateRight } from '@fortawesome/free-solid-svg-icons';
import { useStore } from '../store';
import { setLoadAnimationEnabled, setLoadAnimationIntensity, setLoadAnimationDirection, startLoadZoomAnimation } from '../cameraAnimations';
import { saveAnimationSettings, savePreviewImage } from '../fileStorage';
import { scene, renderer, composer, THREE, currentMesh } from '../viewer';

/** Animation style options with display labels */
const INTENSITY_OPTIONS = [
  { value: 'subtle', label: 'Subtle' },
  { value: 'medium', label: 'Medium' },
  { value: 'dramatic', label: 'Dramatic' },
  { value: 'custom', label: 'Custom' },
];

/** Animation direction options with display labels */
const DIRECTION_OPTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'none', label: 'None' },
];

const ZOOM_TYPE_OPTIONS = [
  { value: 'in', label: 'In' },
  { value: 'out', label: 'Out' },
  { value: 'none', label: 'None' },
];

const EASING_OPTIONS = [
  { value: 'ease-in-out', label: 'Ease In Out' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-out', label: 'Ease Out' },
  { value: 'linear', label: 'Linear' },
];

/** Slide transition mode options */
const SLIDE_MODE_OPTIONS = [
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'fade', label: 'Fade' },
];

function AnimationSettings() {
  // Store state
  const animationEnabled = useStore((state) => state.animationEnabled);
  const animationIntensity = useStore((state) => state.animationIntensity);
  const animationDirection = useStore((state) => state.animationDirection);
  const slideMode = useStore((state) => state.slideMode);
  const animSettingsExpanded = useStore((state) => state.animSettingsExpanded);
  const customAnimation = useStore((state) => state.customAnimation);
  const currentFileName = useStore((state) => state.fileInfo?.name);
  
  // Store actions
  const setAnimationEnabledStore = useStore((state) => state.setAnimationEnabled);
  const setAnimationIntensityStore = useStore((state) => state.setAnimationIntensity);
  const setAnimationDirectionStore = useStore((state) => state.setAnimationDirection);
  const setSlideModeStore = useStore((state) => state.setSlideMode);
  const setCustomAnimation = useStore((state) => state.setCustomAnimation);
  const toggleAnimSettingsExpanded = useStore((state) => state.toggleAnimSettingsExpanded);

  /**
   * Persists current animation settings to IndexedDB.
   */
  const persistAnimationSettings = useCallback((enabled, intensity, direction) => {
    if (currentFileName && currentFileName !== '-') {
      saveAnimationSettings(currentFileName, {
        enabled,
        intensity,
        direction,
      }).catch(err => {
        console.warn('Failed to save animation settings:', err);
      });
    }
  }, [currentFileName]);

  /**
   * Toggles load animation on/off.
   * Updates both Zustand store and animation module state.
   */
  const handleToggleAnimation = useCallback((e) => {
    const enabled = e.target.checked;
    setAnimationEnabledStore(enabled);
    setLoadAnimationEnabled(enabled);
    persistAnimationSettings(enabled, animationIntensity, animationDirection);
  }, [setAnimationEnabledStore, persistAnimationSettings, animationIntensity, animationDirection]);

  /**
   * Changes animation intensity/style.
   * @param {Event} e - Change event from select element
   */
  const handleIntensityChange = useCallback((e) => {
    const intensity = e.target.value;
    setAnimationIntensityStore(intensity);
    setLoadAnimationIntensity(intensity);
    persistAnimationSettings(animationEnabled, intensity, animationDirection);
  }, [setAnimationIntensityStore, persistAnimationSettings, animationEnabled, animationDirection]);

  /**
   * Changes animation sweep direction.
   * @param {Event} e - Change event from select element
   */
  const handleDirectionChange = useCallback((e) => {
    const direction = e.target.value;
    setAnimationDirectionStore(direction);
    setLoadAnimationDirection(direction);
    persistAnimationSettings(animationEnabled, animationIntensity, direction);
  }, [setAnimationDirectionStore, persistAnimationSettings, animationEnabled, animationIntensity]);

  /**
   * Changes slide transition mode.
   * @param {Event} e - Change event from select element
   */
  const handleSlideModeChange = useCallback((e) => {
    const mode = e.target.value;
    setSlideModeStore(mode);
  }, [setSlideModeStore]);

  /**
   * Captures a preview thumbnail of the current render.
   * @returns {string|null} Data URL of captured image, or null if no mesh loaded
   */
  const capturePreviewThumbnail = () => {
    if (!currentMesh) return null;
    
    // Render with solid background for capture
    scene.background = new THREE.Color("#0c1018");
    renderer.setClearColor(0x0c1018, 1);
    composer.render();
    
    const dataUrl = renderer.domElement.toDataURL("image/jpeg", 0.85);
    
    // Restore transparent background
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    
    return dataUrl;
  };

  /**
   * Handles replay animation with preview capture.
   */
  const handleReplayAnimation = useCallback(() => {
    startLoadZoomAnimation({ 
      force: true,
      onComplete: () => {
        // Wait a few frames for render to stabilize, then capture preview
        let frameCount = 0;
        const waitAndCapture = () => {
          frameCount++;
          if (frameCount < 30) {
            requestAnimationFrame(waitAndCapture);
          } else {
            const previewUrl = capturePreviewThumbnail();
            if (previewUrl && currentFileName && currentFileName !== '-') {
              const sizeKB = (previewUrl.length * 0.75 / 1024).toFixed(1);
              console.log(`Preview updated (${sizeKB} KB)`);
              savePreviewImage(currentFileName, previewUrl).catch(err => {
                console.warn('Failed to save preview:', err);
              });
            }
          }
        };
        requestAnimationFrame(waitAndCapture);
      }
    });
  }, [currentFileName]);

  return (
    <div class="settings-group">
      {/* Collapsible header */}
      <button
        class="group-toggle"
        aria-expanded={animSettingsExpanded}
        onClick={toggleAnimSettingsExpanded}
      >
        <span class="settings-eyebrow">Animation Settings</span>
        <FontAwesomeIcon icon={faChevronDown} className="chevron" />
      </button>
      
      {/* Settings content */}
      <div 
        class="group-content" 
        style={{ display: animSettingsExpanded ? 'flex' : 'none' }}
      >
        {/* Enable/disable toggle */}
        <div class="control-row animate-toggle-row">
          <span class="control-label">Animate on load</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <label class="switch">
              <input
                type="checkbox"
                checked={animationEnabled}
                onChange={handleToggleAnimation}
              />
              <span class="switch-track" aria-hidden="true" />
            </label>
            <button
              class="replay-btn"
              onClick={handleReplayAnimation}
              title="Replay animation"
              aria-label="Replay animation"
            >
              <FontAwesomeIcon icon={faRotateRight} style={{fontSize: "12px"}} />
            </button>
          </div>
        </div>
        
        {/* Intensity selector */}
        <div class="control-row select-row">
          <span class="control-label">Style</span>
          <select value={animationIntensity} onChange={handleIntensityChange}>
            {INTENSITY_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {/* Slide mode selector */}
        <div class="control-row select-row">
          <span class="control-label">Slide</span>
          <select value={slideMode} onChange={handleSlideModeChange}>
            {SLIDE_MODE_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        
        {/* Direction selector - hidden in custom mode */}
        {animationIntensity !== 'custom' && (
          <div class="control-row select-row">
            <span class="control-label">Direction</span>
            <select value={animationDirection} onChange={handleDirectionChange}>
              {DIRECTION_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Custom settings - only shown when style is 'custom' */}
        {animationIntensity === 'custom' && (
          <>
            <div class="control-row">
              <span class="control-label">Duration</span>
              <div class="control-track">
                <input
                  type="range"
                  min="0"
                  max="5"
                  step="0.1"
                  value={customAnimation.duration}
                  onInput={(e) => setCustomAnimation({ duration: Number(e.target.value) })}
                />
                <span class="control-value">{customAnimation.duration}s</span>
              </div>
            </div>

            <div class="control-row select-row">
              <span class="control-label">Easing</span>
              <select value={customAnimation.easing} onChange={(e) => setCustomAnimation({ easing: e.target.value })}>
                {EASING_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div class="control-row select-row">
              <span class="control-label">Rotation</span>
              <select value={customAnimation.rotationType} onChange={(e) => setCustomAnimation({ rotationType: e.target.value })}>
                {DIRECTION_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {customAnimation.rotationType !== 'none' && (
              <div class="control-row">
                <span class="control-label">Degrees</span>
                <div class="control-track">
                  <input
                    type="range"
                    min="0"
                    max="60"
                    step="1"
                    value={customAnimation.rotation}
                    onInput={(e) => setCustomAnimation({ rotation: Number(e.target.value) })}
                  />
                  <span class="control-value">{customAnimation.rotation}°</span>
                </div>
              </div>
            )}

            <div class="control-row select-row">
              <span class="control-label">Zoom</span>
              <select value={customAnimation.zoomType} onChange={(e) => setCustomAnimation({ zoomType: e.target.value })}>
                {ZOOM_TYPE_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {customAnimation.zoomType !== 'none' && (
              <div class="control-row">
                <span class="control-label">Amount</span>
                <div class="control-track">
                  <input
                    type="range"
                    min="0"
                    max="4"
                    step="0.1"
                    value={customAnimation.zoom}
                    onInput={(e) => setCustomAnimation({ zoom: Number(e.target.value) })}
                  />
                  <span class="control-value">{customAnimation.zoom}x</span>
                </div>
              </div>
            )}

            <div class="control-row animate-toggle-row">
              <span class="control-label">Dolly Zoom</span>
              <label class="switch">
                <input
                  type="checkbox"
                  checked={customAnimation.dollyZoom}
                  onChange={(e) => setCustomAnimation({ dollyZoom: e.target.checked })}
                />
                <span class="switch-track" aria-hidden="true" />
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default AnimationSettings;
