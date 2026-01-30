/**
 * Debug transfer bundle utilities (export/import).
 * Uses ZIP with JSON manifest + binary preview blobs.
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import {
  loadAllSources,
  saveSource,
  registerSource,
  restoreSource,
} from '../storage/index.js';
import { loadSupabaseSettings, saveSupabaseSettings } from '../storage/supabaseSettings.js';
import { loadR2Settings, saveR2Settings } from '../storage/r2Settings.js';
import { loadCloudGpuSettings, saveCloudGpuSettings } from '../storage/cloudGpuSettings.js';
import {
  listAllFileSettings,
  listPreviewRecords,
  deleteFileSettings,
  saveFileSettings,
  deletePreviewBlob,
  savePreviewBlob,
} from '../fileStorage.js';

const EXPORT_SCHEMA_VERSION = 1;

const sanitizeFileName = (name) => {
  if (!name) return 'untitled';
  return name
    .replace(/[^a-z0-9._-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'untitled';
};

const normalizePreviewExtension = (format) => {
  if (!format) return 'webp';
  const normalized = String(format).toLowerCase();
  if (normalized === 'jpeg') return 'jpg';
  if (normalized === 'jpg' || normalized === 'png' || normalized === 'webp') return normalized;
  return 'webp';
};

const formatToMime = (format) => {
  if (!format) return 'application/octet-stream';
  const normalized = String(format).toLowerCase();
  if (normalized === 'webp') return 'image/webp';
  if (normalized === 'png') return 'image/png';
  if (normalized === 'jpeg' || normalized === 'jpg') return 'image/jpeg';
  return 'application/octet-stream';
};

const buildZipFileMap = async ({
  includeUrlCollections,
  includeSupabaseCollections,
  includeSupabaseSettings,
  includeR2Collections,
  includeR2Settings,
  includeCloudGpuSettings,
  includeFileSettings,
  includeFilePreviews,
}) => {
  const notes = [];

  const data = {
    sources: [],
    supabaseSettings: null,
    r2Settings: null,
    cloudGpuSettings: null,
    fileSettings: [],
    previews: [],
  };

  if (includeUrlCollections || includeSupabaseCollections || includeR2Collections) {
    const allSources = await loadAllSources();
    data.sources = allSources.filter((config) => {
      if (config.type === 'public-url') return includeUrlCollections;
      if (config.type === 'supabase-storage') return includeSupabaseCollections;
      if (config.type === 'r2-bucket') return includeR2Collections;
      return false;
    });
    const skippedLocal = allSources.some((config) => config.type === 'local-folder');
    if (skippedLocal) {
      notes.push('Local folder sources were skipped (handles cannot be exported).');
    }
  }

  if (includeSupabaseSettings) {
    data.supabaseSettings = loadSupabaseSettings();
  }

  if (includeR2Settings) {
    data.r2Settings = loadR2Settings();
  }

  if (includeCloudGpuSettings) {
    data.cloudGpuSettings = loadCloudGpuSettings();
  }

  if (includeFileSettings) {
    data.fileSettings = await listAllFileSettings();
  }

  const files = {};
  if (includeFilePreviews) {
    const previewRecords = await listPreviewRecords();
    for (let index = 0; index < previewRecords.length; index += 1) {
      const record = previewRecords[index];
      const safeName = sanitizeFileName(record.fileName).replace(/\.[a-z0-9]+$/i, '');
      const ext = normalizePreviewExtension(record.format);
      const previewPath = `previews/${index}-${safeName}.${ext}`;
      const buffer = await record.blob.arrayBuffer();
      files[previewPath] = new Uint8Array(buffer);
      data.previews.push({
        fileName: record.fileName,
        width: record.width,
        height: record.height,
        format: record.format,
        updated: record.updated,
        version: record.version,
        blobPath: previewPath,
      });
    }
  }

  const manifest = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    app: 'radia-viewer',
    exportedAt: new Date().toISOString(),
    selections: {
      includeUrlCollections,
      includeSupabaseCollections,
      includeSupabaseSettings,
      includeR2Collections,
      includeR2Settings,
      includeCloudGpuSettings,
      includeFileSettings,
      includeFilePreviews,
    },
    data,
    notes,
  };

  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  return { files, manifest };
};

export const buildTransferBundle = async (options) => {
  const { files, manifest } = await buildZipFileMap(options);
  const zipData = zipSync(files, { level: 6 });
  const blob = new Blob([zipData], { type: 'application/zip' });
  return { blob, manifest };
};

export const importTransferBundle = async (file) => {
  const buffer = await file.arrayBuffer();
  const zipEntries = unzipSync(new Uint8Array(buffer));

  const manifestEntry = zipEntries['manifest.json'];
  if (!manifestEntry) {
    throw new Error('Missing manifest.json in transfer bundle');
  }

  const manifest = JSON.parse(strFromU8(manifestEntry));
  const data = manifest?.data || {};

  const summary = {
    sourcesImported: 0,
    fileSettingsImported: 0,
    previewsImported: 0,
    supabaseSettingsImported: Boolean(data.supabaseSettings),
    r2SettingsImported: Boolean(data.r2Settings),
    cloudGpuSettingsImported: Boolean(data.cloudGpuSettings),
    warnings: [],
  };

  if (data.supabaseSettings) {
    saveSupabaseSettings(data.supabaseSettings);
  }

  if (data.r2Settings) {
    saveR2Settings(data.r2Settings);
  }

  if (data.cloudGpuSettings) {
    saveCloudGpuSettings(data.cloudGpuSettings);
  }

  if (Array.isArray(data.sources)) {
    for (const config of data.sources) {
      if (!config?.type) continue;
      if (config.type !== 'public-url' && config.type !== 'supabase-storage' && config.type !== 'r2-bucket') {
        summary.warnings.push(`Skipped unsupported source type: ${config.type}`);
        continue;
      }
      await saveSource(config);
      const source = restoreSource(config);
      if (source) {
        registerSource(source);
      }
      summary.sourcesImported += 1;
    }
  }

  if (Array.isArray(data.fileSettings)) {
    for (const record of data.fileSettings) {
      if (!record?.fileName) continue;
      await deleteFileSettings(record.fileName);
      await saveFileSettings(record.fileName, record);
      summary.fileSettingsImported += 1;
    }
  }

  if (Array.isArray(data.previews)) {
    for (const preview of data.previews) {
      if (!preview?.fileName || !preview?.blobPath) continue;
      const entry = zipEntries[preview.blobPath];
      if (!entry) {
        summary.warnings.push(`Missing preview blob for ${preview.fileName}`);
        continue;
      }
      const blob = new Blob([entry], { type: formatToMime(preview.format) });
      await deletePreviewBlob(preview.fileName);
      await savePreviewBlob(preview.fileName, blob, {
        width: preview.width,
        height: preview.height,
        format: preview.format,
      });
      summary.previewsImported += 1;
    }
  }

  return { manifest, summary };
};
