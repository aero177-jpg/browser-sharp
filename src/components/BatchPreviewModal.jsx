/**
 * Batch preview confirmation modal.
 */

import Modal from './Modal';

function BatchPreviewModal({ isOpen, onClose, onConfirm, assetCount, isBusy }) {
  const safeCount = Number.isFinite(assetCount) ? assetCount : 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h3>Generate batch previews</h3>
      <p class="modal-note">
        This will rapidly load each file and capture a preview image.
         Click "Generate" to start the process for {safeCount} item{safeCount === 1 ? '' : 's'}.
      </p>

      <div class="modal-actions">
        <button onClick={onClose} disabled={isBusy}>Cancel</button>
        <button
          class="modal-confirm-btn"
          onClick={onConfirm}
          disabled={isBusy || safeCount === 0}
        >
          {isBusy ? 'Starting...' : 'Generate'}
        </button>
      </div>
    </Modal>
  );
}

export default BatchPreviewModal;
