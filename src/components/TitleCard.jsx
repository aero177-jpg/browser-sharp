/**
 * Landing title card overlay for loading assets.
 * Sits above the app layout and handles file/storage/demo actions.
 */
import { useEffect, useState } from 'preact/hooks';
import FrostedTitle from './FrostedTitle';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faCloud, faRocket, faUpload } from '@fortawesome/free-solid-svg-icons';
import { testSharpCloud } from '../testSharpCloud';

function TitleCard({
  show,
  onPickFile,
  onOpenStorage,
  onLoadDemo,
}) {
  // Responsive mask height (tight mask on narrow screens)
  const [maskHeight, setMaskHeight] = useState(() => {
    if (typeof window === 'undefined') return 150;
    return window.innerWidth <= 500 ? 80 : 150;
  });

  // Button entrance visibility
  const [buttonsVisible, setButtonsVisible] = useState(false);

  const handleTestCloudUpload = () => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.accept = 'image/*';
    picker.onchange = (event) => {
      const selectedFiles = event?.target?.files;
      if (selectedFiles && selectedFiles.length > 0) {
        testSharpCloud(selectedFiles);
      }
      picker.remove();
    };
    picker.click();
  };

  useEffect(() => {
    if (!show) {
      setButtonsVisible(false);
      return undefined;
    }
    const resizeHandler = () => {
      setMaskHeight(window.innerWidth <= 500 ? 80 : 180);
    };
    resizeHandler();
    window.addEventListener('resize', resizeHandler);

    const timer = setTimeout(() => setButtonsVisible(true), 1000);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', resizeHandler);
    };
  }, [show]);

  if (!show) return null;

  const actionButtonsClass = `action-buttons ${buttonsVisible ? 'is-visible' : ''}`;

  return (
    <div class="title-card-overlay">
      <div class="title-card">
        <FrostedTitle
          backgroundImage="/neonstatic2.png"
          title="Radia"
          height={520}
          maskHeight={maskHeight}
          animation="rotate"
          showStroke
        />
        <div class="title-card__content">
          <div class={actionButtonsClass}>
            <button class="action-btn browse" onClick={onPickFile}>
              <FontAwesomeIcon icon={faFolder} />
              <span>Browse Files</span>
            </button>
            <button class="action-btn storage" onClick={onOpenStorage}>
              <FontAwesomeIcon icon={faCloud} />
              <span>Connect Storage</span>
            </button>
            <button class="action-btn cloud-test" onClick={handleTestCloudUpload}>
              <FontAwesomeIcon icon={faUpload} />
              <span>Test Cloud Upload</span>
            </button>
            <button class="action-btn demo" onClick={onLoadDemo}>
              <FontAwesomeIcon icon={faRocket} />
              <span>Load Demo Collection</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TitleCard;
