import { loadCloudGpuSettings } from './storage/cloudGpuSettings.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const PHASE_TO_STAGE = {
  queued: 'warmup',
  starting_worker: 'warmup',
  dispatching_inference: 'warmup',
  preparing_gpu: 'warmup',
  checking_model_cache: 'warmup',
  downloading_model: 'warmup',
  loading_model: 'warmup',
  model_ready: 'warmup',
  processing_images: 'processing',
  serializing_outputs: 'processing',
  inference_complete: 'processing',
  uploading_or_staging_results: 'transferring',
  completed: 'done',
  complete: 'done',
  validation_failed: 'error',
  failed: 'error',
};

const TERMINAL_STATUSES = new Set(['complete', 'completed', 'failed']);
const TERMINAL_PHASES = new Set(['complete', 'completed', 'failed', 'validation_failed']);
const ALLOWED_RESULTS_KEYS = ['files', 'results', 'items', 'outputs', 'output_files'];
const INITIAL_POLL_INTERVAL_MS = 1500;
const DEFAULT_PHASE_POLL_INTERVAL_MS = 5000;
const FAST_PHASE_POLL_INTERVAL_MS = 2000;
const MAX_POLL_INTERVAL_MS = 15000;
const FORCE_ASYNC_TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const ETA_WARMUP_MS = 40000;
const ETA_PER_IMAGE_MS = 10000;
const ETA_PENALTY_MS = 15000;
const ETA_PENALTY_COOLDOWN_MS = 8000;
const FAST_POLL_PHASES = new Set(['loading_model', 'model_ready', 'processing_images']);

export const isAndroidUserAgent = (ua) => {
  const userAgent = ua || (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return /Android/i.test(userAgent || '');
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'output.bin';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const extractBoundary = (contentType) => {
  const match = String(contentType || '').match(/boundary=([^;]+)/i);
  return match ? match[1].trim().replace(/^"|"$/g, '') : null;
};

const resolveLegacyProgressUrl = (submitUrl) => {
  if (!submitUrl) return null;
  if (submitUrl.includes('-process-image')) {
    return submitUrl.replace('-process-image', '-get-progress');
  }
  return null;
};

const indexOfSubarray = (haystack, needle, start = 0) => {
  for (let i = start; i <= haystack.length - needle.length; i += 1) {
    let match = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
};

const parseHeaders = (headerText) => {
  const headers = {};
  for (const line of String(headerText || '').split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > -1) {
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      headers[key] = value;
    }
  }
  return headers;
};

const parseMultipartMixed = (buffer, boundary) => {
  const boundaryBytes = textEncoder.encode(`--${boundary}`);
  const endBoundaryBytes = textEncoder.encode(`--${boundary}--`);
  const headerDivider = textEncoder.encode('\r\n\r\n');

  const parts = [];
  let pos = 0;

  while (pos < buffer.length) {
    const start = indexOfSubarray(buffer, boundaryBytes, pos);
    if (start === -1) break;

    const isEnd = indexOfSubarray(buffer, endBoundaryBytes, start) === start;
    if (isEnd) break;

    let partStart = start + boundaryBytes.length;
    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) {
      partStart += 2;
    }

    const nextBoundary = indexOfSubarray(buffer, boundaryBytes, partStart);
    if (nextBoundary === -1) break;

    const part = buffer.slice(partStart, nextBoundary);
    const headerEnd = indexOfSubarray(part, headerDivider);
    if (headerEnd !== -1) {
      const headerBytes = part.slice(0, headerEnd);
      const body = part.slice(headerEnd + headerDivider.length);
      parts.push({
        headers: parseHeaders(textDecoder.decode(headerBytes)),
        body,
      });
    }

    pos = nextBoundary;
  }

  return parts;
};

const parseErrorDetail = (raw) => {
  if (!raw) return '';

  if (typeof raw === 'object') {
    const directDetail = raw?.detail ?? raw?.error?.detail;
    if (directDetail != null) {
      return typeof directDetail === 'string' ? directDetail : JSON.stringify(directDetail);
    }
  }

  const rawText = String(raw).trim();

  try {
    const parsed = JSON.parse(rawText);
    if (typeof parsed === 'string') return parsed;
    if (parsed?.detail != null) {
      return typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
    }
    if (parsed?.error?.detail != null) {
      return typeof parsed.error.detail === 'string' ? parsed.error.detail : JSON.stringify(parsed.error.detail);
    }
  } catch {
    // ignore JSON parse failure
  }

  const detailMatch = rawText.match(/"?detail"?\s*[:=]\s*"?([^"\n]+)"?/i);
  if (detailMatch?.[1]) return detailMatch[1].trim();

  return rawText;
};

