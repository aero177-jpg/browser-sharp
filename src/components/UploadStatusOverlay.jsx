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

const PHASE_LABELS = {
  queued: 'Queued',
  starting_worker: 'Warming up GPU',
  dispatching_inference: 'Warming up GPU',
  preparing_gpu: 'Warming up GPU',
  checking_model_cache: 'Warming up GPU',
  downloading_model: 'Downloading model',
  loading_model: 'Warming up GPU',
  model_ready: 'Warming up GPU',
  processing_images: 'Processing image',
  serializing_outputs: 'Processing image',
  inference_complete: 'Processing image',
  uploading_or_staging_results: 'Sending results to storage',
  completed: 'Completed',
  failed: 'Failed',
  validation_failed: 'Validation failed',
};

const TERMINAL_STATUSES = new Set(['completed', 'failed']);
const LOCAL_TICK_MS = 250;
const WARMUP_MS = 40000;
const IMAGE_STEP_MS = 10000;
const WARMUP_MISS_PENALTY_MS = 5000;
const IMAGE_STEP_MISS_PENALTY_MS = 2000;

const normalizeStep = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
};

const getElapsedMs = (timerState, nowMs) => {
  if (!timerState) return 0;
  if (timerState.terminal) return timerState.elapsedMs;
  return Math.max(0, timerState.elapsedMs + (nowMs - timerState.anchorMs));
};

const normalizePhase = (value) => String(value || '').trim().toLowerCase();
const normalizeStatus = (value) => String(value || '').trim().toLowerCase();

const resolveStageLabel = ({ stage, phase, currentFile, totalFiles, batchPrefix }) => {
  if (phase === 'uploading_or_staging_results') {
    return `${batchPrefix}Sending results to storage`;
  }

  if (phase && PHASE_LABELS[phase]) {
    if ((phase === 'processing_images' || phase === 'serializing_outputs' || phase === 'inference_complete') && totalFiles > 1) {
      return `${batchPrefix}Processing ${Math.max(1, currentFile || 1)} of ${totalFiles}`;
    }
    return `${batchPrefix}${PHASE_LABELS[phase]}`;
  }

  if (stage === 'upload') return `${batchPrefix}Uploading`;
  if (stage === 'transferring') return `${batchPrefix}Sending results to storage`;
  if (stage === 'warmup') return `${batchPrefix}Warming up GPU`;
  if (stage === 'processing' && totalFiles > 1) {
    return `${batchPrefix}Processing ${Math.max(1, currentFile || 1)} of ${totalFiles}`;
  }
  if (stage === 'processing') return `${batchPrefix}Processing image`;
  return `${batchPrefix}Processing…`;
};

