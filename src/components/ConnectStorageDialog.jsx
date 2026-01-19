/**
 * Connect to Storage Dialog
 *
 * Modal dialog for adding new collections backed by Local Folder or Supabase Storage.
 */

import { useState, useCallback, useEffect, useMemo } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFolder,
  faCloud,
  faTimes,
  faCheck,
  faSpinner,
  faExclamationTriangle,
  faChevronRight,
  faChevronDown,
  faPlus,
  faLink,
  faQuestion,
  faFolderOpen,
} from '@fortawesome/free-solid-svg-icons';
import {
  SOURCE_TIERS,
  isFileSystemAccessSupported,
  createLocalFolderSource,
  createPublicUrlSource,
  createSupabaseStorageSource,
  registerSource,
  saveSource,
} from '../storage/index.js';
import { loadSupabaseSettings, saveSupabaseSettings } from '../storage/supabaseSettings.js';
import { listExistingCollections, testBucketConnection } from '../storage/supabaseApi.js';
import { getAssetList } from '../assetManager.js';
import { getSupportedExtensions } from '../formats/index.js';
import CloudGpuForm from './CloudGpuForm.jsx';

const ICONS = {
  folder: faFolder,
  cloud: faCloud,
  link: faLink,
};

function TierCard({ type, selected, onSelect, disabled }) {
  const info = SOURCE_TIERS[type];
  if (!info) return null;

  return (
    <button
      class={`storage-tier-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={() => !disabled && onSelect(type)}
      disabled={disabled}
    >
      <div class="tier-icon">
        <FontAwesomeIcon icon={ICONS[info.icon] || faFolder} />
      </div>
      <div class="tier-content">
        <div class="tier-header">
          <h4>{info.label}</h4>
          {/* {info.tier === 3 && <span class="tier-badge">Recommended</span>} */}
        </div>
        <p class="tier-description">{info.description}</p>
        {disabled && (
          <p class="tier-disabled-reason">
            <FontAwesomeIcon icon={faExclamationTriangle} />
            {' '}Not supported in this browser
          </p>
        )}
      </div>
      <FontAwesomeIcon icon={faChevronRight} class="tier-arrow" />
    </button>
  );
}

function LocalFolderForm({ onConnect, onBack }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [collectionName, setCollectionName] = useState('');

  const handleSelect = useCallback(async () => {
    setStatus('connecting');
    setError(null);

    try {
      const source = createLocalFolderSource();
      const result = await source.connect(true);

      if (result.success) {
        if (collectionName.trim()) {
          source.name = collectionName.trim();
          source.config.name = collectionName.trim();
        }
        registerSource(source);
        setStatus('success');
        setTimeout(() => onConnect(source), 500);
      } else {
        setError(result.error || 'Failed to connect');
        setStatus('error');
      }
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, [onConnect, collectionName]);

  return (
    <div class="storage-form">
      <button class="back-button" onClick={onBack}>
        {'Back'}
      </button>

      <h3>Create local collection</h3>

      <div class="form-field">
        <label>Collection name</label>
        <input
          type="text"
          placeholder="My local splats"
          value={collectionName}
          onInput={(e) => setCollectionName(e.target.value)}
        />
      </div>

      <div class="form-info">
        <p>Select a folder containing splat files (.ply, .sog).</p>
        <ul class="feature-list">
          <li><FontAwesomeIcon icon={faCheck} /> Works offline after selection</li>
          <li><FontAwesomeIcon icon={faCheck} /> Fast loading from local disk</li>
          <li><FontAwesomeIcon icon={faCheck} /> Folder access persists across sessions</li>
          <li><FontAwesomeIcon icon={faCheck} /> Preview images matched automatically</li>
        </ul>
      </div>

      {error && (
        <div class="form-error">
          <FontAwesomeIcon icon={faExclamationTriangle} />
          {' '}{error}
        </div>
      )}

      <button
        class="primary-button"
        onClick={handleSelect}
        disabled={status === 'connecting'}
      >
        {status === 'connecting' ? (
          <>
            <FontAwesomeIcon icon={faSpinner} spin />
            {' '}Selecting...
          </>
        ) : status === 'success' ? (
          <>
            <FontAwesomeIcon icon={faCheck} />
            {' '}Connected!
          </>
        ) : (
          <>
            <FontAwesomeIcon icon={faFolder} />
            {' '}Select Folder
          </>
        )}
      </button>

      <p class="form-note">
        Your browser will ask for permission to access the folder.
        The app only reads files and never uploads data.
      </p>
    </div>
  );
}

function UrlCollectionForm({ onConnect, onBack, initialSource, editMode = false, onSaveEdit }) {
  const initialUrls = useMemo(() => {
    if (editMode && initialSource?.config?.config?.assetPaths?.length) {
      return [...initialSource.config.config.assetPaths];
    }
    return [''];
  }, [editMode, initialSource]);
  const [urls, setUrls] = useState(initialUrls);
  const [collectionName, setCollectionName] = useState(
    editMode ? (initialSource?.name || initialSource?.config?.name || '') : ''
  );
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (editMode && initialSource) {
      setUrls(initialSource?.config?.config?.assetPaths?.length ? [...initialSource.config.config.assetPaths] : ['']);
      setCollectionName(initialSource?.name || initialSource?.config?.name || '');
      setStatus('idle');
      setError(null);
    }
  }, [editMode, initialSource]);

  const updateUrl = useCallback((index, value) => {
    setUrls((prev) => prev.map((u, i) => (i === index ? value : u)));
  }, []);

  const addRow = useCallback(() => {
    setUrls((prev) => [...prev, '']);
  }, []);

  const removeRow = useCallback((index) => {
    setUrls((prev) => (prev.length === 1 ? [''] : prev.filter((_, i) => i !== index)));
  }, []);

  const isValidUrl = useCallback((url) => {
    if (!url.trim()) return false;
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }, []);

  const allUrlsValid = useMemo(() => {
    const nonEmpty = urls.filter(u => u.trim());
    return nonEmpty.length > 0 && nonEmpty.every(u => isValidUrl(u));
  }, [urls, isValidUrl]);

  const handleConnect = useCallback(async () => {
    const cleaned = urls.map((u) => u.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      setError('Add at least one URL');
      return;
    }

    // Basic URL validation
    for (const u of cleaned) {
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          throw new Error('URL must be http/https');
        }
      } catch (err) {
        setError(`Invalid URL: ${u}`);
        return;
      }
    }

    setStatus('connecting');
    setError(null);

    try {
      if (editMode && initialSource) {
        const updatedName = collectionName.trim() || initialSource.name;
        initialSource.name = updatedName;
        initialSource.config.name = updatedName;
        initialSource.config.config.assetPaths = cleaned;
        initialSource.config.config.customName = Boolean(collectionName.trim());

        await saveSource(initialSource.toJSON());
        registerSource(initialSource);
        await initialSource.listAssets();

        setStatus('success');
        const finish = onSaveEdit || onConnect;
        if (finish) {
          setTimeout(() => finish(initialSource), 300);
        }
        return;
      }

      const source = createPublicUrlSource({
        assetPaths: cleaned,
        name: collectionName.trim() || 'URL collection',
      });

      const result = await source.connect();

      if (result.success) {
        registerSource(source);
        await saveSource(source.toJSON());
        setStatus('success');
        setTimeout(() => onConnect(source), 500);
      } else {
        setError(result.error || 'Failed to connect');
        setStatus('error');
      }
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, [urls, collectionName, onConnect, editMode, initialSource, onSaveEdit]);

  return (
    <div class="storage-form">
      {!editMode && (
        <button class="back-button" onClick={onBack}>
          {'Back'}
        </button>
      )}

      <h3>{editMode ? 'Edit URL collection' : 'Create URL collection'}</h3>

      <div class="form-info">
        <ul class="feature-list">
          <li><FontAwesomeIcon icon={faCheck} /> No setup or credentials required</li>
          <li><FontAwesomeIcon icon={faCheck} /> Direct HTTP/HTTPS links only, read-only</li>
          <li><FontAwesomeIcon icon={faCheck} /> Best for quick demos or hosted files</li>
        </ul>
      </div>

      <div class="form-field">
        <label>Collection name</label>
        <input
          type="text"
          placeholder="Public URLs"
          value={collectionName}
          onInput={(e) => setCollectionName(e.target.value)}
        />
      </div>

      <div class="form-field">
        <label>Asset URLs</label>
        <div class="url-list">
          {urls.map((url, index) => {
            const isValid = isValidUrl(url);
            const showInvalid = url.trim() && !isValid;
            return (
              <div class="url-row" key={`url-${index}`}>
                <div class="url-input-wrapper">
                  <input
                    type="url"
                    placeholder="https://example.com/scene.sog"
                    value={url}
                    onInput={(e) => updateUrl(index, e.target.value)}
                    class={showInvalid ? 'invalid' : ''}
                  />
                </div>
                <button
                  class="url-remove-btn"
                  onClick={() => removeRow(index)}
                  title="Remove URL"
                  type="button"
                >
                  <FontAwesomeIcon icon={faTimes} />
                </button>
              </div>
            );
          })}
        </div>
        <button class="add-url-btn" onClick={addRow} type="button">
          <FontAwesomeIcon icon={faPlus} />
          <span>Add another URL</span>
        </button>
        <span class="field-hint">Provide direct links to .sog/.ply files. Invalid URLs show a red outline.</span>
      </div>

      {error && (
        <div class="form-error">
          <FontAwesomeIcon icon={faExclamationTriangle} />
          {' '}{error}
        </div>
      )}

      <button
        class="primary-button save-collection-btn"
        onClick={handleConnect}
        disabled={status === 'connecting' || !allUrlsValid}
      >
        {status === 'connecting' ? (
          <>
            <FontAwesomeIcon icon={faSpinner} spin />
            <span>{editMode ? 'Saving changes...' : 'Saving collection...'}</span>
          </>
        ) : status === 'success' ? (
          <>
            <FontAwesomeIcon icon={faCheck} />
            <span>{editMode ? 'Updated!' : 'Connected!'}</span>
          </>
        ) : (
          <>
            <FontAwesomeIcon icon={faCheck} />
            <span>{editMode ? 'Save changes' : 'Save URL collection'}</span>
          </>
        )}
      </button>
    </div>
  );
}

/**
 * Expandable FAQ item
 */
function FaqItem({ question, children }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div class="faq-item">
      <button 
        class="faq-question" 
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <FontAwesomeIcon icon={faQuestion} className="faq-icon" />
        <span>{question}</span>
        <FontAwesomeIcon icon={expanded ? faChevronDown : faChevronRight} className="faq-chevron" />
      </button>
      {expanded && (
        <div class="faq-answer">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Existing collection list item
 */
function ExistingCollectionItem({ collection, onSelect, isLoading, selected }) {
  return (
    <button 
      class={`existing-collection-item ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(collection)}
      disabled={isLoading}
    >
      <div class="collection-info">
        <FontAwesomeIcon icon={faFolderOpen} className="collection-icon" />
        <div class="collection-details">
          <span class="collection-name">{collection.name}</span>
          <span class="collection-meta">
            {collection.id} · {collection.assetCount} asset{collection.assetCount !== 1 ? 's' : ''}
            {collection.hasManifest && <span class="manifest-badge">manifest</span>}
          </span>
        </div>
      </div>
      <FontAwesomeIcon icon={faChevronRight} className="collection-arrow" />
    </button>
  );
}