const emitErrorProgress = ({ onProgress, progressBase, message, detail }) => {
  if (typeof onProgress !== 'function') return;
  onProgress({
    ...(progressBase || {}),
    stage: 'error',
    error: {
      message: message || 'Processing failed',
      detail: parseErrorDetail(detail),
    },
  });
};

const fetchWithApiKey = async (url, apiKey, init = {}) => {
  const headers = new Headers(init.headers || {});
  headers.set('X-API-KEY', apiKey);
  return fetch(url, { ...init, headers });
};

const parseJsonSafe = async (response) => {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const text = await response.text();
    try {
      return JSON.parse(text || '{}');
    } catch {
      return { raw: text };
    }
  }
  return response.json();
};

const clampPercent = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, numeric));
};

const toFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const extractBackendMessage = (payload) => {
  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }
  return '';
};

const extractBackendErrorPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.error != null) return payload.error;
  if (payload.detail != null) return payload.detail;
  if (payload.message != null && String(payload.status || '').toLowerCase() === 'failed') {
    return payload.message;
  }
  return null;
};

const normalizeStatus = (statusPayload) => String(statusPayload?.status || '').trim().toLowerCase();

const extractJobLinks = (payload) => {
  const statusUrl = payload?.status_url || payload?.status_path || null;
  const resultsUrl = payload?.results_url || payload?.results_path || null;
  return {
    jobId: payload?.job_id || null,
    statusUrl,
    resultsUrl,
    submitUrl: payload?.submit_url || null,
    callId: payload?.call_id || null,
  };
};

const extractFilenameFromDisposition = (disposition, fallback) => {
  if (!disposition) return fallback;
  const match = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
  if (!match?.[1]) return fallback;
  const clean = decodeURIComponent(match[1].replace(/"/g, '').trim());
  return clean || fallback;
};

const extractResultsList = (payload) => {
  for (const key of ALLOWED_RESULTS_KEYS) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
};

const normalizeResultItem = (item, index = 0) => {
  const downloadUrl = item?.download_url || item?.downloadUrl || item?.url || null;
  const filename = item?.filename || item?.name || `output-${index + 1}.bin`;
  return { downloadUrl, filename };
};

const normalizeForceAsync = (value) => {
  if (value == null) return null;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return FORCE_ASYNC_TRUE_VALUES.has(normalized) ? 'true' : 'false';
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return value ? 'true' : 'false';
  return null;
};

const emitLegacyProgress = ({ payload, onProgress, progressBase, fileCount }) => {
  const phase = String(payload?.phase || '').trim().toLowerCase();
  const step = Math.max(0, Number(payload?.step) || 0);
  const done = Boolean(payload?.done) || phase === 'complete' || phase === 'completed';
  const percent = clampPercent(payload?.percent)
    ?? (done ? 100 : fileCount > 0 ? Math.min(99, Math.round((step / fileCount) * 100)) : 0);
  const normalizedPercent = percent != null ? Math.max(0, Math.min(100, percent)) : 0;
  const estimatedTotalMs = ETA_WARMUP_MS + (Math.max(1, Number(fileCount) || 1) * ETA_PER_IMAGE_MS);
  const remainingMs = done
    ? 0
    : Math.max(1000, Math.round(estimatedTotalMs * (1 - (normalizedPercent / 100))));

  let stage = 'processing';
  if (done) stage = 'transferring';
  else if (phase && PHASE_TO_STAGE[phase]) stage = PHASE_TO_STAGE[phase];
  else if (step <= 0) stage = 'warmup';

  onProgress?.({
    ...(progressBase || {}),
    stage,
    phase: phase || undefined,
    status: payload?.status || phase || undefined,
    timer: {
      currentFile: Math.min(Math.max(0, step), Math.max(1, fileCount)),
      totalFiles: Math.max(1, fileCount),
      remainingMs,
      totalMs: estimatedTotalMs,
      percent: percent ?? 0,
      done,
    },
  });
};

const startLegacyProgressPolling = ({ legacyProgressUrl, jobId, apiKey, onProgress, progressBase, fileCount, intervalMs }) => {
  if (!legacyProgressUrl || !jobId) return () => {};

  let stopped = false;
  const safeIntervalMs = Math.max(500, Number(intervalMs) || 1500);

  const pollOnce = async () => {
    if (stopped) return;
    try {
      const response = await fetchWithApiKey(`${legacyProgressUrl}?job_id=${encodeURIComponent(jobId)}`, apiKey, { method: 'GET' });
      if (response.status === 404) return;
      if (!response.ok) return;
      const payload = await parseJsonSafe(response);
      emitLegacyProgress({ payload, onProgress, progressBase, fileCount });
    } catch {
      // best-effort legacy fallback polling
    }
  };

  const timer = setInterval(pollOnce, safeIntervalMs);
  pollOnce();

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
};

const postFormData = (url, apiKey, formData, { onUploadProgress } = {}) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();

  xhr.open('POST', url, true);
  xhr.responseType = 'arraybuffer';
  xhr.timeout = 0;
  xhr.setRequestHeader('X-API-KEY', apiKey);

  xhr.upload.onprogress = (event) => {
    const loaded = Number.isFinite(event?.loaded) ? event.loaded : 0;
    const total = Number.isFinite(event?.total) ? event.total : 0;
    onUploadProgress?.({ loaded, total, done: false });
  };

  xhr.upload.onloadend = () => {
    onUploadProgress?.({ loaded: 0, total: 0, done: true });
  };

  xhr.onload = () => {
    resolve({
      status: xhr.status,
      statusText: xhr.statusText,
      headers: new Headers(xhr.getAllResponseHeaders().trim().split(/\r?\n/).filter(Boolean).map((line) => {
        const idx = line.indexOf(':');
        return idx > -1 ? [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] : null;
      }).filter(Boolean)),
      body: xhr.response,
    });
  };

  xhr.onerror = () => reject(new Error('Upload failed.'));
  xhr.onabort = () => reject(new Error('Upload was interrupted.'));
  xhr.ontimeout = () => reject(new Error('Upload request timed out.'));
  xhr.send(formData);
});

