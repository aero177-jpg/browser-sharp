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


export async function testSharpCloud(files, { prefix, onProgress, apiUrl, apiKey, returnMode, gpuType } = {}) {
  const saved = loadCloudGpuSettings();
  const resolvedUrl = apiUrl || saved?.apiUrl 
  const resolvedKey = apiKey || saved?.apiKey 
  const resolvedGpu = (gpuType || saved?.gpuType || 'a10').trim().toLowerCase();

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

  for (const file of uploads) {
    console.log(`🚀 Uploading ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append("file", file, file.name || "upload");
      if (prefix) {
        formData.append("prefix", prefix);
      }
      if (returnMode) {
        formData.append('return', returnMode);
      }
      if (resolvedGpu) {
        formData.append('gpu', resolvedGpu);
      }

      const response = await fetch(resolvedUrl, {
        method: "POST",
        headers: {
          "X-API-KEY": resolvedKey,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server responded with ${response.status}: ${errorText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.toLowerCase().startsWith('multipart/mixed')) {
        const boundary = extractBoundary(contentType);
        if (!boundary) throw new Error('Missing multipart boundary.');

        const buffer = new Uint8Array(await response.arrayBuffer());
        const parts = parseMultipartMixed(buffer, boundary);
        const downloaded = [];

        for (const part of parts) {
          const disposition = part.headers['content-disposition'] || '';
          const match = disposition.match(/filename="(.+?)"/i);
          const filename = match?.[1] || 'output.bin';

          const blob = new Blob([part.body], { type: part.headers['content-type'] || 'application/octet-stream' });
          downloadBlob(blob, filename);
          downloaded.push(filename);
        }

        console.log(`✅ Downloaded ${downloaded.length} files for ${file.name}`);
        results.push({ file: file.name, ok: true, data: { downloaded } });
      } else {
        const result = await response.json();
        console.log(`✅ Success for ${file.name}:`, result.url);
        results.push({ file: file.name, ok: true, data: result });
      }
    } catch (err) {
      console.error(`❌ Upload failed for ${file.name}:`, err.message);
      results.push({ file: file.name, ok: false, error: err.message });
    }

    if (typeof onProgress === 'function') {
      onProgress({ completed: results.length, total });
    }
  }

  return results;
}
