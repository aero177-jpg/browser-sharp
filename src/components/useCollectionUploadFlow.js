/**
 * Collection upload flow hook
 *
 * Provides a unified file picker + modal flow for assets and image conversion,
 * and routes actions based on the active collection type.
 */

import { h } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getFormatAccept, getSupportedExtensions } from '../formats/index.js';
import { isAndroidUserAgent, testSharpCloud } from '../testSharpCloud.js';
import { handleAddFiles, handleMultipleFiles, loadFromStorageSource } from '../fileLoader.js';
import { useStore } from '../store.js';
import { getSource } from '../storage/index.js';
import UploadChoiceModal from './UploadChoiceModal.jsx';

// Constants moved outside hook to avoid recreating each render
export const DEFAULT_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.tif',
  '.tiff',
  '.heic',
];

export const SUPPORTED_EXTENSIONS = getSupportedExtensions();
const FORMAT_ACCEPT = getFormatAccept();
const IMAGE_ACCEPT = `${DEFAULT_IMAGE_EXTENSIONS.join(',')},image/*`;
const IS_ANDROID = isAndroidUserAgent();
const AUTO_RELOAD_DELAY_MS = 500;
const SUPABASE_RESCAN_INTERVAL_MS = 500;
const SUPABASE_RESCAN_ATTEMPTS = 6;
const R2_RESCAN_INTERVAL_MS = 500;
const R2_RESCAN_ATTEMPTS = 6;

const generateJobId = () => {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  const rand = Math.random().toString(16).slice(2);
  return `job-${Date.now()}-${rand}`;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForRemoteRescan = async (source, { expectedMin = 1 } = {}) => {
  if (!source || !['supabase-storage', 'r2-bucket'].includes(source?.type) || typeof source?.rescan !== 'function') {
    return false;
  }

  const attempts = source?.type === 'r2-bucket' ? R2_RESCAN_ATTEMPTS : SUPABASE_RESCAN_ATTEMPTS;
  const interval = source?.type === 'r2-bucket' ? R2_RESCAN_INTERVAL_MS : SUPABASE_RESCAN_INTERVAL_MS;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await source.rescan({ applyChanges: true });
      const addedCount = result?.added?.length || 0;
      if (addedCount >= expectedMin || addedCount > 0) {
        return true;
      }
    } catch (err) {
      console.warn('[UploadFlow] Remote rescan failed', err);
    }
    await delay(interval);
  }

  return false;
};

// Helper functions moved outside hook - no dependencies on hook state
export const isSupportedFile = (file) => {
  if (!file?.name) return false;
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  return SUPPORTED_EXTENSIONS.includes(ext);
};

export const isImageFile = (file) => {
  if (!file) return false;
  const type = file.type || '';
  const name = (file.name || '').toLowerCase();
  return type.startsWith('image/') || DEFAULT_IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
};

const getCollectionUploadCopy = (source) => {
  const collectionName = source?.name || 'this collection';
  const type = source?.type || 'none';

  if (type === 'supabase-storage') {
    return {
      title: 'Upload to Supabase',
      subtitle: `Choose what you want to upload to "${collectionName}".`,
      assetTitle: '3dgs asset upload',
      assetSubtitle: 'Uploads supported 3DGS assets to Supabase storage.',
      imageTitle: 'Images to convert',
      imageSubtitle: 'Sends images to cloud GPU and uploads the results to Supabase.',
      note: '',
    };
  }

  if (type === 'r2-bucket') {
    return {
      title: 'Upload to R2',
      subtitle: `Choose what you want to upload to "${collectionName}".`,
      assetTitle: '3dgs asset upload',
      assetSubtitle: 'Uploads supported 3DGS assets to R2 storage.',
      imageTitle: 'Images to convert',
      imageSubtitle: 'Sends images to cloud GPU and uploads the results to R2.',
      note: '',
    };
  }

  if (type === 'app-storage') {
    return {
      title: 'Add to app storage',
      subtitle: `Choose what you want to add to "${collectionName}".`,
      assetTitle: '3dgs asset import',
      assetSubtitle: 'Saves supported 3DGS assets into app storage.',
      imageTitle: 'Images to convert',
      imageSubtitle: 'Sends images to cloud GPU and saves results into app storage.',
      note: '',
    };
  }

  if (type === 'local-folder') {
    return {
      title: 'Add files',
      subtitle: 'Local folders are read-only. Converted images will download.',
      assetTitle: '3dgs assets',
      assetSubtitle: 'Adds supported 3DGS assets to the temporary queue.',
      imageTitle: 'Images to convert',
      imageSubtitle: 'Sends images to cloud GPU and downloads the results.',
      note: 'Files added here are temporary unless saved to a storage collection.',
    };
  }

  return {
    title: 'Add files',
    subtitle: 'Choose what to add to the local queue.',
    assetTitle: '3dgs assets',
    assetSubtitle: 'Adds supported 3DGS assets to the temporary queue.',
    imageTitle: 'Images to convert',
    imageSubtitle: 'Sends images to cloud GPU and adds converted assets to the queue.',
    note: 'Files added here are temporary unless saved to a storage collection.',
  };
};