const handleDirectMultipartResponse = async ({ response, downloadMode, label }) => {
  const contentType = response.headers.get('content-type') || '';
  const boundary = extractBoundary(contentType);
  if (!boundary) {
    throw new Error('Direct mode response missing multipart boundary.');
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  const parts = parseMultipartMixed(buffer, boundary);
  const downloaded = [];
  const storedFiles = [];

  for (const part of parts) {
    const disposition = part.headers['content-disposition'] || '';
    const filename = extractFilenameFromDisposition(disposition, label || 'output.bin');
    const blob = new Blob([part.body], { type: part.headers['content-type'] || 'application/octet-stream' });

    if (downloadMode === 'store') {
      storedFiles.push(new File([blob], filename, { type: blob.type || 'application/octet-stream' }));
    } else {
      downloadBlob(blob, filename);
    }
    downloaded.push(filename);
  }

  return { downloaded, files: storedFiles, direct: true };
};

const submitJob = async ({ submitUrl, apiKey, formData, onProgress, progressBase, downloadMode, label }) => {
  const result = await postFormData(submitUrl, apiKey, formData, {
    onUploadProgress: ({ loaded, total, done }) => {
      onProgress?.({
        ...(progressBase || {}),
        stage: 'upload',
        upload: { loaded, total, done },
      });
    },
  });

  const response = new Response(result.body ?? null, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const resultMode = String(response.headers.get('X-Result-Mode') || response.headers.get('x-result-mode') || '').toLowerCase();
  const returnedJobId = response.headers.get('X-Job-Id') || response.headers.get('x-job-id') || null;

  if (response.status === 200 && (contentType.startsWith('multipart/mixed') || resultMode === 'direct')) {
    if (!contentType.startsWith('multipart/mixed')) {
      throw new Error('Direct response expected multipart/mixed content.');
    }
    const data = await handleDirectMultipartResponse({ response, downloadMode, label });
    return { mode: 'direct', data, jobId: returnedJobId };
  }

  const submitPayload = await parseJsonSafe(response);
  if (response.status !== 202) {
    const detail = submitPayload?.detail || submitPayload?.error || `Server responded with ${response.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }

  const links = extractJobLinks(submitPayload);
  if (!links.statusUrl) {
    throw new Error('Missing status_url in async submit response.');
  }

  return { mode: 'async', submitPayload, links, jobId: links.jobId || returnedJobId || null };
};

const normalizePhase = (statusPayload) => {
  const phase = String(statusPayload?.phase || statusPayload?.status || '').trim().toLowerCase();
  return phase || 'queued';
};

const isTerminalPayload = (payload) => {
  const status = normalizeStatus(payload);
  const phase = normalizePhase(payload);
  return TERMINAL_STATUSES.has(status) || TERMINAL_PHASES.has(phase);
};

const parseRemainingMs = (payload) => {
  const directMs = toFiniteNumber(payload?.remaining_ms)
    ?? toFiniteNumber(payload?.remainingMs)
    ?? toFiniteNumber(payload?.eta_ms)
    ?? toFiniteNumber(payload?.etaMs);
  if (directMs != null) return Math.max(0, Math.round(directMs));

  const seconds = toFiniteNumber(payload?.remaining_seconds)
    ?? toFiniteNumber(payload?.eta_seconds)
    ?? toFiniteNumber(payload?.etaSeconds);
  if (seconds != null) return Math.max(0, Math.round(seconds * 1000));

  return null;
};

const buildEtaTracker = ({ totalFiles }) => {
  const startedAtMs = Date.now();
  const estimatedTotalMs = ETA_WARMUP_MS + (Math.max(1, Number(totalFiles) || 1) * ETA_PER_IMAGE_MS);
  return {
    startedAtMs,
    deadlineAtMs: startedAtMs + estimatedTotalMs,
    totalEstimateMs: estimatedTotalMs,
    lastPenaltyAtMs: 0,
    lastRemainingMs: estimatedTotalMs,
  };
};

const computeEta = ({ tracker, payload, percent, isTerminal }) => {
  const now = Date.now();
  const elapsedMs = Math.max(0, now - tracker.startedAtMs);
  const backendRemainingMs = parseRemainingMs(payload);
  const shouldUseBackendRemaining = isTerminal || (backendRemainingMs != null && backendRemainingMs > 0);

  let remainingMs;
  let totalMs;

  if (shouldUseBackendRemaining) {
    remainingMs = backendRemainingMs;
    totalMs = Math.max(elapsedMs + remainingMs, tracker.totalEstimateMs || 0);
    tracker.totalEstimateMs = totalMs;
    tracker.deadlineAtMs = now + remainingMs;
  } else {
    if (!isTerminal && now >= tracker.deadlineAtMs && (now - tracker.lastPenaltyAtMs) >= ETA_PENALTY_COOLDOWN_MS) {
      tracker.deadlineAtMs += ETA_PENALTY_MS;
      tracker.totalEstimateMs = Math.max(tracker.totalEstimateMs, tracker.deadlineAtMs - tracker.startedAtMs);
      tracker.lastPenaltyAtMs = now;
    }

    remainingMs = Math.max(0, tracker.deadlineAtMs - now);
    totalMs = Math.max(elapsedMs + remainingMs, tracker.totalEstimateMs || 0);

    if (percent != null && percent > 0 && percent < 100) {
      const projectedTotalMs = elapsedMs / (percent / 100);
      const projectedRemainingMs = Math.max(0, projectedTotalMs - elapsedMs);
      if (projectedRemainingMs < remainingMs) {
        remainingMs = projectedRemainingMs;
        tracker.deadlineAtMs = now + projectedRemainingMs;
      }
      totalMs = Math.max(totalMs, projectedTotalMs);
      tracker.totalEstimateMs = Math.max(tracker.totalEstimateMs, projectedTotalMs);
    }
  }

  if (isTerminal) {
    remainingMs = 0;
    totalMs = Math.max(elapsedMs, tracker.totalEstimateMs || elapsedMs);
  }

  tracker.lastRemainingMs = remainingMs;

  return {
    remainingMs: Math.max(0, Math.round(remainingMs)),
    totalMs: Math.max(0, Math.round(totalMs)),
  };
};

const pollJobStatus = async ({
  statusUrl,
  apiKey,
  onProgress,
  progressBase,
  fileCount,
}) => {
  let networkErrorCount = 0;
  const etaTracker = buildEtaTracker({ totalFiles: fileCount });

  while (true) {
    try {
      const response = await fetchWithApiKey(statusUrl, apiKey, { method: 'GET' });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Status polling failed (${response.status})`);
      }

      const payload = await parseJsonSafe(response);
      const phase = normalizePhase(payload);
      const status = normalizeStatus(payload);
      const percent = clampPercent(payload?.percent);
      const stage = PHASE_TO_STAGE[phase] || 'processing';
      const isTerminal = isTerminalPayload(payload);
      const { remainingMs, totalMs } = computeEta({
        tracker: etaTracker,
        payload,
        percent,
        isTerminal,
      });
      const backendMessage = extractBackendMessage(payload);
      const backendErrorRaw = extractBackendErrorPayload(payload);
      const backendErrorDetail = parseErrorDetail(backendErrorRaw);

      onProgress?.({
        ...(progressBase || {}),
        stage,
        phase,
        status: status || payload?.status || phase,
        message: backendMessage || undefined,
        ...(backendErrorDetail ? {
          error: {
            message: backendMessage || 'Processing failed',
            detail: backendErrorDetail,
          },
        } : {}),
        timer: {
          currentFile: Math.max(0, Number(payload?.step) || Number(payload?.current_file) || 0),
          totalFiles: Math.max(1, Number(payload?.total_steps) || Number(payload?.total_files) || Number(fileCount) || 1),
          remainingMs,
          totalMs,
          percent,
          done: isTerminal,
        },
      });

      if (isTerminal) {
        return payload;
      }

      networkErrorCount = 0;
      const nextDelay = FAST_POLL_PHASES.has(phase)
        ? FAST_PHASE_POLL_INTERVAL_MS
        : DEFAULT_PHASE_POLL_INTERVAL_MS;
      await sleep(nextDelay);
    } catch (err) {
      networkErrorCount += 1;
      const backoffMs = Math.min(MAX_POLL_INTERVAL_MS, INITIAL_POLL_INTERVAL_MS * (2 ** Math.max(0, networkErrorCount - 1)));
      console.warn('[CloudGPU] Status polling network error, retrying', err);
      await sleep(backoffMs);
    }
  }
};

