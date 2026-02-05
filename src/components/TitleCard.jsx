/**
 * Landing title card overlay for loading assets.
 * Sits above the app layout and handles file/storage/demo actions.
 */
import { useEffect, useState, useCallback } from 'preact/hooks';
import FrostedTitle from './FrostedTitle';
import { testSharpCloud } from '../testSharpCloud';
import { FolderIcon, ServerIcon, RocketIcon, CollectionIcon, FolderOpenIcon } from '../icons/customIcons';
import { getSourcesArray, onSourceChange } from '../storage/index.js';
import StorageSourceList from './StorageSourceList';
import Modal from './Modal';

function TitleCard({
  show,
  onPickFile,
  onOpenStorage,
  onLoadDemo,
  onSelectSource,
  onOpenCloudGpu,
}) {
  // Keep the overlay mounted through fade-out; unmount after transition ends
  const [mounted, setMounted] = useState(show);

  // Responsive mask height (tight mask on narrow screens)
  const [maskHeight, setMaskHeight] = useState(() => {
    if (typeof window === 'undefined') return 150;
    return window.innerWidth <= 500 ? 80 : 150;
  });

  // Button entrance visibility
  const [buttonsVisible, setButtonsVisible] = useState(false);

  // Sources state for collections button
  const [sources, setSources] = useState(() => getSourcesArray());
  const [showCollectionsModal, setShowCollectionsModal] = useState(false);


  // Subscribe to source changes
  useEffect(() => {
    setSources(getSourcesArray());
    const unsubscribe = onSourceChange(() => {
      setSources(getSourcesArray());
    });
    return unsubscribe;
  }, []);

  const handleOpenCollections = useCallback(() => {
    setShowCollectionsModal(true);
  }, []);

  const handleCloseCollections = useCallback(() => {
    setShowCollectionsModal(false);
  }, []);

  const handleSelectSource = useCallback((sourceId) => {
    setShowCollectionsModal(false);
    onSelectSource?.(sourceId);
  }, [onSelectSource]);

  useEffect(() => {
    let unmountTimer;
    if (show) {
      setMounted(true);
    } else {
      unmountTimer = setTimeout(() => setMounted(false), 450);
    }
    return () => {
      if (unmountTimer) clearTimeout(unmountTimer);
    };
  }, [show]);

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

  const actionButtonsClass = `action-buttons ${buttonsVisible ? 'is-visible' : ''}`;

  // Render always and let parent control visibility via CSS class to allow fade transitions
  const overlayClass = `title-card-overlay ${show ? 'is-visible' : 'is-hidden'}`;

  if (!mounted) return null;

  return (
    <div class={overlayClass} inert={!show ? '' : undefined}>
      <div class="title-card">
        <FrostedTitle
          backgroundImage="/neonstaticblur.jpg"
          title="Radia"
          height={520}
          maskHeight={maskHeight}
          animation="rotate"
          showStroke
        />
        <div class="title-card__content">
          <div class={actionButtonsClass}>
            <button class="action-btn " onClick={onPickFile}>
              <FolderIcon size={16} />
              <span>B r o w s e </span>
            </button>
            <button class="action-btn " onClick={onOpenStorage}>
              <ServerIcon size={16} />
              <span>C o n n e c t</span>
            </button>
            {sources.length > 1 ? (
              <button class="action-btn " onClick={handleOpenCollections}>
                <FolderOpenIcon size={16} />
                <span>C o l l e c t i o n s</span>
              </button>
            ) : (
              <button class="action-btn " onClick={onLoadDemo}>
                <RocketIcon size={16} />
                <span>D e m o</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <Modal
        isOpen={showCollectionsModal}
        onClose={handleCloseCollections}
        maxWidth={480}
      >
        <h2>Collections</h2>
        <p class="dialog-subtitle">Select a collection to load.</p>

        <StorageSourceList
          onAddSource={onOpenStorage}
          onSelectSource={handleSelectSource}
          onOpenCloudGpu={onOpenCloudGpu}
          listOnly
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '24px' }}>
          <button
            class="secondary-button"
            onClick={handleCloseCollections}
            style={{ height: '36px', padding: '0 16px', minWidth: '80px', marginTop: '0' }}
          >
            Cancel
          </button>
        </div>
      </Modal>
    </div>
  );
}

export default TitleCard;
