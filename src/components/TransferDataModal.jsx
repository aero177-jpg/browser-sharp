/**
 * Transfer data modal for exporting/importing settings and previews.
 * Multi-page flow: Landing → Export or Import
 */

import { useCallback, useRef, useState } from 'preact/hooks';
import { useStore } from '../store';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCheck,
  faChevronRight,
  faCloud,
  faCog,
  faDownload,
  faExclamationTriangle,
  faFolder,
  faImage,
  faLink,
  faServer,
  faSpinner,
  faUpload,
} from '@fortawesome/free-solid-svg-icons';
import { buildTransferBundle, importTransferBundle } from '../utils/debugTransfer.js';
import Modal from './Modal';

/**
 * Tier-style card for landing page options (Import / Export)
 */
function TransferTierCard({ type, icon, title, description, onSelect }) {
  return (
    <button
      class="storage-tier-card"
      onClick={() => onSelect(type)}
    >
      <div class="tier-icon">
        <FontAwesomeIcon icon={icon} />
      </div>
      <div class="tier-content">
        <div class="tier-header">
          <h4>{title}</h4>
        </div>
        <p class="tier-description">{description}</p>
      </div>
      <FontAwesomeIcon icon={faChevronRight} class="tier-arrow" />
    </button>
  );
}

/**
 * Checkbox-style option item for export selection
 */
function TransferOptionItem({ title, subtitle, icon, selected, onToggle, disabled }) {
  const disabledStyle = disabled
    ? {
        opacity: 0.55,
        cursor: 'not-allowed',
      }
    : {};

  const checkmarkStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    background: selected ? 'rgba(91, 178, 213, 0.87)' : 'rgba(255, 255, 255, 0.1)',
    border: selected ? 'none' : '1px solid rgba(255, 255, 255, 0.2)',
    color: selected ? '#000' : 'transparent',
    fontSize: '12px',
    flexShrink: 0,
    transition: 'all 0.15s ease',
  };

  const iconStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: selected ? 1 : 0.5,
    transition: 'opacity 0.15s ease',
  };

  const titleStyle = {
    marginBottom: '4px',
    opacity: selected ? 1 : 0.6,
    transition: 'opacity 0.15s ease',
  };

  return (
    <button
      class={`existing-collection-item ${selected ? 'selected' : ''}`}
      onClick={disabled ? undefined : onToggle}
      type="button"
      style={disabledStyle}
      disabled={disabled}
    >
      <div class="collection-info">
        <div class="collection-icon" style={iconStyle}>
          <FontAwesomeIcon icon={icon} style={{ fontSize: '18px' }} />
        </div>
        <div class="collection-details">
          <span class="collection-name" style={titleStyle}>
            {title}
          </span>
          {subtitle && <span class="collection-meta">{subtitle}</span>}
        </div>
      </div>
      <div style={checkmarkStyle}>
        <FontAwesomeIcon icon={faCheck} />
      </div>
    </button>
  );
}

/**
 * Export page with data selection options
 */