const fetchAndHandleResults = async ({
  resultsUrl,
  apiKey,
  downloadMode,
  label,
  onProgress,
  progressBase,
  expectedCount,
}) => {
  if (!resultsUrl) {
    return { downloaded: [], files: [], missingResults: true };
  }

  const resultsResponse = await fetchWithApiKey(resultsUrl, apiKey, { method: 'GET' });
  if (resultsResponse.status === 404 || resultsResponse.status === 410) {
    return { downloaded: [], files: [], missingResults: true };
  }
  if (!resultsResponse.ok) {
    const detail = await resultsResponse.text();
    throw new Error(detail || `Failed to fetch results (${resultsResponse.status}).`);
  }

  const payload = await parseJsonSafe(resultsResponse);
  const list = extractResultsList(payload);
  if (!list.length) {
    return { downloaded: [], files: [], missingResults: true };
  }

  const totalDownloads = Math.max(1, Number(expectedCount) || list.length || 1);

  const downloaded = [];
  const storedFiles = [];
  const missingDownloads = [];

  for (let index = 0; index < list.length; index += 1) {
    const currentDownload = Math.min(totalDownloads, index + 1);
    const item = normalizeResultItem(list[index], index);

    onProgress?.({
      ...(progressBase || {}),
      stage: 'downloading',
      phase: 'downloading_results',
      status: 'running',
      download: {
        current: currentDownload,
        total: totalDownloads,
        filename: item.filename,
      },
      timer: {
        currentFile: currentDownload,
        totalFiles: totalDownloads,
        percent: Math.max(0, Math.min(100, Math.round(((currentDownload - 1) / totalDownloads) * 100))),
        done: false,
      },
    });

    if (!item.downloadUrl) {
      missingDownloads.push(item.filename);
      continue;
    }

    const fileResponse = await fetchWithApiKey(item.downloadUrl, apiKey, { method: 'GET' });
    if (fileResponse.status === 404 || fileResponse.status === 410) {
      missingDownloads.push(item.filename);
      continue;
    }
    if (!fileResponse.ok) {
      const detail = await fileResponse.text();
      throw new Error(detail || `Download failed (${fileResponse.status}).`);
    }

    const blob = await fileResponse.blob();
    const disposition = fileResponse.headers.get('content-disposition') || '';
    const filename = extractFilenameFromDisposition(disposition, item.filename || label || `output-${index + 1}.bin`);

    if (downloadMode === 'store') {
      storedFiles.push(new File([blob], filename, { type: blob.type || 'application/octet-stream' }));
    } else {
      downloadBlob(blob, filename);
    }

    downloaded.push(filename);

    onProgress?.({
      ...(progressBase || {}),
      stage: 'downloading',
      phase: 'downloading_results',
      status: 'running',
      download: {
        current: currentDownload,
        total: totalDownloads,
        filename,
      },
      timer: {
        currentFile: currentDownload,
        totalFiles: totalDownloads,
        percent: Math.max(0, Math.min(100, Math.round((currentDownload / totalDownloads) * 100))),
        done: currentDownload >= totalDownloads,
      },
    });
  }

  return {
    downloaded,
    files: storedFiles,
    missingResults: downloaded.length === 0 && missingDownloads.length > 0,
    missingDownloads,
  };
};

