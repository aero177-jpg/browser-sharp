/**
 * Storage Sources List Component
 * 
 * Displays connected storage sources with status indicators.
 * Allows reconnecting, refreshing, and removing sources.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFolder,
  faCloud,
  faPlus,
  faTrash,
  faSync,
  faCheck,
  faExclamationTriangle,
  faSpinner,
  faChevronDown,
  faUnlock,
  faUpload,
  faLink,
  faPen,
  faEllipsisVertical,
} from '@fortawesome/free-solid-svg-icons';
import {
  getSourcesArray,
  onSourceChange,
  deleteSource,
  touchSource,
  setDefaultSource,
} from '../storage/index.js';
import { useStore } from '../store';
import { getSupportedExtensions, getFormatAccept } from '../formats/index.js';
import { testSharpCloud } from '../testSharpCloud';
import ConnectStorageDialog from './ConnectStorageDialog';
import UploadChoiceModal from './UploadChoiceModal';

const TYPE_ICONS = {
  'local-folder': faFolder,
  'supabase-storage': faCloud,
  'public-url': faLink,
};

const TYPE_LABELS = {
  'local-folder': 'Local',
  'supabase-storage': 'Supabase',
  'public-url': 'URL',
};

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff', '.heic'];

const formatEta = (seconds) => {
  const remaining = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

/**
 * Individual source item with controls
 */