function SupabaseForm({ onConnect, onBack, onClose }) {
  const supportedExtensions = useMemo(() => getSupportedExtensions(), []);
  const queuedAssets = useMemo(() => getAssetList(), []);
  const queueFiles = useMemo(() => {
    return queuedAssets
      .filter((asset) => asset?.file && asset?.file?.name)
      .filter((asset) => {
        const ext = asset.file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
        return supportedExtensions.includes(ext);
      })
      .map((asset) => asset.file);
  }, [queuedAssets, supportedExtensions]);
  const hasQueueFiles = queueFiles.length > 0;

  const initialSettings = useMemo(
    () => loadSupabaseSettings() || { supabaseUrl: '', anonKey: '', bucket: '' },
    []
  );
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [supabaseUrl, setSupabaseUrl] = useState(initialSettings.supabaseUrl);
  const [anonKey, setAnonKey] = useState(initialSettings.anonKey);
  const [bucket, setBucket] = useState(initialSettings.bucket);
  const [collectionName, setCollectionName] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [hasManifest, setHasManifest] = useState(null);
  // Default to false so the checkbox is unchecked until the user explicitly selects it.
  const [uploadExisting, setUploadExisting] = useState(false);

  // Existing collections browser
  const [existingCollections, setExistingCollections] = useState([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [showExisting, setShowExisting] = useState(false);
  const [showSupabaseConfig, setShowSupabaseConfig] = useState(false);
  const [selectedExisting, setSelectedExisting] = useState(null);

  const supabaseConfigured = Boolean(
    savedSettings.supabaseUrl && savedSettings.anonKey && savedSettings.bucket
  );
  const trimmedSettings = useMemo(() => ({
    supabaseUrl: supabaseUrl.trim(),
    anonKey: anonKey.trim(),
    bucket: bucket.trim(),
  }), [supabaseUrl, anonKey, bucket]);
  const trimmedSaved = useMemo(() => ({
    supabaseUrl: savedSettings.supabaseUrl?.trim?.() || '',
    anonKey: savedSettings.anonKey?.trim?.() || '',
    bucket: savedSettings.bucket?.trim?.() || '',
  }), [savedSettings]);
  const isSettingsReady = Boolean(
    trimmedSettings.supabaseUrl && trimmedSettings.anonKey && trimmedSettings.bucket
  );
  const settingsChanged =
    trimmedSettings.supabaseUrl !== trimmedSaved.supabaseUrl ||
    trimmedSettings.anonKey !== trimmedSaved.anonKey ||
    trimmedSettings.bucket !== trimmedSaved.bucket;
  const shouldFadeSaveText = !isSettingsReady || (supabaseConfigured && !settingsChanged);

  const slugify = useCallback((value) => {
    const slug = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || 'collection';
  }, []);

  // Auto-load existing collections when config is saved
  const loadExistingCollections = useCallback(async () => {
    if (!supabaseConfigured) return;
    
    setLoadingCollections(true);
    setError(null);
    
    const result = await listExistingCollections({
      supabaseUrl: supabaseUrl.trim(),
      anonKey: anonKey.trim(),
      bucket: bucket.trim(),
    });

    setLoadingCollections(false);

    if (result.success) {
      setExistingCollections(result.collections);
    } else {
      setError(result.error);
    }
  }, [supabaseConfigured, supabaseUrl, anonKey, bucket]);

  const handleSaveSettings = useCallback(async () => {
    if (!supabaseUrl.trim() || !anonKey.trim() || !bucket.trim()) {
      setError('Fill Supabase URL, anon key, and bucket.');
      return;
    }

    setStatus('testing');
    setError(null);

    const testResult = await testBucketConnection({
      supabaseUrl: trimmedSettings.supabaseUrl,
      anonKey: trimmedSettings.anonKey,
      bucket: trimmedSettings.bucket,
    });

    if (!testResult.success) {
      setError(`Connection failed: ${testResult.error}`);
      setStatus('idle');
      return;
    }

    saveSupabaseSettings({
      supabaseUrl: trimmedSettings.supabaseUrl,
      anonKey: trimmedSettings.anonKey,
      bucket: trimmedSettings.bucket,
    });
    setSavedSettings({
      supabaseUrl: trimmedSettings.supabaseUrl,
      anonKey: trimmedSettings.anonKey,
      bucket: trimmedSettings.bucket,
    });

    setStatus('idle');
    setError(null);

    // Load existing collections after successful config
    await loadExistingCollections();
  }, [supabaseUrl, anonKey, bucket, loadExistingCollections]);

  const handleChooseExisting = useCallback((collection) => {
    setSelectedExisting(collection);
    setHasManifest(null);
    setStatus('idle');
    setError(null);
  }, []);

  const handleConnectSelected = useCallback(async () => {
    if (!selectedExisting) return;

    setStatus('connecting');
    setError(null);

    try {
      const source = createSupabaseStorageSource({
        supabaseUrl: supabaseUrl.trim(),
        anonKey: anonKey.trim(),
        bucket: bucket.trim(),
        collectionId: selectedExisting.id,
        collectionName: selectedExisting.name,
      });

      const result = await source.connect({ refreshManifest: true });

      if (result.success) {
        setHasManifest(source.config.config.hasManifest);
        registerSource(source);
        await saveSource(source.toJSON());
        setStatus('success');
        setTimeout(() => onClose?.(), 500);
      } else {
        setError(result.error || 'Failed to connect');
        setStatus('error');
      }
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, [supabaseUrl, anonKey, bucket, onClose, selectedExisting]);

  const handleConnectAndSwitch = useCallback(async () => {
    if (!selectedExisting) return;

    setStatus('connecting');
    setError(null);

    try {
      const source = createSupabaseStorageSource({
        supabaseUrl: supabaseUrl.trim(),
        anonKey: anonKey.trim(),
        bucket: bucket.trim(),
        collectionId: selectedExisting.id,
        collectionName: selectedExisting.name,
      });

      const result = await source.connect({ refreshManifest: true });

      if (result.success) {
        setHasManifest(source.config.config.hasManifest);
        registerSource(source);
        await saveSource(source.toJSON());
        setStatus('success');
        setTimeout(() => onConnect(source), 500);
      } else {
        setError(result.error || 'Failed to connect');
        setStatus('error');
      }
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, [supabaseUrl, anonKey, bucket, onConnect, selectedExisting]);

  const handleCreateNew = useCallback(async () => {
    if (!supabaseConfigured) {
      setError('Configure Supabase first.');
      return;
    }

    const collectionId = slugify(collectionName.trim()) || `collection-${Date.now()}`;

    setStatus('connecting');
    setError(null);

    try {
      const source = createSupabaseStorageSource({
        supabaseUrl: supabaseUrl.trim(),
        anonKey: anonKey.trim(),
        bucket: bucket.trim(),
        collectionId,
        collectionName: collectionName.trim() || undefined,
      });

      const result = await source.connect({ refreshManifest: true, verifyUpload: true });

      if (result.success) {
        setHasManifest(source.config.config.hasManifest);
        registerSource(source);
        await saveSource(source.toJSON());

        if (uploadExisting && queueFiles.length > 0) {
          setStatus('uploading');
          const uploadResult = await source.uploadAssets(queueFiles);
          if (!uploadResult.success) {
            const firstError = uploadResult.failed?.[0]?.error;
            setError(firstError ? `Some uploads failed: ${firstError}` : 'Some uploads failed.');
          }
        }

        setStatus('success');
        setTimeout(() => onConnect(source), 500);
      } else {
        setError(result.error || 'Failed to connect');
        setStatus('error');
      }
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, [supabaseConfigured, supabaseUrl, anonKey, bucket, collectionName, slugify, onConnect, uploadExisting, queueFiles]);

  // Show config-only view if not configured
  if (!supabaseConfigured) {
    return (
      <div class="storage-form">
        <button class="back-button" onClick={onBack}>
          {'Back'}
        </button>

        <h3>Connect to Supabase</h3>
        <p class="dialog-subtitle">Enter your Supabase credentials to get started.</p>

        <div class="config-grid" style={{ marginTop: '16px' }}>
          <div class="form-field">
            <label>Supabase project URL</label>
            <input
              type="url"
              placeholder="https://abc.supabase.co"
              value={supabaseUrl}
              onInput={(e) => setSupabaseUrl(e.target.value)}
            />
          </div>

          <div class="form-field">
            <label>Anon/public key</label>
            <input
              type="text"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={anonKey}
              onInput={(e) => setAnonKey(e.target.value)}
            />
          </div>

          <div class="form-field">
            <label>Bucket name</label>
            <input
              type="text"
              placeholder="splat-assets"
              value={bucket}
              onInput={(e) => setBucket(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div class="form-error">
            <FontAwesomeIcon icon={faExclamationTriangle} />
            {' '}{error}
          </div>
        )}

        <button
          class="primary-button"
          onClick={handleSaveSettings}
          disabled={status === 'testing' || !isSettingsReady}
          style={{ marginTop: '16px' }}
        >
          {status === 'testing' ? (
            <>
              <FontAwesomeIcon icon={faSpinner} spin />
              {' '}Testing connection...
            </>
          ) : (
            'Connect to Supabase'
          )}
        </button>

        <div class="faq-section" style={{ marginTop: '24px' }}>
          <FaqItem question="Where do I find these keys?">
            <ol class="faq-steps">
              <li>Go to your <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer noopener">Supabase Dashboard</a></li>
              <li>Select your project (or create one)</li>
              <li>Click <strong>Project Settings</strong> → <strong>API</strong></li>
              <li>Copy the <strong>Project URL</strong> and <strong>anon/public</strong> key</li>
              <li>Go to <strong>Storage</strong> to create a bucket if needed</li>
            </ol>
          </FaqItem>

          <FaqItem question="How do I set up a free Supabase store?">
            <ol class="faq-steps">
              <li>Sign up at <a href="https://supabase.com" target="_blank" rel="noreferrer noopener">supabase.com</a> (free tier available)</li>
              <li>Create a new project</li>
              <li>Go to <strong>Storage</strong> in the sidebar</li>
              <li>Click <strong>New Bucket</strong>, name it (e.g., "splat-assets")</li>
              <li>Toggle <strong>Public bucket</strong> on for easy access</li>
              <li>Copy credentials from <strong>Project Settings</strong> → <strong>API</strong></li>
            </ol>
          </FaqItem>
        </div>
      </div>
    );
  }

  // Configured view - show existing collections + create new
  return (
    <div class="storage-form">
      <button class="back-button" onClick={onBack}>
        {'Back'}
      </button>

      <h3>Supabase Collection</h3>
      <div class="form-section">
        <div class="form-row">
          <div>
            <strong>Supabase settings</strong>
            <div class="field-hint">
              {supabaseConfigured
                ? <>Using bucket <em>{bucket}</em></>
                : 'Not configured yet.'}
            </div>
          </div>
          <button class="link-button" onClick={() => setShowSupabaseConfig(!showSupabaseConfig)}>
            {showSupabaseConfig ? 'Hide config' : (supabaseConfigured ? 'Edit config' : 'Configure Supabase')}
          </button>
        </div>

        {showSupabaseConfig && (
          <div class="config-grid">
            <div class="form-field">
              <label>Supabase project URL</label>
              <input
                type="url"
                placeholder="https://abc.supabase.co"
                value={supabaseUrl}
                onInput={(e) => setSupabaseUrl(e.target.value)}
              />
            </div>

            <div class="form-field">
              <label>Anon/public key</label>
              <input
                type="text"
                placeholder="supabase anon key"
                value={anonKey}
                onInput={(e) => setAnonKey(e.target.value)}
              />
              {/* <span class="field-hint">Use the anon/public key; the app is client-only.</span> */}
            </div>

            <div class="form-field">
              <label>Bucket name</label>
              <input
                type="text"
                placeholder="splat-assets"
                value={bucket}
                onInput={(e) => setBucket(e.target.value)}
              />
            </div>

            <button
              class={`secondary-button save-settings-btn ${isSettingsReady ? 'is-ready' : ''}`}
              onClick={handleSaveSettings}
              disabled={
                status === 'testing' ||
                !isSettingsReady ||
                (supabaseConfigured && !settingsChanged)
              }
            >
              <span class={`save-settings-text ${shouldFadeSaveText ? 'is-muted' : ''}`}>
                Save Supabase settings
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Existing collections section */}
      <div class="form-section" style={{ marginTop: '16px' }}>
        <div class="form-row">
          <div>
            <strong>
              <FontAwesomeIcon icon={faFolderOpen} style={{ marginRight: '8px' }} />
              Add Existing Folder
            </strong>
          </div>
          <button 
            class="link-button" 
            onClick={() => {
              setShowExisting(!showExisting);
              if (!showExisting && existingCollections.length === 0) {
                loadExistingCollections();
              }
            }}
          >
            {showExisting ? 'Hide' : 'Browse'}
          </button>
        </div>

        {showExisting && (
          <div class="existing-collections-list">
            {loadingCollections ? (
              <div class="collections-loading">
                <FontAwesomeIcon icon={faSpinner} spin />
                {' '}Scanning bucket...
              </div>
            ) : existingCollections.length === 0 ? (
              <div class="collections-empty">
                No existing collections found in this bucket.
              </div>
            ) : (
              existingCollections.map((col) => (
                <ExistingCollectionItem
                  key={col.id}
                  collection={col}
                  onSelect={handleChooseExisting}
                  isLoading={status === 'connecting'}
                  selected={selectedExisting?.id === col.id}
                />
              ))
            )}
          </div>
        )}
      </div>

      {selectedExisting && (
        <div class="form-section existing-selection-review" style={{ position: 'relative' }}>
          <button
            class="modal-close selection-close"
            title="Clear selected collection"
            onClick={() => setSelectedExisting(null)}
            disabled={status === 'connecting'}
            style={{ position: 'absolute', top: '8px', right: '8px' }}
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>

          <div class="form-row">
            <div>
              <strong>Selected collection</strong>
              <div class="field-hint">
                {selectedExisting.name} ({selectedExisting.id}) · {selectedExisting.assetCount} asset{selectedExisting.assetCount !== 1 ? 's' : ''}
                {selectedExisting.hasManifest && ' · manifest detected'}
              </div>
            </div>
          </div>

          <div class="form-actions" style={{ marginTop: '16px', gap: '8px', display: 'flex' }}>
            <button
              class="secondary-button"
              style={{marginTop: "0px"}}
              onClick={handleConnectAndSwitch}
              disabled={status === 'connecting'}
            >
              Switch to new collection
            </button>
            <button
              class="primary-button"
              onClick={handleConnectSelected}
              disabled={status === 'connecting'}
            >
              {status === 'connecting' ? (
                <>
                  <FontAwesomeIcon icon={faSpinner} spin />
                  {' '}Connecting...
                </>
              ) : (
                'Done'
              )}
            </button>
          </div>
        </div>
      )}

      <div class="form-divider">
        <span>or create new</span>
      </div>

      {/* Create new collection */}
      <div class="form-field">
        <label>Collection name</label>
        <input
          type="text"
          placeholder="My splat gallery"
          value={collectionName}
          onInput={(e) => setCollectionName(e.target.value)}
        />
        <span class="field-hint">
          Will be stored under collections/{slugify(collectionName) || 'collection-xxx'}/
        </span>
      </div>

      {hasQueueFiles && (
        <div class="form-field">
          <label class="checkbox-inline">
            <input
              type="checkbox"
              checked={uploadExisting}
              onChange={(e) => setUploadExisting(e.target.checked)}
            />
            Upload current images ({queueFiles.length})
          </label>
          <span class="field-hint">Uploads start right after the collection is created.</span>
        </div>
      )}

      {error && (
        <div class="form-error">
          <FontAwesomeIcon icon={faExclamationTriangle} />
          {' '}{error}
        </div>
      )}

      {status === 'success' && hasManifest !== null && (
        <div class={`form-success ${hasManifest ? '' : 'warning'}`}>
          <FontAwesomeIcon icon={hasManifest ? faCheck : faExclamationTriangle} />
          {' '}
          {hasManifest
            ? 'Found manifest.json - loading is manifest-first'
            : 'Manifest was created for you'}
        </div>
      )}

      <button
        class="primary-button"
        onClick={handleCreateNew}
        disabled={status === 'connecting' || status === 'uploading'}
      >
        {status === 'connecting' ? (
          <>
            <FontAwesomeIcon icon={faSpinner} spin />
            {' '}Creating collection...
          </>
        ) : status === 'uploading' ? (
          <>
            <FontAwesomeIcon icon={faSpinner} spin />
            {' '}Uploading...
          </>
        ) : status === 'success' ? (
          <>
            <FontAwesomeIcon icon={faCheck} />
            {' '}Connected!
          </>
        ) : (
          'Create New Collection'
        )}
      </button>

      <p class="form-note" style={{ marginTop: '16px' }}>
        <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer noopener">Dashboard</a>
        {' · '}
        <a href="https://supabase.com/docs/guides/storage" target="_blank" rel="noreferrer noopener">Storage docs</a>
      </p>
    </div>
  );
}

function ConnectStorageDialog({ isOpen, onClose, onConnect, editSource, onEditComplete, initialTier = null }) {
  const [selectedTier, setSelectedTier] = useState(editSource?.type || initialTier || null);
  const localSupported = isFileSystemAccessSupported();

  useEffect(() => {
    if (editSource) {
      setSelectedTier(editSource.type);
    }
  }, [editSource]);

  useEffect(() => {
    if (!editSource && isOpen) {
      setSelectedTier(initialTier || null);
    }
  }, [editSource, initialTier, isOpen]);

  const handleConnect = useCallback((source) => {
    onConnect?.(source);
    onClose();
    setSelectedTier(editSource?.type || null);
  }, [onConnect, onClose, editSource?.type]);

  const handleBack = useCallback(() => {
    setSelectedTier(editSource?.type || null);
  }, [editSource?.type]);

  const handleClose = useCallback(() => {
    onClose();
    setSelectedTier(null);
  }, [onClose]);

  if (!isOpen) return null;

  const isEditMode = Boolean(editSource && editSource.type === 'public-url');

  const content = (
    <div class="modal-overlay storage-dialog-overlay" onClick={handleClose}>
      <div class="modal-content storage-dialog" onClick={(e) => e.stopPropagation()}>
        <button class="modal-close" onClick={handleClose}>
          <FontAwesomeIcon icon={faTimes} />
        </button>

        {selectedTier === null && !isEditMode ? (
          <>
            <h2>Create a collection</h2>
            <p class="dialog-subtitle">
              Pick where your collection lives. Files stay in your storage; manifests load fast in the viewer.
            </p>

            <div class="storage-tiers">
              <TierCard
                type="local-folder"
                selected={false}
                onSelect={setSelectedTier}
                disabled={!localSupported}
              />
              <TierCard
                type="supabase-storage"
                selected={false}
                onSelect={setSelectedTier}
              />
              <TierCard
                type="public-url"
                selected={false}
                onSelect={setSelectedTier}
              />
            </div>

            <div class="form-divider" style={{ marginTop: '20px' }}>
              <span>Add Cloud GPU</span>
            </div>

            <div class="storage-tiers">
              <TierCard
                type="cloud-gpu"
                selected={false}
                onSelect={setSelectedTier}
              />
            </div>
          </>
        ) : selectedTier === 'local-folder' ? (
          <LocalFolderForm onConnect={handleConnect} onBack={handleBack} />
        ) : selectedTier === 'supabase-storage' ? (
          <SupabaseForm onConnect={handleConnect} onBack={handleBack} onClose={handleClose} />
        ) : selectedTier === 'public-url' ? (
          <UrlCollectionForm 
            onConnect={handleConnect} 
            onBack={handleBack}
            initialSource={isEditMode ? editSource : null}
            editMode={isEditMode}
            onSaveEdit={onEditComplete || onConnect}
          />
        ) : selectedTier === 'cloud-gpu' ? (
          <CloudGpuForm onBack={handleBack} />
        ) : null}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

export default ConnectStorageDialog;
