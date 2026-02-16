/**
 * Upload status overlay component.
 *
 * Stages:
 *   upload       → "Uploading" + spinner, no bar
 *   warmup       → "GPU warm-up" + bar + countdown
 *   processing   → "Processing image X of Y" + bar + countdown
 *   transferring → "Transferring X files to storage" + spinner, no bar
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronRight } from '@fortawesome/free-solid-svg-icons';

const formatEta = (seconds) => {
  const remaining = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

function UploadStatusOverlay({ isUploading, uploadProgress, variant = 'default', onDismiss }) {
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  const showUploadProgress = isUploading && (
    uploadProgress?.stage
    || uploadProgress?.upload?.total
    || uploadProgress?.timer
    || uploadProgress?.error
    || uploadProgress?.total
  );

  useEffect(() => {
    setShowErrorDetails(false);
  }, [uploadProgress?.error?.detail, uploadProgress?.error?.message]);

  const viewModel = useMemo(() => {
    if (!showUploadProgress) return null;

    const stage = uploadProgress?.stage || 'upload';
    const timer = uploadProgress?.timer || null;
    const totalFiles = timer?.totalFiles || uploadProgress?.total || 0;
    const error = uploadProgress?.error || null;
    const batch = uploadProgress?.batch || null;
    const batchPrefix = batch?.total > 1
      ? `Batch ${batch?.index || 1} of ${batch?.total} • `
      : '';

    if (stage === 'error' || error) {
      return {
        stageLabel: `${batchPrefix}${error?.message || 'Process failed'}`,
        showSpinner: false,
        showErrorIcon: true,
        showBar: false,
        etaLabel: '',
        progressPercent: 0,
        errorDetail: error?.detail || '',
        errorMessage: error?.message || 'Process failed',
      };
    }

    // Upload stage: just "Uploading" + spinner, no bar or file count
    if (stage === 'upload') {
      return {
        stageLabel: `${batchPrefix}Uploading`,
        showSpinner: true,
        showErrorIcon: false,
        showBar: false,
        etaLabel: '',
        progressPercent: 0,
      };
    }

    // Transferring stage: files done processing, moving to storage
    if (stage === 'transferring') {
      const label = totalFiles > 1
        ? `Sending results to storage`
        : 'Sending to storage';
      return {
        stageLabel: `${batchPrefix}${label}`,
        showSpinner: true,
        showErrorIcon: false,
        showBar: false,
        etaLabel: '',
        progressPercent: 100,
      };
    }

    // Warmup / Processing: bar + countdown timer
    const percent = timer?.percent ?? 0;
    const remainingMs = timer?.remainingMs ?? 0;
    const currentFile = timer?.currentFile || 0;
    const etaSeconds = Math.ceil(remainingMs / 1000);
    const etaLabel = etaSeconds > 0 ? formatEta(etaSeconds) : '';

    const stageLabel = stage === 'warmup'
      ? `${batchPrefix}GPU warm-up`
      : totalFiles > 1
      ? `${batchPrefix}Processing ${currentFile} of ${totalFiles}`
      : `${batchPrefix}Processing image`;

    return {
      stageLabel,
      showSpinner: false,
      showErrorIcon: false,
      showBar: true,
      etaLabel,
      progressPercent: Math.min(100, Math.max(0, Math.round(percent))),
    };
  }, [showUploadProgress, uploadProgress]);

  if (!showUploadProgress || !viewModel) return null;

  const variantClass = variant && variant !== 'default' ? ` ${variant}` : '';
  const titleClass = viewModel.showSpinner || viewModel.showErrorIcon
    ? 'viewer-upload-title has-spinner'
    : 'viewer-upload-title';

  return (
    <div class={`viewer-upload-overlay${variantClass}`}>
      <div class={titleClass}>
        <span>{viewModel.stageLabel}</span>
        {viewModel.showSpinner && <span class="viewer-upload-spinner" />}
        {viewModel.showErrorIcon && (
          <button
            type="button"
            class="viewer-upload-error-close"
            onClick={onDismiss}
            aria-label="Close"
          >
            <span class="viewer-upload-error-icon">✕</span>
          </button>
        )}
      </div>
      {viewModel.etaLabel && (
        <div class="viewer-upload-meta">
          <span class="viewer-upload-eta">{viewModel.etaLabel}</span>
        </div>
      )}
      {(viewModel.errorDetail || viewModel.showErrorIcon) && (
        <div class="viewer-upload-error">
          <button
            type="button"
            class="viewer-upload-error-toggle"
            onClick={() => setShowErrorDetails((value) => !value)}
          >
            <span class={`viewer-upload-error-caret${showErrorDetails ? ' is-open' : ''}`}>
              <FontAwesomeIcon icon={faChevronRight} />
            </span>
            Show error message
          </button>
          {showErrorDetails && (
            <div class="viewer-upload-error-detail">
              {viewModel.errorDetail || 'No error detail provided.'}
            </div>
          )}
        </div>
      )}
      {viewModel.showBar && (
        <div class="viewer-upload-bar">
          <div class="viewer-upload-bar-fill" style={{ width: `${viewModel.progressPercent}%` }} />
        </div>
      )}
    </div>
  );
}

export default UploadStatusOverlay;