function SourceItem({ source, onSelect, onRemove, onEditSource, expanded, onToggleExpand, isActive, onOpenCloudGpu }) {
  const [status, setStatus] = useState('checking');
  const [assetCount, setAssetCount] = useState(source.getAssets().length);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [showUploadChoiceModal, setShowUploadChoiceModal] = useState(false);
  const [uploadMode, setUploadMode] = useState(null); // 'images' | 'assets'
  const uploadInputRef = useRef(null);
  const supportedExtensions = useMemo(() => getSupportedExtensions(), []);
  const acceptString = useMemo(() => getFormatAccept(), []);
  const imageAccept = useMemo(() => `${IMAGE_EXTENSIONS.join(',')},image/*`, []);
  const combinedAccept = useMemo(() => {
    return acceptString ? `${acceptString},${imageAccept}` : imageAccept;
  }, [acceptString, imageAccept]);
  const uploadAccept = useMemo(() => {
    if (uploadMode === 'images') return imageAccept;
    if (uploadMode === 'assets') return acceptString || '';
    return combinedAccept;
  }, [acceptString, combinedAccept, imageAccept, uploadMode]);
  const collectionPrefix = useMemo(() => {
    const collectionId = source?.config?.config?.collectionId;
    return collectionId ? `collections/${collectionId}/assets` : 'collections/default/assets';
  }, [source?.config?.config?.collectionId]);


  const refreshAssets = useCallback(async () => {
    setIsLoading(true);
    try {
      if (source.type === 'supabase-storage' && typeof source.rescan === 'function') {
        const applied = await source.rescan({ applyChanges: true });
        if (!applied?.success) {
          setStatus('error');
          return false;
        }
      }

      const assets = await source.listAssets();
      setAssetCount(assets.length);
      setStatus('connected');
      return true;
    } catch (err) {
      console.error('Refresh failed:', err);
      setStatus('error');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [source]);

  const isSupportedFile = useCallback((file) => {
    if (!file?.name) return false;
    const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
    return supportedExtensions.includes(ext);
  }, [supportedExtensions]);

  const isImageFile = useCallback((file) => {
    if (!file) return false;
    const type = file.type || '';
    const name = (file.name || '').toLowerCase();
    return type.startsWith('image/') || IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
  }, []);

  const processUploads = useCallback(async (files) => {
    if (!files?.length || source.type !== 'supabase-storage' || typeof source.uploadAssets !== 'function') return;

    const valid = files.filter(isSupportedFile);
    const skipped = files.length - valid.length;
    const hasImages = valid.some(isImageFile);

    if (valid.length === 0) {
      alert(`No supported files. Supported: ${supportedExtensions.join(', ')}`);
      return;
    }

    setIsLoading(true);
    setIsUploading(hasImages);
    setUploadProgress(hasImages ? { completed: 0, total: valid.length } : null);
    console.log('upload start', { total: valid.length, showProgress: hasImages });
    try {
      const result = await source.uploadAssets(valid);
      const completed = Array.isArray(result?.uploaded) ? result.uploaded.length : 0;
      if (hasImages) {
        setUploadProgress({ completed, total: valid.length });
      }
      console.log('upload api result', { completed, total: valid.length, failed: result?.failed?.length, success: result?.success });

      if (!result?.success) {
        setStatus('error');
        return;
      }

      const refreshOk = await refreshAssets();
      if (!refreshOk) {
        setStatus('error');
      }

      if (skipped > 0) {
        console.warn(`Skipped ${skipped} unsupported files during upload.`);
      }
    } catch (err) {
      console.error('Upload failed:', err);
      setStatus('error');
    } finally {
      setIsLoading(false);
      setIsUploading(false);
      setUploadProgress(null);
      console.log('upload end');
    }
  }, [isImageFile, isSupportedFile, refreshAssets, source, supportedExtensions]);

  const handleImageConvert = useCallback(async (files) => {
    if (!files?.length) return;

    setIsLoading(true);
    setIsUploading(true);
    setUploadProgress({ completed: 0, total: files.length });
    console.log('convert start', { total: files.length });

    try {
      const results = await testSharpCloud(files, {
        prefix: collectionPrefix,
        onProgress: (progress) => {
          console.log('convert progress', progress);
          setUploadProgress(progress);
        },
      });
      const failures = results.filter((r) => !r.ok);

      const anySuccess = results.some((r) => r.ok);
      if (anySuccess) {
        await refreshAssets();
      }

      if (failures.length > 0) {
        console.warn('Some conversions failed:', failures);
      }
    } catch (err) {
      console.error('Convert/upload failed:', err);
    } finally {
      setIsLoading(false);
      setIsUploading(false);
      setUploadProgress(null);
    }
  }, [collectionPrefix, refreshAssets]);

  const handleFilesForMode = useCallback(async (mode, files) => {
    if (!files?.length || source.type !== 'supabase-storage') return;

    if (mode === 'images') {
      const imageFiles = files.filter(isImageFile);
      if (imageFiles.length === 0) {
        alert('No image files selected.');
        return;
      }
      await handleImageConvert(imageFiles);
      return;
    }

    await processUploads(files);
  }, [handleImageConvert, isImageFile, processUploads, source.type]);

  const openPickerForMode = useCallback(async (mode) => {
    if (source.type !== 'supabase-storage') return;

    setUploadMode(mode);

    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const types = mode === 'images'
          ? [{ description: 'Images', accept: { 'image/*': IMAGE_EXTENSIONS } }]
          : [{ description: 'Supported splat assets', accept: { 'application/octet-stream': supportedExtensions } }];

        const handles = await window.showOpenFilePicker({
          multiple: true,
          types,
          excludeAcceptAllOption: false,
        });

        const files = await Promise.all(handles.map((handle) => handle.getFile()));
        await handleFilesForMode(mode, files);
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return; // user cancelled
        console.warn('showOpenFilePicker failed, falling back to input:', err);
      }
    }

    requestAnimationFrame(() => {
      uploadInputRef.current?.click();
    });
  }, [handleFilesForMode, source.type, supportedExtensions]);

  // Check connection status on mount
  useEffect(() => {
    let cancelled = false;

    const checkStatus = async () => {
      // For local folders, NEVER try to auto-connect after browser restart.
      // Loading handles from IndexedDB can crash Chrome.
      // Just show "needs permission" and let user click to reconnect.
      if (source.type === 'local-folder') {
        // Only check if we have an in-memory handle from this session
        if (source.isConnected()) {
          if (!cancelled) {
            setStatus('connected');
            setAssetCount(source.getAssets().length);
          }
        } else {
          // Don't call connect() - that's safe now but still unnecessary.
          // Just show needs-permission and let user click to reconnect.
          if (!cancelled) {
            setStatus('needs-permission');
          }
        }
        return;
      }

      // For other source types (Supabase, URL), use normal flow
      try {
        if (source.isConnected()) {
          if (!cancelled) {
            setStatus('connected');
            setAssetCount(source.getAssets().length);
          }
          return;
        }

        const result = await source.connect(false);
        if (cancelled) return;

        if (result.success) {
          setStatus('connected');
          try {
            const assets = await source.listAssets();
            if (!cancelled) {
              setAssetCount(assets.length);
            }
          } catch (e) {
            console.warn('Failed to list assets:', e);
          }
        } else if (result.needsPermission) {
          setStatus('needs-permission');
        } else {
          setStatus('disconnected');
        } 
      } catch (err) {
        console.warn('Source status check failed:', err);
        if (!cancelled) {
          setStatus('needs-permission');
        }
      }
    };

    // Small delay to let component mount properly
    const timeoutId = setTimeout(checkStatus, 50);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [source]);

  const handleReconnect = useCallback(async (e) => {
    e.stopPropagation();
    setIsLoading(true);
    setStatus('connecting');

    try {
      // For local folders, reconnect should request permission since this is a user gesture
      if (source.type === 'local-folder' && typeof source.requestPermission === 'function') {
        const result = await source.requestPermission();
        if (result.success) {
          setStatus('connected');
          const assets = await source.listAssets();
          setAssetCount(assets.length);
          await touchSource(source.id);
        } else if (result.needsPermission) {
          setStatus('needs-permission');
        } else {
          setStatus('error');
          if (result?.error) {
            alert(result.error);
          }
        }
      } else {
        // For other source types, use regular connect
        const result = await source.connect(false);
        if (result.success) {
          setStatus('connected');
          const assets = await source.listAssets();
          setAssetCount(assets.length);
          await touchSource(source.id);
        } else if (result.needsPermission) {
          setStatus('needs-permission');
        } else {
          setStatus('error');
        }
      }
    } catch (err) {
      console.error('Reconnect failed:', err);
      setStatus('error');
    } finally {
      setIsLoading(false);
    }
  }, [source]);

  const handleRequestPermission = useCallback(async (e) => {
    e.stopPropagation();
    setIsLoading(true);

    try {
      if (source.type === 'local-folder') {
        if (!('showDirectoryPicker' in window)) {
          alert('Local folder access is not supported in this browser. Try Chrome or Edge.');
          setStatus('error');
          return;
        }

        if (typeof source.requestPermission === 'function') {
          const result = await source.requestPermission();
          if (result.success) {
            setStatus('connected');
            const assets = await source.listAssets();
            setAssetCount(assets.length);
            await touchSource(source.id);
          } else {
            setStatus('error');
            if (result?.error) {
              alert(result.error);
            }
          }
        }
      }
    } catch (err) {
      console.error('Permission request failed:', err);
      alert('Could not grant access. Please try again or re-add the folder.');
      setStatus('error');
    } finally {
      setIsLoading(false);
    }
  }, [source]);

  const handleRefresh = useCallback(async (e) => {
    e.stopPropagation();
    if (!source.isConnected()) return;

    await refreshAssets();
  }, [refreshAssets, source]);

  const handleUploadClick = useCallback(async (e) => {
    e.stopPropagation();
    if (source.type !== 'supabase-storage') return;
    setShowUploadChoiceModal(true);
  }, [source.type]);

  const handleUploadChange = useCallback(async (e) => {
    e.stopPropagation();
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const mode = uploadMode || 'assets';
    setUploadMode(null);
    await handleFilesForMode(mode, files);
  }, [handleFilesForMode, uploadMode]);

  const handleRemove = useCallback(async (e) => {
    e.stopPropagation();
    if (confirm(`Remove "${source.name}" from connected sources?`)) {
      await deleteSource(source.id);
      onRemove?.(source.id);
    }
  }, [source, onRemove]);

  const handleClick = useCallback(() => {
    if (source.isConnected()) {
      onSelect?.(source);
    }
  }, [source, onSelect]);

  const isConnected = status === 'connected';
  const needsPermission = status === 'needs-permission';
  const isDefault = Boolean(source?.config?.isDefault);
  const showUploadProgress = isUploading && uploadProgress;

  // ETA countdown state: set when progress updates, tick down every second while uploading
  const [etaSeconds, setEtaSeconds] = useState(0);
  useEffect(() => {
    if (!showUploadProgress || !uploadProgress) {
      setEtaSeconds(0);
      return;
    }

    const remaining = Math.max(0, (uploadProgress.total - (uploadProgress.completed || 0)) * 40);
    setEtaSeconds(remaining);

    const intervalId = setInterval(() => {
      setEtaSeconds((s) => {
        if (s <= 1) {
          clearInterval(intervalId);
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [showUploadProgress, uploadProgress?.completed, uploadProgress?.total]);

  const etaLabel = showUploadProgress ? formatEta(etaSeconds) : '';

  const handleSetDefault = useCallback(async (e) => {
    e.stopPropagation();

    setIsLoading(true);
    try {
      // Toggle: if already default, clear it; otherwise set it
      await setDefaultSource(isDefault ? null : source.id);
    } catch (err) {
      console.warn('Failed to set default source:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isDefault, source?.id]);

  const handleEditPublicUrl = useCallback((e) => {
    e.stopPropagation();
    if (source.type !== 'public-url') return;
    onEditSource?.(source);
  }, [onEditSource, source]);

  return (
    <>
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        accept={uploadAccept}
        style={{ display: 'none' }}
        onChange={handleUploadChange}
      />
      <div 
        class={`source-item ${isConnected ? 'connected' : ''} ${status} ${isActive ? 'active' : ''}`}
        onClick={handleClick}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', width: '100%', minHeight: '32px' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 0, paddingLeft: '4px', paddingRight: '0px' }}>
            <div class="source-info" style={{ flex: 1 }}>
              <div class="source-name">
                <span class="source-name-text">{source.name}</span>
              </div>
              <div class="source-meta">
                <FontAwesomeIcon icon={TYPE_ICONS[source.type] || faFolder} className="source-type-icon" />
                <span class="source-type">{TYPE_LABELS[source.type]}</span>
                {isConnected && assetCount > 0 && (
                  <span class="source-count">{assetCount}</span>
                )}
              </div>
            </div>

            <div class="source-status">
              {isLoading ? (
                <div class="status-loading">
                  {showUploadProgress && (
                    <span class="upload-progress">
                      {uploadProgress?.completed}/{uploadProgress?.total}  {etaLabel}
                    </span>
                  )}
                  <FontAwesomeIcon icon={faSpinner} spin />
                </div>
              ) : isConnected ? (
                <></>
              ) : needsPermission ? (
                <FontAwesomeIcon icon={faUnlock} className="status-warning" />
              ) : (
                <FontAwesomeIcon icon={faExclamationTriangle} className="status-error" />
              )}
            </div>
          </div>

          <div class="expand-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center', paddingLeft: '2px', flexShrink: 0 }}>
            <div
              class="expand-hit-area"
              style={{ width: "40px", height: "40px", position: 'absolute', top: '50%', right: '-4px', transform: 'translateY(-50%)', background: 'transparent', zIndex: 1, cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
            />
            <button 
              class="source-expand"
              onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
              style={{ position: 'relative', zIndex: 2 }}
            >
              <FontAwesomeIcon icon={faEllipsisVertical} />
            </button>
          </div>
        </div>

      {expanded && (
        <div class="source-actions" onClick={(e) => e.stopPropagation()}>
          {needsPermission ? (
            <button 
              class="source-action-btn" 
              onClick={handleRequestPermission}
              title="Grant permission"
            >
              <FontAwesomeIcon icon={faUnlock} />
              <span>Grant Access</span>
            </button>
          ) : !isConnected ? (
            <button 
              class="source-action-btn" 
              onClick={handleReconnect}
              title="Reconnect"
            >
              <FontAwesomeIcon icon={faSync} />
              <span>Reconnect</span>
            </button>
          ) : (
            <button 
              class="source-action-btn" 
              onClick={handleRefresh}
              title="Refresh assets"
            >
              <FontAwesomeIcon icon={faSync} />
              <span>Refresh</span>
            </button>
          )}
          <button
            class={`source-action-btn ${isDefault ? 'default' : ''}`}
            onClick={handleSetDefault}
            title={isDefault ? 'Clear default collection' : 'Set as default collection'}
          >
            {isDefault && <FontAwesomeIcon icon={faCheck} />}
            <span>{isDefault ? 'Default' : 'Set Default'}</span>
          </button>
          {source.type === 'public-url' && (
            <button
              class="source-action-btn"
              onClick={handleEditPublicUrl}
              title="Edit URLs"
            >
              <FontAwesomeIcon icon={faPen} />
              <span>Edit</span>
            </button>
          )}
          {source.type === 'supabase-storage' && (
            <>
              <button
                class="source-action-btn"
                onClick={handleUploadClick}
                title="Upload files to Supabase"
              >
                <FontAwesomeIcon icon={faUpload} />
                <span>Upload</span>
              </button>
            </>
          )}
          <button 
            class="source-action-btn danger" 
            onClick={handleRemove}
            title="Remove source"
          >
            <FontAwesomeIcon icon={faTrash} />
            <span>Remove</span>
          </button>
        </div>
      )}
      </div>

      <UploadChoiceModal
        isOpen={showUploadChoiceModal}
        onClose={() => setShowUploadChoiceModal(false)}
        onPickAssets={() => {
          setShowUploadChoiceModal(false);
          openPickerForMode('assets');
        }}
        onPickImages={() => {
          setShowUploadChoiceModal(false);
          openPickerForMode('images');
        }}
        onOpenCloudGpu={() => {
          setShowUploadChoiceModal(false);
          onOpenCloudGpu?.();
        }}
        imageExtensions={IMAGE_EXTENSIONS}
        supportedExtensions={supportedExtensions}
      />
    </>
  );
}

/**
 * Storage sources list with collapsible toggle and add button
 */
function StorageSourceList({ onAddSource, onSelectSource, onOpenCloudGpu }) {
  const [sources, setSources] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [isListExpanded, setIsListExpanded] = useState(true);
  const [editSource, setEditSource] = useState(null);
  const activeSourceId = useStore((state) => state.activeSourceId);

  // Load sources on mount and subscribe to changes
  useEffect(() => {
    setSources(getSourcesArray());

    const unsubscribe = onSourceChange((event, sourceId) => {
      setSources(getSourcesArray());
    });

    return unsubscribe;
  }, []);

  const handleToggleExpand = useCallback((sourceId) => {
    setExpandedId(prev => prev === sourceId ? null : sourceId);
  }, []);

  const handleRemove = useCallback((sourceId) => {
    if (expandedId === sourceId) {
      setExpandedId(null);
    }
  }, [expandedId]);

  const handleEditSource = useCallback((source) => {
    setEditSource(source);
  }, []);

  const handleCloseEdit = useCallback(() => {
    setEditSource(null);
  }, []);

  return (
    <div class="settings-group">
      <div 
        class="group-toggle" 
        aria-expanded={isListExpanded}
        onClick={() => setIsListExpanded(!isListExpanded)}
      >
        <span class="settings-eyebrow">Collections</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginRight: '-8px' }}>
          <button 
            class="add-source-btn" 
            onClick={(e) => { e.stopPropagation(); onAddSource(); }} 
            title="Add storage source"
            style={{ width: '28px', height: '22px', fontSize: '11px' }}
          >
            <FontAwesomeIcon icon={faPlus} />
          </button>
          <FontAwesomeIcon icon={faChevronDown} class="chevron" />
        </div>
      </div>

      <div class="group-content" style={{ display: isListExpanded ? 'flex' : 'none' }}>
        {sources.length === 0 ? (
          <div class="sources-empty">
            <p>No storage sources connected</p>
            <button class="add-source-link" onClick={onAddSource}>
              <FontAwesomeIcon icon={faPlus} /> Connect storage
            </button>
          </div>
        ) : (
          <div class="sources-list">
            {sources.map((source) => (
              <SourceItem
                key={source.id}
                source={source}
                isActive={source.id === activeSourceId}
                expanded={expandedId === source.id}
                onToggleExpand={() => handleToggleExpand(source.id)}
                onSelect={onSelectSource}
                onEditSource={handleEditSource}
                onRemove={handleRemove}
                onOpenCloudGpu={onOpenCloudGpu}
              />
            ))}
          </div>
        )}
      </div>

      {editSource && (
        <ConnectStorageDialog
          isOpen={!!editSource}
          onClose={handleCloseEdit}
          onConnect={handleCloseEdit}
          editSource={editSource}
        />
      )}
    </div>
  );
}

export default StorageSourceList;