const isRemoteStorageTarget = (storageTarget) => ['r2', 'supabase'].includes((storageTarget || '').toLowerCase());

const generateJobId = () => {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  const rand = Math.random().toString(16).slice(2);
  return `job-${Date.now()}-${rand}`;
};

const buildFormData = ({ files, prefix, returnMode, jobId, gpu, storageTarget, accessString }) => {
  const formData = new FormData();
  for (const file of files) {
    formData.append('file', file, file.name || 'upload');
  }
  if (prefix) formData.append('prefix', prefix);
  if (returnMode) formData.append('return', returnMode);
  if (jobId) formData.append('jobId', jobId);
  if (gpu) formData.append('gpu', gpu);
  if (storageTarget) formData.append('storageTarget', storageTarget);
  if (accessString) {
    formData.append('accessString', typeof accessString === 'string' ? accessString : JSON.stringify(accessString));
  }
  return formData;
};

const processAsyncJob = async ({
  files,
  label,
  submitUrl,
  apiKey,
  onProgress,
  progressBase,
  prefix,
  returnMode,
  downloadMode,
  gpu,
  storageTarget,
  accessString,
  activeJobId,
  forceAsync,
  pollIntervalMs,
}) => {
  const formData = buildFormData({
    files,
    prefix,
    returnMode,
    jobId: activeJobId,
    gpu,
    storageTarget,
    accessString,
  });

  const forceAsyncValue = normalizeForceAsync(forceAsync);
  if (forceAsyncValue != null) {
    formData.append('forceAsync', forceAsyncValue);
    formData.append('force_async', forceAsyncValue);
  }

  const legacyProgressUrl = resolveLegacyProgressUrl(submitUrl);
  const stopLegacyPolling = startLegacyProgressPolling({
    legacyProgressUrl,
    jobId: activeJobId,
    apiKey,
    onProgress,
    progressBase,
    fileCount: files.length,
    intervalMs: pollIntervalMs,
  });

  try {
    const submitResult = await submitJob({
      submitUrl,
      apiKey,
      formData,
      onProgress,
      progressBase,
      downloadMode,
      label,
    });

    if (submitResult.mode === 'direct') {
      const resolvedJobId = submitResult.jobId || activeJobId;
      onProgress?.({ ...(progressBase || {}), stage: 'done', phase: 'completed', jobId: resolvedJobId });
      return {
        ...submitResult.data,
        jobId: resolvedJobId,
        direct: true,
      };
    }

    const { links } = submitResult;

    stopLegacyPolling();

    const resolvedJobId = links.jobId || activeJobId;
    const pollProgressBase = { ...(progressBase || {}), jobId: resolvedJobId };
    const finalStatus = await pollJobStatus({
      statusUrl: links.statusUrl,
      apiKey,
      onProgress,
      progressBase: pollProgressBase,
      fileCount: files.length,
    });

    const phase = normalizePhase(finalStatus);
    if (phase === 'failed' || phase === 'validation_failed') {
      const detail = finalStatus?.detail || finalStatus?.error || finalStatus?.message || 'Processing failed.';
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }

    if (isRemoteStorageTarget(storageTarget)) {
      onProgress?.({ ...pollProgressBase, stage: 'done', phase: 'completed' });
      return {
        downloaded: [],
        files: [],
        deferred: true,
        statusUrl: links.statusUrl,
        resultsUrl: links.resultsUrl,
        callId: links.callId,
      };
    }

    const resultData = await fetchAndHandleResults({
      resultsUrl: links.resultsUrl,
      apiKey,
      downloadMode,
      label,
      onProgress,
      progressBase: pollProgressBase,
      expectedCount: files.length,
    });

    if (resultData.missingResults) {
      throw new Error('Results are no longer available (missing or expired).');
    }

    onProgress?.({ ...pollProgressBase, stage: 'done', phase: 'completed' });
    return {
      ...resultData,
      statusUrl: links.statusUrl,
      resultsUrl: links.resultsUrl,
      callId: links.callId,
    };
  } finally {
    stopLegacyPolling();
  }
};

