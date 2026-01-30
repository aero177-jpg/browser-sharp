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

  return new Response(result.body ?? null, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
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

export async function testSharpCloud(files, { prefix, onProgress, apiUrl, apiKey, returnMode, gpuType, downloadMode, batchUploads, storageTarget, s3Endpoint, s3AccessKeyId, s3SecretAccessKey, s3Bucket, s3PublicUrlBase } = {}) {
  const saved = loadCloudGpuSettings();
  const resolvedUrl = apiUrl || saved?.apiUrl 
  const resolvedKey = apiKey || saved?.apiKey 
  const resolvedGpu = (gpuType || saved?.gpuType || 'a10').trim().toLowerCase();
  const resolvedBatchUploads = Boolean(batchUploads ?? saved?.batchUploads);
  const resolvedStorageTarget = storageTarget || (s3Endpoint ? 'r2' : undefined);

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

  const applyCommonFields = (formData) => {
    if (prefix) {
      formData.append('prefix', prefix);
    }
    if (returnMode) {
      formData.append('return', returnMode);
    }
    if (resolvedGpu) {
      formData.append('gpu', resolvedGpu);
    }
    if (resolvedStorageTarget) {
      formData.append('storageTarget', resolvedStorageTarget);
    }
    if (s3Endpoint) {
      formData.append('s3Endpoint', s3Endpoint);
    }
    if (s3AccessKeyId) {
      formData.append('s3AccessKeyId', s3AccessKeyId);
    }
    if (s3SecretAccessKey) {
      formData.append('s3SecretAccessKey', s3SecretAccessKey);
    }
    if (s3Bucket) {
      formData.append('s3Bucket', s3Bucket);
    }
    if (s3PublicUrlBase) {
      formData.append('s3PublicUrlBase', s3PublicUrlBase);
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
      onProgress({ completed: 0, total });
    }

    try {
      const formData = new FormData();
      for (const file of uploads) {
        formData.append('file', file, file.name || 'upload');
      }
      applyCommonFields(formData);

      let stopEstimate = null;
      const estimatedTotalMs = 30000 + uploads.length * 10000;
      const response = await postFormDataWithProgress(resolvedUrl, resolvedKey, formData, {
        onProgress,
        progressBase: { completed: 0, total },
        onUploadDone: () => {
          stopEstimate = startProcessingEstimate({
            totalMs: estimatedTotalMs,
            fileCount: uploads.length,
            warmupMs: 30000,
            perFileMs: 10000,
            onProgress,
            progressBase: { completed: 0, total },
          });
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server responded with ${response.status}: ${errorText}`);
      }

      const data = await handleResponse(response, `${uploads.length} files`);
      stopEstimate?.();
      results.push({ file: 'batch', ok: true, data });
    } catch (err) {
      const message = `Batch upload failed. You can refresh the collection to see any completed files. ${err?.message || ''}`.trim();
      console.error('❌ Batch upload failed:', err?.message || err);
      results.push({ file: 'batch', ok: false, error: message, silentFailure: true });
    }

    if (typeof onProgress === 'function') {
      onProgress({ completed: results.length ? total : 0, total });
    }

    return results;
  }

  for (const file of uploads) {
    console.log(`🚀 Uploading ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append('file', file, file.name || 'upload');
      applyCommonFields(formData);

      let stopEstimate = null;
      const response = await postFormDataWithProgress(resolvedUrl, resolvedKey, formData, {
        onProgress,
        progressBase: { completed: results.length, total },
        onUploadDone: () => {
          stopEstimate = startProcessingEstimate({
            totalMs: 40000,
            fileCount: 1,
            warmupMs: 0,
            perFileMs: 40000,
            onProgress,
            progressBase: { completed: results.length, total },
          });
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server responded with ${response.status}: ${errorText}`);
      }

      const data = await handleResponse(response, file.name);
      stopEstimate?.();
      results.push({ file: file.name, ok: true, data });
    } catch (err) {
      console.error(`❌ Upload failed for ${file.name}:`, err.message);
      results.push({ file: file.name, ok: false, error: err.message, silentFailure: true });
    }

    if (typeof onProgress === 'function') {
      onProgress({ completed: results.length, total });
    }
  }

  return results;
}
