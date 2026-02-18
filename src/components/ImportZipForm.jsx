import { useCallback, useRef, useState } from 'preact/hooks';
import { useStore } from '../store';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCheck,
  faExclamationTriangle,
  faSpinner,
  faUpload,
} from '@fortawesome/free-solid-svg-icons';
import { importTransferBundle } from '../utils/debugTransfer.js';

const DEFAULT_FEATURES = [
  'Merges data by file name',
  'Overwrites matching previews and settings',
  'Preserves existing data not in the bundle',
];

function ImportZipForm({
  onBack,
  onClose,
  addLog,
  title = 'Import data',
  subtitle = 'Restore settings, collections, and previews from a transfer bundle.',
  featureItems = DEFAULT_FEATURES,
}) {
  const isMobile = useStore((state) => state.isMobile);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState(null);
  const [importSuccess, setImportSuccess] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const processFile = useCallback(
    async (file) => {
      if (!file) return;
      setImportBusy(true);
      setImportError(null);
      setImportSuccess(null);
      try {
        const { summary } = await importTransferBundle(file);
        const message =
          `Import complete: ${summary.sourcesImported} sources, ` +
          `${summary.fileSettingsImported} settings, ${summary.previewsImported} previews`;
        addLog?.(`[Debug] ${message}`);
        if (summary.warnings?.length) {
          addLog?.(`[Debug] Transfer import warnings: ${summary.warnings.join(' | ')}`);
        }
        setImportSuccess(message);
      } catch (err) {
        const message = err?.message || 'Import failed';
        setImportError(message);
        addLog?.(`[Debug] Transfer import failed: ${message}`);
      } finally {
        setImportBusy(false);
      }
    },
    [addLog]
  );

  const handleFileChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      processFile(file);
    },
    [processFile]
  );

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file && (file.name.endsWith('.zip') || file.type === 'application/zip')) {
        processFile(file);
      } else {
        setImportError('Please drop a .zip file');
      }
    },
    [processFile]
  );

  const dropZoneStyle = {
    border: `2px dashed ${isDragging ? 'rgba(110, 231, 255, 0.8)' : 'rgba(255, 255, 255, 0.2)'}`,
    borderRadius: '12px',
    padding: '32px 24px',
    textAlign: 'center',
    background: isDragging ? 'rgba(110, 231, 255, 0.05)' : 'rgba(255, 255, 255, 0.02)',
    transition: 'all 0.2s ease',
    marginTop: '20px',
  };

  return (
    <div class="storage-form">
      {typeof onBack === 'function' && (
        <button class="back-button" onClick={onBack}>
          Back
        </button>
      )}

      <h3>{title}</h3>
      <p class="dialog-subtitle" style={{ marginBottom: '12px' }}>
        {subtitle}
      </p>

      <ul class="feature-list bullet-list">
        {featureItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      {!isMobile && (
        <div
          style={dropZoneStyle}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {importBusy ? (
            <>
              <FontAwesomeIcon
                icon={faSpinner}
                spin
                style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.6 }}
              />
              <p style={{ margin: 0, opacity: 0.8 }}>Importing...</p>
            </>
          ) : (
            <>
              <FontAwesomeIcon
                icon={faUpload}
                style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.5 }}
              />
              <p style={{ margin: '0 0 12px 0', opacity: 0.8 }}>
                Drag and drop a .zip file here
              </p>
              <button
                class="secondary-button"
                onClick={handleBrowseClick}
                style={{ height: '36px', padding: '0 20px' }}
              >
                Browse files
              </button>
            </>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {importError && (
        <div class="form-error" style={{ marginTop: '16px' }}>
          <FontAwesomeIcon icon={faExclamationTriangle} />
          {' '}{importError}
        </div>
      )}

      {importSuccess && (
        <div class="form-success" style={{ marginTop: '16px' }}>
          <FontAwesomeIcon icon={faCheck} />
          {' '}{importSuccess}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '8px',
          marginTop: '24px',
        }}
      >
        <button
          class="secondary-button"
          onClick={onClose}
          style={{ height: '36px', padding: '0 16px', minWidth: '80px', marginTop: 0 }}
        >
          {importSuccess ? 'Done' : 'Cancel'}
        </button>
        {isMobile && (
          <button
            class="primary-button"
            onClick={handleBrowseClick}
            disabled={importBusy}
            style={{ height: '36px', padding: '0 16px', minWidth: '120px' }}
          >
            {importBusy ? (
              <>
                <FontAwesomeIcon icon={faSpinner} spin />
                {' '}Importing...
              </>
            ) : (
              <>
                <FontAwesomeIcon icon={faUpload} />
                {' '}Browse files
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default ImportZipForm;