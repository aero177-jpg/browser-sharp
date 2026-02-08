import { loadCloudGpuSettings } from './storage/cloudGpuSettings.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const isAndroidUserAgent = (ua) => {
  const userAgent = ua || (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return /Android/i.test(userAgent || '');
};

const extractBoundary = (contentType) => {
  const match = contentType.match(/boundary=([^;]+)/i);
  return match ? match[1].trim() : null;
};

const indexOfSubarray = (haystack, needle, start = 0) => {
  for (let i = start; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
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
  for (const line of headerText.split(/\r?\n/)) {
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

  const parts = [];
  let pos = 0;

  while (pos < buffer.length) {
    const start = indexOfSubarray(buffer, boundaryBytes, pos);
    if (start === -1) break;

    const isEnd = indexOfSubarray(buffer, endBoundaryBytes, start) === start;
    if (isEnd) break;

    let partStart = start + boundaryBytes.length;
    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) {
      partStart += 2; // skip CRLF
    }

    const nextBoundary = indexOfSubarray(buffer, boundaryBytes, partStart);
    if (nextBoundary === -1) break;

    const part = buffer.slice(partStart, nextBoundary);
    parts.push(part);

    pos = nextBoundary;
  }

  const headerDivider = textEncoder.encode('\r\n\r\n');

  return parts
    .map((part) => {
      const headerEnd = indexOfSubarray(part, headerDivider);
      if (headerEnd === -1) return null;

      const headerBytes = part.slice(0, headerEnd);
      const body = part.slice(headerEnd + headerDivider.length);

      const headerText = textDecoder.decode(headerBytes);
      const headers = parseHeaders(headerText);

      return { headers, body };
    })
    .filter(Boolean);
};

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'output.bin';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const parseXhrHeaders = (rawHeaders) => {
  const headers = new Headers();
  if (!rawHeaders) return headers;
  const lines = rawHeaders.trim().split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx > -1) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      headers.append(key, value);
    }
  }
  return headers;
};

const resolveProgressUrl = (apiUrl) => {
  if (!apiUrl) return null;
  if (apiUrl.includes('-process-image')) {
    return apiUrl.replace('-process-image', '-get-progress');
  }
  return null;
};

const generateJobId = () => {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  const rand = Math.random().toString(16).slice(2);
  return `job-${Date.now()}-${rand}`;
};

const warnMissingProgressUrl = (() => {
  let warned = false;
  return () => {
    if (warned) return;
    warned = true;
    console.warn('[CloudGPU] Progress URL not set. Configure the get-progress endpoint to enable polling.');
  };
})();

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

  // Fallback: return the raw text itself so the user sees *something*
  return rawText;
};

const emitErrorProgress = ({ onProgress, progressBase, message, detail }) => {
  if (typeof onProgress !== 'function') return;
  const parsedDetail = parseErrorDetail(detail);
  onProgress({
    ...(progressBase || {}),
    stage: 'error',
    error: {
      message: message || 'Processing failed',
      detail: parsedDetail,
    },
  });
};