function ExportPage({ onBack, onClose, addLog }) {
  const [transferOptions, setTransferOptions] = useState({
    includeUrlCollections: true,
    includeCloudGpuSettings: true,
    includeSupabaseCollections: true,
    includeSupabaseSettings: true,
    includeR2Collections: true,
    includeR2Settings: true,
    includeFilePreviews: true,
    includeFileSettings: true,
  });
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState(null);
  const [exportSuccess, setExportSuccess] = useState(false);

  const hasTransferSelection = Object.values(transferOptions).some(Boolean);

  const toggleOption = useCallback((key) => () => {
    setTransferOptions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const downloadBlob = useCallback((blob, filename) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const handleExportTransfer = useCallback(async () => {
    if (!hasTransferSelection || transferBusy) return;
    setTransferBusy(true);
    setTransferError(null);
    setExportSuccess(false);
    try {
      const { blob, manifest } = await buildTransferBundle(transferOptions);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `radia-viewer-transfer-${stamp}.zip`;
      downloadBlob(blob, filename);
      const previewCount = manifest?.data?.previews?.length ?? 0;
      addLog?.(`[Debug] Transfer bundle exported (${previewCount} previews)`);
      setExportSuccess(true);
    } catch (err) {
      const message = err?.message || 'Export failed';
      setTransferError(message);
      addLog?.(`[Debug] Transfer export failed: ${message}`);
    } finally {
      setTransferBusy(false);
    }
  }, [addLog, downloadBlob, hasTransferSelection, transferBusy, transferOptions]);

  const options = [
    {
      key: 'includeUrlCollections',
      title: 'URL collections',
      subtitle: 'Saved URL sources and their metadata',
      icon: faLink,
    },
    {
      key: 'includeCloudGpuSettings',
      title: 'Cloud GPU settings',
      subtitle: 'API endpoint and key configuration',
      icon: faCloud,
    },
    {
      key: 'includeSupabaseCollections',
      title: 'Supabase collections',
      subtitle: 'Saved Supabase bucket connections',
      icon: faServer,
    },
    {
      key: 'includeSupabaseSettings',
      title: 'Supabase settings',
      subtitle: 'Per-file camera and display settings',
      icon: faCog,
    },
    {
      key: 'includeR2Collections',
      title: 'R2 collections',
      subtitle: 'Saved Cloudflare R2 bucket connections',
      icon: faServer,
    },
    {
      key: 'includeR2Settings',
      title: 'R2 settings',
      subtitle: 'Saved R2 credentials and public URL',
      icon: faCog,
    },
    {
      key: 'includeFilePreviews',
      title: 'File previews',
      subtitle: 'Thumbnail images for local files',
      icon: faImage,
    },
    {
      key: 'includeFileSettings',
      title: 'File settings',
      subtitle: 'Per-file camera and display settings',
      icon: faFolder,
    },
  ];

  return (
    <div class="storage-form">
      <button class="back-button" onClick={onBack}>
        Back
      </button>

      <h3>Export data</h3>
      <p class="dialog-subtitle">Select data to include in the export bundle.</p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          marginTop: '20px',
        }}
      >
        {options.map((opt) => (
          <TransferOptionItem
            key={opt.key}
            title={opt.title}
            subtitle={opt.subtitle}
            icon={opt.icon}
            selected={transferOptions[opt.key]}
            onToggle={toggleOption(opt.key)}
          />
        ))}
      </div>

      {transferError && (
        <div class="form-error" style={{ marginTop: '16px' }}>
          <FontAwesomeIcon icon={faExclamationTriangle} />
          {' '}{transferError}
        </div>
      )}

      {exportSuccess && (
        <div class="form-success" style={{ marginTop: '16px' }}>
          <FontAwesomeIcon icon={faCheck} />
          {' '}Export complete! Check your downloads folder.
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
          Cancel
        </button>
        <button
          class="primary-button"
          onClick={handleExportTransfer}
          disabled={!hasTransferSelection || transferBusy}
          style={{ height: '36px', padding: '0 16px', minWidth: '120px', fontSize: '14px' }}
        >
          {transferBusy ? (
            <>
              <FontAwesomeIcon icon={faSpinner} spin />
              {' '}Exporting...
            </>
          ) : (
            <>
              <FontAwesomeIcon icon={faDownload} />
              {' '}Export ZIP
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Import page with drag-and-drop zone
 */
function ImportPage({ onBack, onClose, addLog }) {
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
      <button class="back-button" onClick={onBack}>
        Back
      </button>

      <h3>Import data</h3>
      <p class="dialog-subtitle">
        Restore settings, collections, and previews from a transfer bundle.
      </p>

      <div class="form-info" style={{ marginTop: '16px' }}>
        <ul class="feature-list">
          <li><FontAwesomeIcon icon={faCheck} /> Merges data by file name</li>
          <li><FontAwesomeIcon icon={faCheck} /> Overwrites matching previews and settings</li>
          <li><FontAwesomeIcon icon={faCheck} /> Preserves existing data not in the bundle</li>
        </ul>
      </div>

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

/**
 * Main TransferDataModal component with multi-page flow
 */
function TransferDataModal({ isOpen, onClose, addLog }) {
  const [page, setPage] = useState(null); // null = landing, 'export', 'import'

  const handleClose = useCallback(() => {
    setPage(null);
    onClose();
  }, [onClose]);

  const handleBack = useCallback(() => {
    setPage(null);
  }, []);

  if (!isOpen) return null;

  let content;
  if (page === 'export') {
    content = <ExportPage onBack={handleBack} onClose={handleClose} addLog={addLog} />;
  } else if (page === 'import') {
    content = <ImportPage onBack={handleBack} onClose={handleClose} addLog={addLog} />;
  } else {
    // Landing page
    content = (
      <>
        <h2>Transfer data</h2>
        <p class="dialog-subtitle">
          Export settings and previews to share or backup, or import from a previous export.
        </p>

        <div class="storage-tiers" style={{ marginTop: '20px' }}>
          <TransferTierCard
            type="export"
            icon={faDownload}
            title="Export"
            description="Save collections, settings, and previews to a ZIP file"
            onSelect={setPage}
          />
          <TransferTierCard
            type="import"
            icon={faUpload}
            title="Import"
            description="Restore data from a previously exported ZIP bundle"
            onSelect={setPage}
          />
        </div>
      </>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth={460}
    >
      {content}
    </Modal>
  );
}

export default TransferDataModal;