const formatEta = (seconds) => {
  const remaining = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

function UploadStatusOverlay({ isUploading, uploadProgress, variant = 'default', onDismiss }) {
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [showDetailMessage, setShowDetailMessage] = useState(false);
  const [liveTimer, setLiveTimer] = useState(null);

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

  useEffect(() => {
    setShowDetailMessage(false);
  }, [uploadProgress?.message, uploadProgress?.phase, uploadProgress?.stage]);

  useEffect(() => {
    if (!showUploadProgress) {
      setLiveTimer(null);
      return;
    }

    const stage = uploadProgress?.stage || 'upload';
    const phase = normalizePhase(uploadProgress?.phase);
    const status = normalizeStatus(uploadProgress?.status);
    const isTerminalDone = status === 'completed' || phase === 'completed' || TERMINAL_STATUSES.has(status);
    const timer = uploadProgress?.timer || null;
    const isTimedStage = stage === 'warmup' || stage === 'processing' || phase === 'processing_images';

    if (!isTimedStage) {
      setLiveTimer(null);
      return;
    }

    const totalFiles = Math.max(1, normalizeStep(timer?.totalFiles || uploadProgress?.total || 1));
    const observedStep = Math.min(totalFiles, normalizeStep(timer?.currentFile));

    setLiveTimer((previous) => {
      const now = Date.now();
      const shouldReset = !previous || previous.totalFiles !== totalFiles;
      let base = shouldReset
        ? {
          totalMs: WARMUP_MS + (totalFiles * IMAGE_STEP_MS),
          elapsedMs: 0,
          anchorMs: now,
          terminal: false,
          confirmedStep: 0,
          totalFiles,
          nextDeadlineMs: WARMUP_MS,
        }
        : {
          ...previous,
          elapsedMs: getElapsedMs(previous, now),
          anchorMs: now,
        };

      if (isTerminalDone) {
        return {
          ...base,
          elapsedMs: Math.max(base.elapsedMs, base.totalMs),
          anchorMs: now,
          terminal: true,
        };
      }

      while (base.confirmedStep < observedStep) {
        base.elapsedMs = Math.max(base.elapsedMs, base.nextDeadlineMs);
        base.confirmedStep += 1;
        if (base.confirmedStep < base.totalFiles) {
          base.nextDeadlineMs = base.elapsedMs + IMAGE_STEP_MS;
        } else {
          base.nextDeadlineMs = base.totalMs;
        }
      }

      return {
        ...base,
        terminal: false,
      };
    });
  }, [showUploadProgress, uploadProgress]);

  useEffect(() => {
    if (!showUploadProgress || !liveTimer || liveTimer.terminal) return undefined;

    const timerId = setInterval(() => {
      setLiveTimer((previous) => {
        if (!previous || previous.terminal) return previous;

        const now = Date.now();
        let elapsedMs = Math.max(0, previous.elapsedMs + (now - previous.anchorMs));
        let totalMs = previous.totalMs;
        let nextDeadlineMs = previous.nextDeadlineMs;

        while (previous.confirmedStep < previous.totalFiles && elapsedMs >= nextDeadlineMs) {
          const penaltyMs = previous.confirmedStep <= 0
            ? WARMUP_MISS_PENALTY_MS
            : IMAGE_STEP_MISS_PENALTY_MS;
          totalMs += penaltyMs;
          nextDeadlineMs += penaltyMs;
        }

        return {
          ...previous,
          elapsedMs,
          totalMs,
          nextDeadlineMs,
          anchorMs: now,
        };
      });
    }, LOCAL_TICK_MS);

    return () => clearInterval(timerId);
  }, [showUploadProgress, liveTimer?.terminal]);

  const viewModel = useMemo(() => {
    if (!showUploadProgress) return null;

    const stage = uploadProgress?.stage || 'upload';
    const phase = normalizePhase(uploadProgress?.phase);
    const status = normalizeStatus(uploadProgress?.status);
    const timer = uploadProgress?.timer || null;
    const download = uploadProgress?.download || null;
    const totalFiles = timer?.totalFiles || uploadProgress?.total || 0;
    const currentFile = timer?.currentFile || 0;
    const error = uploadProgress?.error || null;
    const backendMessage = String(uploadProgress?.message || '').trim();
    const batch = uploadProgress?.batch || null;
    const batchPrefix = batch?.total > 1
      ? `Batch ${batch?.index || 1} of ${batch?.total} • `
      : '';
    const hasTerminalFailure = status === 'failed' || phase === 'failed' || phase === 'validation_failed';
    const isTerminalDone = status === 'completed' || phase === 'completed' || TERMINAL_STATUSES.has(status);

    if (stage === 'error' || error || hasTerminalFailure) {
      const errorMessage = error?.message || backendMessage || 'Process failed';
      return {
        stageLabel: `${batchPrefix}${errorMessage}`,
        showSpinner: false,
        showErrorIcon: true,
        showBar: false,
        etaLabel: '',
        progressPercent: 0,
        errorDetail: error?.detail || backendMessage || '',
        errorMessage,
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
        messageLabel: backendMessage || '',
      };
    }

    // Transferring stage: files done processing, moving to storage
    if (stage === 'transferring' || phase === 'uploading_or_staging_results') {
      return {
        stageLabel: `${batchPrefix}Sending results to storage`,
        showSpinner: true,
        showErrorIcon: false,
        showBar: false,
        etaLabel: '',
        progressPercent: 100,
        messageLabel: backendMessage || '',
      };
    }

    if (stage === 'downloading' || phase === 'downloading_results') {
      const totalDownloads = Math.max(1, Number(download?.total) || Number(timer?.totalFiles) || Number(totalFiles) || 1);
      const currentDownload = Math.max(1, Math.min(totalDownloads, Number(download?.current) || Number(timer?.currentFile) || 1));
      return {
        stageLabel: `${batchPrefix}Downloading ${currentDownload} of ${totalDownloads}`,
        showSpinner: true,
        showErrorIcon: false,
        showBar: false,
        etaLabel: '',
        progressPercent: 0,
        messageLabel: backendMessage || '',
      };
    }

    // Warmup / Processing: bar + countdown timer
    const now = Date.now();
    const liveElapsedMs = getElapsedMs(liveTimer, now);
    const directRemainingMs = Number.isFinite(timer?.remainingMs) ? Math.max(0, Math.round(timer.remainingMs)) : null;
    const directTotalMs = Number.isFinite(timer?.totalMs) ? Math.max(1000, Math.round(timer.totalMs)) : null;
    const totalMsSource = liveTimer?.totalMs ?? directTotalMs ?? (WARMUP_MS + (Math.max(1, Number(totalFiles) || 1) * IMAGE_STEP_MS));
    const totalMs = Math.max(1000, totalMsSource);
    const elapsedMs = liveTimer ? liveElapsedMs : Math.max(0, totalMs - (directRemainingMs ?? 0));
    const remainingMs = Math.max(0, totalMs - elapsedMs);
    const percentFromTime = Math.max(0, Math.min(100, Math.round((elapsedMs / totalMs) * 100)));
    const etaSeconds = Math.ceil(remainingMs / 1000);
    const etaLabel = etaSeconds > 0 ? formatEta(etaSeconds) : '';
    const stageLabel = resolveStageLabel({
      stage,
      phase,
      currentFile,
      totalFiles,
      batchPrefix,
    });
    const messageLabel = backendMessage && backendMessage.toLowerCase() !== stageLabel.toLowerCase()
      ? backendMessage
      : '';

    return {
      stageLabel,
      showSpinner: false,
      showErrorIcon: false,
      showBar: true,
      etaLabel,
      progressPercent: percentFromTime,
      messageLabel,
    };
  }, [showUploadProgress, uploadProgress, liveTimer]);

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
      {(viewModel.etaLabel || viewModel.messageLabel) && (
        <div class="viewer-upload-meta">
          <span class="viewer-upload-eta">{viewModel.etaLabel || '\u00a0'}</span>
          {viewModel.messageLabel && (
            <button
              type="button"
              class="viewer-upload-detail-toggle"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setShowDetailMessage((value) => !value);
              }}
              aria-label={showDetailMessage ? 'Hide detailed status' : 'Show detailed status'}
              aria-expanded={showDetailMessage}
            >
              <span class={`viewer-upload-error-caret${showDetailMessage ? ' is-open' : ''}`}>
                <FontAwesomeIcon icon={faChevronRight} />
              </span>
            </button>
          )}
        </div>
      )}
      {viewModel.messageLabel && showDetailMessage && (
        <div class="viewer-upload-meta">
          <span class="viewer-upload-eta">{viewModel.messageLabel}</span>
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