const startProgressPolling = ({ progressUrl, jobId, onProgress, progressBase, intervalMs = 1000, fileCount = 1, warmupMs = 30000, perFileMs = 10000 }) => {
  if (!jobId) return () => {};

  const safeFileCount = Math.max(1, Number(fileCount) || 1);
  const safeWarmup = Math.max(0, Number(warmupMs) || 30000);
  const safePerFile = Math.max(0, Number(perFileMs) || 10000);

  let stopped = false;
  let totalEstimateMs = safeWarmup + safeFileCount * safePerFile;
  let effectiveElapsedMs = 0;
  let lastTickTime = Date.now();
  let lastKnownStep = 0;
  let remoteComplete = false;

  const emit = () => {
    if (stopped) return;

    const now = Date.now();
    const dt = now - lastTickTime;
    lastTickTime = now;

    if (!remoteComplete) {
      effectiveElapsedMs += dt;
    }

    const clampedElapsed = Math.min(effectiveElapsedMs, totalEstimateMs);
    const remainingMs = Math.max(0, totalEstimateMs - clampedElapsed);
    const percent = totalEstimateMs > 0 ? Math.min(100, (clampedElapsed / totalEstimateMs) * 100) : 100;

    let stage = 'warmup';
    let currentFile = 0;

    if (remoteComplete) {
      stage = 'transferring';
      currentFile = safeFileCount;
    } else if (clampedElapsed < safeWarmup) {
      stage = 'warmup';
    } else {
      stage = 'processing';
      const processingElapsed = clampedElapsed - safeWarmup;
      currentFile = Math.min(safeFileCount, Math.floor(processingElapsed / safePerFile) + 1);
    }

    onProgress?.({
      ...(progressBase || {}),
      jobId,
      stage,
      timer: {
        currentFile,
        totalFiles: safeFileCount,
        remainingMs,
        totalMs: totalEstimateMs,
        percent,
        done: remoteComplete,
      },
    });
  };

  const timerInterval = setInterval(emit, 500);
  emit();

  let pollInterval = null;
  if (progressUrl) {
    const pollOnce = async () => {
      if (stopped || remoteComplete) return;
      try {
        const res = await fetch(`${progressUrl}?job_id=${encodeURIComponent(jobId)}`);
        if (res.status === 404) return;
        const data = await res.json();

        const step = Number(data?.step) || 0;
        const isDone = Boolean(data?.done);

        if (step > lastKnownStep && step >= 1) {
          // step 1 = image 1 starts at warmup, step 2 = image 2 starts at warmup+perFile, etc.
          const expectedMsForStep = safeWarmup + (step - 1) * safePerFile;
          if (effectiveElapsedMs < expectedMsForStep) {
            effectiveElapsedMs = expectedMsForStep;
          } else if (effectiveElapsedMs > expectedMsForStep + safePerFile) {
            totalEstimateMs += 5000;
          }
          lastTickTime = Date.now();
          lastKnownStep = step;
        }

        if (isDone) {
          remoteComplete = true;
          lastTickTime = Date.now();
          emit();
        }
      } catch (err) {
        console.warn('[CloudGPU] Progress polling failed', err);
      }
    };

    pollInterval = setInterval(pollOnce, Math.max(500, Number(intervalMs) || 1000));
    pollOnce();
  }

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timerInterval);
    if (pollInterval) clearInterval(pollInterval);
  };

  return stop;
};

const postFormData = (url, apiKey, formData, { onUploadProgress, onUploadDone } = {}) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', url, true);
  xhr.responseType = 'arraybuffer';
  xhr.setRequestHeader('X-API-KEY', apiKey);

  xhr.upload.onprogress = (event) => {
    onUploadProgress?.(event);
  };

  xhr.upload.onloadend = (event) => {
    onUploadProgress?.({ ...event, done: true });
    onUploadDone?.();
  };

  xhr.onload = () => {
    resolve({
      status: xhr.status,
      statusText: xhr.statusText,
      headers: parseXhrHeaders(xhr.getAllResponseHeaders()),
      body: xhr.response,
    });
  };

  xhr.onerror = () => reject(new Error('Upload failed.'));
  xhr.send(formData);
});

const postFormDataWithProgress = async (url, apiKey, formData, { onProgress, progressBase, onUploadDone } = {}) => {
  const result = await postFormData(url, apiKey, formData, {
    onUploadProgress: (event) => {
      const loaded = Number.isFinite(event?.loaded) ? event.loaded : 0;
      const total = Number.isFinite(event?.total) ? event.total : 0;
      const done = Boolean(event?.done);

      onProgress?.({
        ...(progressBase || {}),
        stage: 'upload',
        upload: { loaded, total, done },
      });
    },
    onUploadDone,
  });

  const response = new Response(result.body ?? null, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });

  const returnedJobId = response.headers.get('X-Job-Id') || response.headers.get('x-job-id') || null;

  return { response, returnedJobId };
};

const startProcessingEstimate = ({ totalMs, onProgress, progressBase, fileCount, warmupMs = 30000, perFileMs = 10000 }) => {
  const start = Date.now();
  const safeWarmup = Math.max(0, Number(warmupMs) || 0);
  const safePerFile = Math.max(0, Number(perFileMs) || 0);
  const safeFileCount = Math.max(1, Number(fileCount) || 1);
  const safeTotal = Math.max(0, Number(totalMs) || (safeWarmup + safeFileCount * safePerFile));

  const emit = () => {
    const elapsedMs = Date.now() - start;
    const clampedElapsed = Math.min(elapsedMs, safeTotal);
    const remainingMs = Math.max(0, safeTotal - elapsedMs);
    const overallProgress = safeTotal > 0 ? Math.min(1, clampedElapsed / safeTotal) : 1;

    let stage = 'warmup';
    let stageProgress = 0;
    let currentFile = 0;

    if (elapsedMs < safeWarmup) {
      stage = 'warmup';
      stageProgress = safeWarmup > 0 ? Math.min(1, elapsedMs / safeWarmup) : 1;
    } else {
      stage = 'processing';
      const processingElapsed = elapsedMs - safeWarmup;
      const processingTotal = safeFileCount * safePerFile;
      stageProgress = processingTotal > 0 ? Math.min(1, processingElapsed / processingTotal) : 1;
      currentFile = Math.min(safeFileCount, Math.floor(processingElapsed / safePerFile) + 1);
    }

    onProgress?.({
      ...(progressBase || {}),
      stage,
      estimate: {
        elapsedMs: clampedElapsed,
        totalMs: safeTotal,
        remainingMs,
        progress: overallProgress,
        stageProgress,
        currentFile,
        totalFiles: safeFileCount,
        done: overallProgress >= 1,
      },
    });
  };

  emit();
  const interval = setInterval(emit, 500);

  return () => {
    clearInterval(interval);
    onProgress?.({
      ...(progressBase || {}),
      stage: 'done',
      estimate: {
        elapsedMs: Math.min(Date.now() - start, safeTotal),
        totalMs: safeTotal,
        remainingMs: 0,
        progress: 1,
        stageProgress: 1,
        currentFile: safeFileCount,
        totalFiles: safeFileCount,
        done: true,
      },
    });
  };
};


