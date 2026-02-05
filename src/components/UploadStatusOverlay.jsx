/**
 * Upload status overlay component.
 */

import { useMemo } from 'preact/hooks';

const formatEta = (seconds) => {
  const remaining = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

function UploadStatusOverlay({ isUploading, uploadProgress, variant = 'default' }) {
  const showUploadProgress = isUploading && (uploadProgress?.total || uploadProgress?.upload?.total || uploadProgress?.estimate);

  const viewModel = useMemo(() => {
    if (!showUploadProgress) return null;

    const uploadStage = uploadProgress?.stage || (uploadProgress?.estimate ? 'processing' : 'upload');
    const uploadDone = Boolean(uploadProgress?.upload?.done);
    const estimate = uploadProgress?.estimate || null;
    const hasFileCount = Number.isFinite(uploadProgress?.total);
    const fileCompleted = hasFileCount ? (uploadProgress?.completed || 0) : 0;
    const fileTotal = hasFileCount ? uploadProgress?.total : 0;
    const uploadBytesTotal = uploadProgress?.upload?.total || 0;
    const uploadBytesLoaded = uploadProgress?.upload?.loaded || 0;

    const uploadPercent = uploadBytesTotal
      ? Math.min(100, Math.round((uploadBytesLoaded / uploadBytesTotal) * 100))
      : null;
    const estimatePercent = estimate?.stageProgress != null
      ? Math.min(100, Math.round(estimate.stageProgress * 100))
      : null;
    const fallbackPercent = fileTotal
      ? Math.min(100, Math.round((fileCompleted / fileTotal) * 100))
      : 0;

    const progressPercent = uploadStage === 'upload'
      ? (uploadPercent ?? fallbackPercent)
      : (estimatePercent ?? fallbackPercent);

    const etaSeconds = estimate?.remainingMs != null
      ? Math.ceil(estimate.remainingMs / 1000)
      : 0;
    const etaLabel = etaSeconds ? formatEta(etaSeconds) : '';

    const currentFile = estimate?.currentFile || 0;
    const totalFiles = estimate?.totalFiles || 0;
    const isWarmup = uploadStage === 'warmup';
    const isProcessing = uploadStage === 'processing';

    const stageLabel = uploadStage === 'upload'
      ? (uploadDone ? 'Upload complete' : 'Uploading')
      : isWarmup
      ? 'GPU warm-up'
      : isProcessing && totalFiles > 1
      ? `Processing ${currentFile}/${totalFiles}`
      : 'Processing (est.)';

    const fileCountLabel = isProcessing && totalFiles > 1 && currentFile > 0
      ? `${currentFile}/${totalFiles}`
      : fileTotal > 0
      ? `${fileCompleted}/${fileTotal}`
      : '';

    const estimateElapsedMs = estimate?.elapsedMs || 0;
    const estimateFileCount = totalFiles || fileTotal || 1;
    const warnAfterMs = 60000 + estimateFileCount * 30000;
    const failAfterMs = 300000 + estimateFileCount * 50000;
    const showSlowWarning = (isWarmup || isProcessing) && !estimate?.done && estimateElapsedMs > warnAfterMs;
    const showFailWarning = (isWarmup || isProcessing) && !estimate?.done && estimateElapsedMs > failAfterMs;
    const warningText = showFailWarning
      ? 'This is taking longer than expected and may have failed. Collection will refresh when ready.'
      : showSlowWarning
      ? 'Taking longer than expected. Collection will refresh when ready.'
      : '';

    return {
      stageLabel,
      fileCountLabel,
      etaLabel,
      warningText,
      progressPercent,
    };
  }, [showUploadProgress, uploadProgress]);

  if (!showUploadProgress || !viewModel) return null;

  const variantClass = variant && variant !== 'default' ? ` ${variant}` : '';

  return (
    <div class={`viewer-upload-overlay${variantClass}`}>
      <div class="viewer-upload-title">{viewModel.stageLabel}</div>
      <div class="viewer-upload-meta">
        {viewModel.fileCountLabel && (
          <span>{viewModel.fileCountLabel}</span>
        )}
        {viewModel.etaLabel && <span class="viewer-upload-eta">{viewModel.etaLabel}</span>}
      </div>
      {viewModel.warningText && (
        <div class="viewer-upload-warning">{viewModel.warningText}</div>
      )}
      <div class="viewer-upload-bar">
        <div class="viewer-upload-bar-fill" style={{ width: `${viewModel.progressPercent}%` }} />
      </div>
    </div>
  );
}

export default UploadStatusOverlay;