export async function testSharpCloud(files, {
  prefix,
  onProgress,
  apiUrl,
  apiKey,
  returnMode,
  gpuType,
  downloadMode,
  batchUploads,
  storageTarget,
  accessString,
  jobId,
  getJobId,
  forceAsync,
  pollIntervalMs,
} = {}) {
  const saved = loadCloudGpuSettings();
  const resolvedUrl = apiUrl || saved?.apiUrl;
  const resolvedKey = apiKey || saved?.apiKey;
  const resolvedGpu = (gpuType || saved?.gpuType || 'a10').trim().toLowerCase();
  const resolvedBatchUploads = Boolean(batchUploads ?? saved?.batchUploads);
  const resolvedStorageTarget = storageTarget || undefined;

  if (!resolvedUrl || !resolvedKey) {
    console.error('❌ Missing Cloud GPU settings: configure API URL and API key in Add Cloud GPU.');
    return [];
  }

  if (!files || files.length === 0) {
    console.warn('No files selected for upload.');
    return [];
  }

  const uploads = Array.from(files);
  const total = uploads.length;
  const results = [];

  if (resolvedBatchUploads) {
    const activeJobId = jobId || getJobId?.(null) || generateJobId();
    const progressBase = { completed: 0, total, jobId: activeJobId };

    try {
      const data = await processAsyncJob({
        files: uploads,
        label: `${uploads.length} files`,
        submitUrl: resolvedUrl,
        apiKey: resolvedKey,
        onProgress,
        progressBase,
        prefix,
        returnMode,
        downloadMode,
        gpu: resolvedGpu,
        storageTarget: resolvedStorageTarget,
        accessString,
        activeJobId,
        forceAsync,
        pollIntervalMs,
      });

      results.push({ file: 'batch', ok: true, data, jobId: activeJobId });
      onProgress?.({ completed: total, total, stage: 'done', jobId: activeJobId });
      return results;
    } catch (err) {
      const detail = err?.message || String(err);
      emitErrorProgress({
        onProgress,
        progressBase,
        message: 'Processing failed',
        detail,
      });
      results.push({ file: 'batch', ok: false, error: detail, silentFailure: true });
      return results;
    }
  }

  for (const file of uploads) {
    const activeJobId = getJobId?.(file) || jobId || generateJobId();
    const progressBase = { completed: results.length, total, jobId: activeJobId };

    try {
      const data = await processAsyncJob({
        files: [file],
        label: file.name,
        submitUrl: resolvedUrl,
        apiKey: resolvedKey,
        onProgress,
        progressBase,
        prefix,
        returnMode,
        downloadMode,
        gpu: resolvedGpu,
        storageTarget: resolvedStorageTarget,
        accessString,
        activeJobId,
        forceAsync,
        pollIntervalMs,
      });

      results.push({ file: file.name, ok: true, data, jobId: activeJobId });
    } catch (err) {
      const detail = err?.message || String(err);
      emitErrorProgress({
        onProgress,
        progressBase,
        message: 'Processing failed',
        detail,
      });
      results.push({ file: file.name, ok: false, error: detail, silentFailure: true });
    }

    onProgress?.({ completed: results.length, total });
  }

  return results;
}