const extractFilenameFromDisposition = (disposition, fallback) => {
  if (!disposition) return fallback;
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
};

export async function testSharpCloud(files, { prefix, onProgress, apiUrl, apiKey, returnMode, gpuType, downloadMode, batchUploads, storageTarget, accessString, jobId, getJobId, pollIntervalMs } = {}) {
  const saved = loadCloudGpuSettings();
  const resolvedUrl = apiUrl || saved?.apiUrl 
  const resolvedKey = apiKey || saved?.apiKey 
  const resolvedGpu = (gpuType || saved?.gpuType || 'a10').trim().toLowerCase();
  const resolvedBatchUploads = Boolean(batchUploads ?? saved?.batchUploads);
  const resolvedStorageTarget = storageTarget || undefined;
  const resolvedProgressUrl = resolveProgressUrl(resolvedUrl);

  if (!resolvedUrl || !resolvedKey) {
    console.error('❌ Missing Cloud GPU settings: configure API URL and API key in Add Cloud GPU.');
    return [];
  }

  if (!files || files.length === 0) {
    console.warn("No files selected for upload.");
    return [];
  }

  const uploads = Array.from(files);
  const results = [];
  const total = uploads.length;

  const applyCommonFields = (formData, activeJobId) => {
    if (prefix) {
      formData.append('prefix', prefix);
    }
    if (returnMode) {
      formData.append('return', returnMode);
    }
    if (activeJobId) {
      formData.append('jobId', activeJobId);
    }
    if (resolvedGpu) {
      formData.append('gpu', resolvedGpu);
    }
    if (resolvedStorageTarget) {
      formData.append('storageTarget', resolvedStorageTarget);
    }
    if (accessString) {
      formData.append('accessString', typeof accessString === 'string' ? accessString : JSON.stringify(accessString));
    }
  };

  const handleResponse = async (response, label) => {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.toLowerCase().startsWith('multipart/mixed')) {
      const boundary = extractBoundary(contentType);
      if (!boundary) throw new Error('Missing multipart boundary.');

      const buffer = new Uint8Array(await response.arrayBuffer());
      const parts = parseMultipartMixed(buffer, boundary);
      const downloaded = [];
      const storedFiles = [];

      for (const part of parts) {
        const disposition = part.headers['content-disposition'] || '';
        const match = disposition.match(/filename="(.+?)"/i);
        const filename = match?.[1] || 'output.bin';

        const blob = new Blob([part.body], { type: part.headers['content-type'] || 'application/octet-stream' });
        if (downloadMode === 'store') {
          storedFiles.push(new File([blob], filename, { type: blob.type || 'application/octet-stream' }));
        } else {
          downloadBlob(blob, filename);
        }
        downloaded.push(filename);
      }

      console.log(`✅ Downloaded ${downloaded.length} files for ${label}`);
      return { downloaded, files: storedFiles };
    }

    const isJson = contentType.toLowerCase().includes('application/json');
    if (downloadMode === 'store' && !isJson) {
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const filename = extractFilenameFromDisposition(disposition, label || 'output.bin');
      const storedFile = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      console.log(`✅ Stored ${filename} for ${label}`);
      return { downloaded: [filename], files: [storedFile] };
    }

    const result = await response.json();
    console.log(`✅ Success for ${label}:`, result.url);
    return result;
  };

  if (resolvedBatchUploads) {
    if (typeof onProgress === 'function') {
      onProgress({ completed: 0, total, stage: 'upload', upload: { loaded: 0, total: 0, done: false } });
    }

    let stopPolling = null;
    try {
      let activeJobId = jobId || getJobId?.(null) || generateJobId();
      const formData = new FormData();
      for (const file of uploads) {
        formData.append('file', file, file.name || 'upload');
      }
      applyCommonFields(formData, activeJobId);
      const progressBase = { completed: 0, total, jobId: activeJobId };
      const result = await postFormDataWithProgress(resolvedUrl, resolvedKey, formData, {
        onProgress,
        progressBase,
        onUploadDone: () => {
          if (!resolvedProgressUrl) {
            warnMissingProgressUrl();
            return;
          }
          stopPolling = startProgressPolling({
            progressUrl: resolvedProgressUrl,
            jobId: activeJobId,
            onProgress,
            progressBase,
            intervalMs: pollIntervalMs,
            fileCount: uploads.length,
          });
        },
      });

      const response = result.response;
      const returnedJobId = result.returnedJobId;
      if (returnedJobId && returnedJobId !== activeJobId) {
        activeJobId = returnedJobId;
        stopPolling?.();
        if (!resolvedProgressUrl) {
          warnMissingProgressUrl();
        } else {
          stopPolling = startProgressPolling({
            progressUrl: resolvedProgressUrl,
            jobId: activeJobId,
            onProgress,
            progressBase: { ...progressBase, jobId: activeJobId },
            intervalMs: pollIntervalMs,
            fileCount: uploads.length,
          });
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        stopPolling?.();
        emitErrorProgress({
          onProgress,
          progressBase,
          message: 'Processed failed',
          detail: errorText || `Server responded with ${response.status}`,
        });
        throw new Error(`Server responded with ${response.status}: ${errorText}`);
      }

      const data = await handleResponse(response, `${uploads.length} files`);
      stopPolling?.();
      results.push({ file: 'batch', ok: true, data, jobId: activeJobId });
    } catch (err) {
      const message = `Batch upload failed. You can refresh the collection to see any completed files. ${err?.message || ''}`.trim();
      console.error('❌ Batch upload failed:', err?.message || err);
      stopPolling?.();
      emitErrorProgress({
        onProgress,
        progressBase: { completed: 0, total },
        message: 'Processed failed',
        detail: err?.message || message,
      });
      results.push({ file: 'batch', ok: false, error: message, silentFailure: true });
    }

    if (typeof onProgress === 'function') {
      onProgress({ completed: results.length ? total : 0, total });
    }

    return results;
  }

  for (const file of uploads) {
    console.log(`🚀 Uploading ${file.name}...`);

    let stopPolling = null;
    try {
      let activeJobId = getJobId?.(file) || jobId || generateJobId();
      const formData = new FormData();
      formData.append('file', file, file.name || 'upload');
      applyCommonFields(formData, activeJobId);
      const progressBase = { completed: results.length, total, jobId: activeJobId };
      const result = await postFormDataWithProgress(resolvedUrl, resolvedKey, formData, {
        onProgress,
        progressBase,
        onUploadDone: () => {
          if (!resolvedProgressUrl) {
            warnMissingProgressUrl();
            return;
          }
          stopPolling = startProgressPolling({
            progressUrl: resolvedProgressUrl,
            jobId: activeJobId,
            onProgress,
            progressBase,
            intervalMs: pollIntervalMs,
            fileCount: 1,
          });
        },
      });

      const response = result.response;
      const returnedJobId = result.returnedJobId;
      if (returnedJobId && returnedJobId !== activeJobId) {
        activeJobId = returnedJobId;
        stopPolling?.();
        if (!resolvedProgressUrl) {
          warnMissingProgressUrl();
        } else {
          stopPolling = startProgressPolling({
            progressUrl: resolvedProgressUrl,
            jobId: activeJobId,
            onProgress,
            progressBase: { ...progressBase, jobId: activeJobId },
            intervalMs: pollIntervalMs,
            fileCount: 1,
          });
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        stopPolling?.();
        emitErrorProgress({
          onProgress,
          progressBase,
          message: 'Processed failed',
          detail: errorText || `Server responded with ${response.status}`,
        });
        throw new Error(`Server responded with ${response.status}: ${errorText}`);
      }

      const data = await handleResponse(response, file.name);
      stopPolling?.();
      results.push({ file: file.name, ok: true, data, jobId: activeJobId });
    } catch (err) {
      console.error(`❌ Upload failed for ${file.name}:`, err.message);
      stopPolling?.();
      emitErrorProgress({
        onProgress,
        progressBase: { completed: results.length, total },
        message: 'Processed failed',
        detail: err?.message || 'Upload failed',
      });
      results.push({ file: file.name, ok: false, error: err.message, silentFailure: true });
    }

    if (typeof onProgress === 'function') {
      onProgress({ completed: results.length, total });
    }
  }

  return results;
}
