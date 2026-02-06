import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
import Modal from './Modal';

const Section = ({ title, children, defaultOpen = false }) => {
  return (
    <details
      open={defaultOpen}
      class="controls-section"
    >
      <summary class="controls-section__summary">
        <FontAwesomeIcon icon={faChevronRight} className="controls-section__chevron" />
        <span class="controls-section__title">{title}</span>
      </summary>
      <div class="controls-section__content">
        <div class="controls-section__content-inner">{children}</div>
      </div>
    </details>
  );
};

function ControlsModal({ isOpen, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth={650}>
      <div class="controls-modal">
        <div class="controls-modal__intro">
          <h2 class="controls-modal__title">Settings Overview</h2>
          <p class="controls-modal__subtitle">
            This viewer has a focus on splats with an intended perspective, like "images with depth". 
            This is not recommended for navigating large environmental splats or 360 exploration. 
            We highly recommend using <strong>.sog</strong> formatted splats for storage and performance gains. 
        </p>
        <p class="controls-modal__subtitle" style={{marginTop: "4px"}}>
            <a
              href="https://github.com/aero177-jpg/ml-sharp-optimized"
              target="_blank"
              rel="noreferrer"
            >
              This ml-sharp fork
            </a>{' '}
            includes a fast sog export in the pipeline, and includes camera metadata for clean integration with this viewer.
          </p>
        </div>

        <div class="controls-modal__scroll">
          <Section title="Main Settings" defaultOpen={true}>
            <ul>
              <li><strong>Quality:</strong> Adjusts splat density. Experimental is a last resort option, not recommended. Further adjustments can be made in advanced settings.</li>
              <li><strong>Orbit range:</strong> ml-sharp splats degrade at greater angles, this mitigates this and keeps focus on the target view. Auto adjusts in immersive mode on mobile. Disabled for non "ml-sharp" monocular view splats.</li>
              <li><strong>FOV:</strong> Auto adjust depending on camera metadata. Click the eye symbol to add a slider to the viewer for a dolly-zoom effect.</li>
              <li><strong>Recenter:</strong> Bring camera back to starting point. Hold to reset viewer, for example due to render glitch.</li>
              <li><strong>Set focus depth:</strong> Orbit and zoom to a specified depth. Either click on the splat when prompted, or double click to focus on a point of interest, and click "set anchor as focus". Custom focus will be stored.</li>
            </ul>
          </Section>

          <Section title="Additional Settings">
            <ul>
              <li><strong>Custom Camera:</strong> This viewer auto sets the camera for optimal viewing of ml-sharp generated monocular view splats (with metadata). For others, manually adjust: scale to fill, rotate, double click, and zoom to frame intended view. Hit-or-miss, but worth experimenting.</li>
              <li><strong>Tilt Sensitivity:</strong> Adjusts how device rotation effects view in immersive mode.</li>
              <li><strong>VR toggle:</strong> Appears if an HMD is detected.</li>
              <li><strong>SBS separation:</strong> Appears if sbs enabled in advanced settings (experimental). Effects stereo depth perceived. Click focus icon for auto adjust.</li>
              <li><strong>SBS stereo aspect:</strong> Manual aspect ratio adjustment to match display.</li>
            </ul>
          </Section>

          <Section title="Controls">
            <ul>
              <li><strong>Double click:</strong> Zoom/orbit around point (hit refresh to clear).</li>
              <li><strong>Click-drag:</strong> Orbit.</li>
              <li><strong>Right click-drag:</strong> Pan.</li>
              <li><strong>Scroll:</strong> Zoom.</li>
              <li><strong>Click:</strong> Toggle UI in fullscreen mode.</li>
              <li><strong>Spacebar:</strong> Reset camera, or click focus icon in viewer.</li>
              <li><strong>Arrow keys:</strong> Advance splats.</li>
              <li><strong>F11:</strong> Will open normal browser fullscreen, but the fullscreen toggle needs to be clicked in the viewer to get intended "fullscreen mode".</li>
            </ul>
          </Section>

          <Section title="Mobile Controls">
            <ul>
              <li>Pinch to zoom, drag to orbit, two finger drag to pan.</li>
              <li>Swipe or tap left side of screen to toggle gallery panel.</li>
              <li>In landscape, swipe/tap right side (or click upper right button) to open main menu. In portrait, swipe/tap bottom.</li>
              <li>Swipe left or right in the lower part of the viewer (area with arrows) to advance splats.</li>
              <li><strong>Immersive mode:</strong> **Only tested on Android. Toggle with '3d rotate' icon in viewer. drag to pan while moving device to orbit. Click focus icon to fix device sensor drift or set current device angle as centered.</li>
            </ul>
          </Section>

          <Section title="Render Troubleshooting">
            <ul>
              <li><strong>Cropped render:</strong> The viewer crops splats to improve performance. If edges are revealed in "fit to size", resize window or hold recenter button to fix.</li>
              <li><strong>Distorted preview:</strong> Previews generated on first load may capture partial renders. Click "regen preview" in advanced settings to fix (persisted).</li>
              <li><strong>Background glow:</strong> A copy of the preview for effect. May not appear on first render.Regenerate preview to correct issues, or remove in advanced settings.</li>
              <li><strong>Missing previews:</strong> Only generated on first load. Click "batch previews" in advanced settings to generate all (experimental; captures previews by rapidly loading splats).</li>
              <li><strong>'Cracks' in splat:</strong> Thin areas may show cracks in low quality. "High" quality alleviates this but impacts performance.</li>
            </ul>
          </Section>

        </div>
      </div>
    </Modal>
  );
}

export default ControlsModal;