const getCollectionPrefix = (source) => {
  if (!source) return undefined;
  const collectionId = source?.config?.collectionId || source?.config?.config?.collectionId;
  return collectionId ? `collections/${collectionId}/assets` : 'collections/default/assets';
};

const sourceCanWrite = (source) => {
  if (!source) return true;
  if (source.type !== 'r2-bucket') return true;
  const permissions = source?.config?.config?.permissions || {};
  return permissions.canWrite === true;
};

export function useCollectionUploadFlow({
  source,
  queueAction = 'replace',
  selectFirstAdded = false,
  allowAssets = true,
  allowImages = true,
  prepareOnly = false,
  onPreparedFiles,
  onOpenCloudGpu,
  onRefreshAssets,
  onAssetsUpdated,
  onLoadingChange,
  onUploadingChange,
  onUploadProgress,
  onUploadState,
  onStatus,
  onError,
}) {
  // Simple error reporter - inlined default behavior
  const reportError = (message) => {
    onError?.(message) ?? (message && alert(message));
  };

  const activeSourceId = useStore((state) => state.activeSourceId);
  const activeAssetsLength = useStore((state) => state.assets.length);
  const setUploadState = useStore((state) => state.setUploadState);
  const resolvedSource = useMemo(
    () => source || (activeSourceId ? getSource(activeSourceId) : null),
    [source, activeSourceId]
  );

  const [showUploadChoiceModal, setShowUploadChoiceModal] = useState(false);
  const [uploadAccept, setUploadAccept] = useState(undefined);
  const uploadModeRef = useRef(null);
  const uploadInputRef = useRef(null);
  const autoReloadTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (autoReloadTimeoutRef.current) {
        clearTimeout(autoReloadTimeoutRef.current);
        autoReloadTimeoutRef.current = null;
      }
    };
  }, []);

  const scheduleAutoReload = useCallback((sourceToReload, preferredIndex = null) => {
    if (!sourceToReload?.id) return;
    if (!activeSourceId || activeSourceId !== sourceToReload.id) return;

    if (autoReloadTimeoutRef.current) {
      clearTimeout(autoReloadTimeoutRef.current);
    }

    autoReloadTimeoutRef.current = setTimeout(async () => {
      autoReloadTimeoutRef.current = null;
      try {
        await loadFromStorageSource(sourceToReload, { preferredIndex });
      } catch (err) {
        console.warn('[UploadFlow] Auto reload failed', err);
      }
    }, AUTO_RELOAD_DELAY_MS);
  }, [activeSourceId]);

  const getPreferredIndex = useCallback((addedCount) => {
    if (!addedCount || addedCount <= 0) return null;
    const baseIndex = Number.isFinite(activeAssetsLength) ? activeAssetsLength : 0;
    return Math.max(0, baseIndex);
  }, [activeAssetsLength]);

  // Helper to compute accept string based on mode
  const computeAcceptForMode = (mode) => {
    // Android needs no filter for 3D files to reach the generic file browser
    if (IS_ANDROID && mode === 'assets') return undefined;
    if (mode === 'images') return IMAGE_ACCEPT;
    if (mode === 'assets') return FORMAT_ACCEPT || undefined;
    // Default: combine both if allowed
    if (allowAssets && allowImages) return FORMAT_ACCEPT ? `${FORMAT_ACCEPT},${IMAGE_ACCEPT}` : IMAGE_ACCEPT;
    if (allowImages) return IMAGE_ACCEPT;
    return FORMAT_ACCEPT || undefined;
  };


  const handleQueueAssets = useCallback(async (files) => {
    if (queueAction === 'append') {
      await handleAddFiles(files, { selectFirstAdded });
    } else {
      await handleMultipleFiles(files);
    }
  }, [queueAction, selectFirstAdded]);

  const handleAssets = useCallback(async (files) => {
    const valid = files.filter(isSupportedFile);
    if (valid.length === 0) {
      onStatus?.('error');
      reportError(`No supported files. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
      return;
    }

    if (prepareOnly) {
      onPreparedFiles?.(valid, 'assets');
      return;
    }

    const type = resolvedSource?.type;

    if (type === 'r2-bucket' && !sourceCanWrite(resolvedSource)) {
      onStatus?.('error');
      reportError('Upload is disabled for this R2 source (write permission is off).');
      return;
    }

    onLoadingChange?.(true);
    try {
      if ((type === 'supabase-storage' || type === 'r2-bucket') && typeof resolvedSource?.uploadAssets === 'function') {
        const result = await resolvedSource.uploadAssets(valid);
        if (!result?.success) {
          onStatus?.('error');
          reportError(result?.error || 'Upload failed');
          return;
        }
        await onRefreshAssets?.();
        await onAssetsUpdated?.({ mode: 'assets', source: resolvedSource, files: valid });
        const addedCount = result?.uploaded?.length ?? valid.length;
        scheduleAutoReload(resolvedSource, getPreferredIndex(addedCount));
        return;
      }

      if ((type === 'app-storage' || type === 'local-folder') && typeof resolvedSource?.importFiles === 'function') {
        const result = await resolvedSource.importFiles(valid);
        if (!result?.success) {
          onStatus?.('error');
          reportError(result?.error || 'Import failed');
          return;
        }
        await onRefreshAssets?.();
        await onAssetsUpdated?.({ mode: 'assets', source: resolvedSource, files: valid });
        const addedCount = result?.imported ?? valid.length;
        scheduleAutoReload(resolvedSource, getPreferredIndex(addedCount));
        return;
      }

      await handleQueueAssets(valid);
    } catch (err) {
      onStatus?.('error');
      reportError(err?.message || String(err));
    } finally {
      onLoadingChange?.(false);
    }
  }, [handleQueueAssets, onAssetsUpdated, onLoadingChange, onPreparedFiles, onRefreshAssets, onStatus, prepareOnly, resolvedSource, scheduleAutoReload, getPreferredIndex]);

  const handleImages = useCallback(async (files) => {
    const imageFiles = files.filter(isImageFile);
    if (imageFiles.length === 0) {
      onStatus?.('error');
      reportError('No image files selected.');
      return;
    }

    const type = resolvedSource?.type;

    if (type === 'r2-bucket' && !sourceCanWrite(resolvedSource)) {
      onStatus?.('error');
      reportError('Upload is disabled for this R2 source (write permission is off).');
      return;
    }
    const prefix = type === 'supabase-storage' || type === 'r2-bucket' ? getCollectionPrefix(resolvedSource) : undefined;
    const returnMode = type === 'supabase-storage' || type === 'r2-bucket' ? undefined : 'direct';
    const downloadMode = type === 'app-storage' || (!resolvedSource && !prepareOnly) || prepareOnly ? 'store' : undefined;

    // Build accessString + storageTarget for the backend
    let cloudStorageTarget;
    let cloudAccessString;
    if (type === 'r2-bucket') {
      const cfg = resolvedSource?.config?.config;
      cloudStorageTarget = 'r2';
      cloudAccessString = JSON.stringify({
        s3Endpoint: cfg?.endpoint,
        s3AccessKeyId: cfg?.accessKeyId,
        s3SecretAccessKey: cfg?.secretAccessKey,
        s3Bucket: cfg?.bucket,
        ...(cfg?.publicBaseUrl ? { s3PublicUrlBase: cfg.publicBaseUrl } : {}),
      });
    } else if (type === 'supabase-storage') {
      const cfg = resolvedSource?.config?.config;
      cloudStorageTarget = 'supabase';
      cloudAccessString = JSON.stringify({
        supabaseUrl: cfg?.supabaseUrl,
        supabaseKey: cfg?.anonKey,
        ...(cfg?.bucket ? { supabaseBucket: cfg.bucket } : {}),
      });
    }

    onLoadingChange?.(true);
    onUploadingChange?.(true);
    const reportUploadState = (state) => {
      onUploadState?.(state);
      setUploadState?.(state);
    };

    let uploadError = null;

    const initialProgress = { stage: 'upload', upload: { loaded: 0, total: 0, done: false }, completed: 0, total: imageFiles.length };
    onUploadProgress?.(initialProgress);
    reportUploadState({ isUploading: true, uploadProgress: initialProgress });

    try {
      const results = await testSharpCloud(imageFiles, {
        prefix,
        returnMode,
        downloadMode,
        storageTarget: cloudStorageTarget,
        accessString: cloudAccessString,
        getJobId: () => generateJobId(),
        pollIntervalMs: 5000,
        onProgress: (progress) => {
          if (progress?.stage === 'error' && progress?.error) {
            uploadError = progress.error;
          }
          onUploadProgress?.(progress);
          reportUploadState({ isUploading: true, uploadProgress: progress });
        },
      });

      const storedFiles = results.flatMap((result) => result?.data?.files || []);
      const anySuccess = results.some((r) => r.ok);
      const silentOnly = results.length > 0 && results.every((r) => r.ok || r.silentFailure);

      if (prepareOnly) {
        if (storedFiles.length > 0) {
          onPreparedFiles?.(storedFiles, 'images');
        } else if (!anySuccess) {
          onStatus?.('error');
          reportError('Image conversion failed.');
        }
        return;
      }

      if (type === 'app-storage' && storedFiles.length > 0 && typeof resolvedSource?.importFiles === 'function') {
        const importResult = await resolvedSource.importFiles(storedFiles);
        if (!importResult?.success) {
          onStatus?.('error');
          reportError(importResult?.error || 'Failed to import converted files');
        } else {
          await onRefreshAssets?.();
        }
        await onAssetsUpdated?.({ mode: 'images', source: resolvedSource, files: storedFiles });
        const addedCount = importResult?.imported ?? storedFiles.length;
        scheduleAutoReload(resolvedSource, getPreferredIndex(addedCount));
        return;
      }

      if ((type === 'supabase-storage' || type === 'r2-bucket') && anySuccess) {
        await onRefreshAssets?.();
        await onAssetsUpdated?.({ mode: 'images', source: resolvedSource, files: imageFiles });
        const addedCount = results.reduce((sum, result) => sum + (result?.ok ? 1 : 0), 0) || imageFiles.length;
        const didRescan = await waitForRemoteRescan(resolvedSource, { expectedMin: addedCount });
        if (!didRescan) {
          console.warn('[UploadFlow] Remote rescan timed out; falling back to delayed refresh');
        }
        scheduleAutoReload(resolvedSource, getPreferredIndex(addedCount));
        return;
      }

      if (!resolvedSource && storedFiles.length > 0) {
        await handleQueueAssets(storedFiles);
        return;
      }

      if (!anySuccess) {
        onStatus?.('error');
        if (!silentOnly) {
          reportError('Image conversion failed.');
        }
      }
    } catch (err) {
      onStatus?.('error');
      reportError(err?.message || String(err));
      uploadError = uploadError || { message: 'Processing failed', detail: err?.message || String(err) };
    } finally {
      onLoadingChange?.(false);
      onUploadingChange?.(false);
      if (uploadError) {
        onUploadProgress?.({ stage: 'error', error: uploadError });
        reportUploadState({ isUploading: true, uploadProgress: { stage: 'error', error: uploadError } });
      } else {
        onUploadProgress?.(null);
        reportUploadState({ isUploading: false, uploadProgress: null });
      }
    }
  }, [handleQueueAssets, onAssetsUpdated, onLoadingChange, onPreparedFiles, onRefreshAssets, onStatus, onUploadProgress, onUploadState, onUploadingChange, prepareOnly, resolvedSource, scheduleAutoReload, getPreferredIndex, setUploadState]);

  const handleFilesForMode = useCallback(async (mode, files) => {
    if (!files?.length) return;

    if (mode === 'images') {
      if (!allowImages) return;
      await handleImages(files);
      return;
    }

    if (!allowAssets) return;
    await handleAssets(files);
  }, [allowAssets, allowImages, handleAssets, handleImages]);

  const openPickerForMode = useCallback(async (mode) => {
    uploadModeRef.current = mode;

    // Compute and set accept value based on mode - this triggers re-render
    const accept = computeAcceptForMode(mode);
    setUploadAccept(accept);

    if (IS_ANDROID && mode === 'assets') {
      // Use setTimeout to ensure state update has flushed to DOM
      setTimeout(() => {
        uploadInputRef.current?.click();
      }, 0);
      return;
    }

    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const types = mode === 'images'
          ? [{ description: 'Images', accept: { 'image/*': DEFAULT_IMAGE_EXTENSIONS } }]
          : [{ description: 'Supported 3DGS assets', accept: { 'application/octet-stream': SUPPORTED_EXTENSIONS } }];

        const handles = await window.showOpenFilePicker({
          multiple: true,
          types,
          excludeAcceptAllOption: false,
        });

        const files = await Promise.all(handles.map((handle) => handle.getFile()));
        await handleFilesForMode(mode, files);
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
        console.warn('showOpenFilePicker failed, falling back to input:', err);
      }
    }

    // For non-Android fallback, also wait for state to flush
    setTimeout(() => {
      uploadInputRef.current?.click();
    }, 0);
  }, [handleFilesForMode]);

  const openUploadPicker = useCallback(() => {
    if (allowAssets && allowImages) {
      setShowUploadChoiceModal(true);
      return;
    }

    if (allowImages) {
      openPickerForMode('images');
      return;
    }

    openPickerForMode('assets');
  }, [allowAssets, allowImages, openPickerForMode]);

  const handleUploadChange = useCallback(async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const mode = uploadModeRef.current || (allowAssets ? 'assets' : 'images');
    uploadModeRef.current = null;
    await handleFilesForMode(mode, files);
  }, [allowAssets, handleFilesForMode]);

  const uploadCopy = useMemo(() => getCollectionUploadCopy(resolvedSource), [resolvedSource]);

  const uploadModal = h(UploadChoiceModal, {
    isOpen: showUploadChoiceModal,
    onClose: () => setShowUploadChoiceModal(false),
    onPickAssets: () => {
      setShowUploadChoiceModal(false);
      openPickerForMode('assets');
    },
    onPickImages: () => {
      setShowUploadChoiceModal(false);
      openPickerForMode('images');
    },
    onOpenCloudGpu,
    supportedExtensions: SUPPORTED_EXTENSIONS,
    title: uploadCopy.title,
    subtitle: uploadCopy.subtitle,
    assetTitle: uploadCopy.assetTitle,
    assetSubtitle: uploadCopy.assetSubtitle,
    imageTitle: uploadCopy.imageTitle,
    imageSubtitle: uploadCopy.imageSubtitle,
    note: uploadCopy.note,
  });

  return {
    uploadInputRef,
    uploadAccept,
    openUploadPicker,
    openPickerForMode,
    handleUploadChange,
    handleAssets,
    handleImages,
    handleFilesForMode,
    uploadModal,
    supportedExtensions: SUPPORTED_EXTENSIONS,
  };
}
