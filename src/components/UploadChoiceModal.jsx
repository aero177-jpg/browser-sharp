/**
 * Upload Choice Modal
 * Lets the user pick between image conversion and asset upload.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCloud,
  faCheck,
  faTimes,
  faUpload,
} from '@fortawesome/free-solid-svg-icons';
import { CubeIcon, ImageIcon } from '../icons/customIcons';
import { loadCloudGpuSettings } from '../storage/cloudGpuSettings.js';

function UploadOptionItem({ title, subtitle, icon: Icon, selected, onSelect, disabled }) {
  const selectedStyle = selected ? {
    borderColor: 'rgba(110, 231, 255, 0.4)',
    background: 'rgba(110, 231, 255, 0.1)',
    boxShadow: '0 0 0 1px rgba(110, 231, 255, 0.2), 0 0 15px rgba(110, 231, 255, 0.15)'
  } : {};
  const disabledStyle = disabled ? {
    opacity: 0.55,
    cursor: 'not-allowed',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    boxShadow: 'none'
  } : {};
  const combinedStyle = { ...selectedStyle, ...disabledStyle };

  return (
    <button
      class={`existing-collection-item ${selected ? 'selected' : ''}`}
      onClick={disabled ? undefined : onSelect}
      type="button"
      style={combinedStyle}
      disabled={disabled}
    >
      <div class="collection-info">
        {/* Reusing collection-icon class but centering the custom icon */}
        <div class="collection-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} />
        </div>
        <div class="collection-details">
          <span class="collection-name" style={{marginBottom: "4px"}}>{title}</span>
          <span class="collection-meta">{subtitle}</span>
        </div>
      </div>
      {selected && <FontAwesomeIcon icon={faCheck} className="collection-arrow" />}
    </button>
  );
}

function UploadChoiceModal({
  isOpen,
  onClose,
  onPickAssets,
  onPickImages,
  onOpenCloudGpu,
  imageExtensions = [],
  supportedExtensions = [],
}) {
  const [mode, setMode] = useState('assets'); // 'assets' | 'images'
  const cloudGpuSettings = useMemo(() => loadCloudGpuSettings(), [isOpen]);
  const isCloudGpuConfigured = Boolean(cloudGpuSettings?.apiUrl && cloudGpuSettings?.apiKey);

  useEffect(() => {
    if (!isCloudGpuConfigured && mode === 'images') {
      setMode('assets');
    }
  }, [isCloudGpuConfigured, mode]);

  if (!isOpen) return null;

  const handleUpload = () => {
    if (mode === 'images' && !isCloudGpuConfigured) return;
    if (mode === 'assets') {
      onPickAssets();
    } else if (mode === 'images') {
      onPickImages();
    }
  };

  const handleOpenCloudGpu = () => {
    onClose?.();
    onOpenCloudGpu?.();
  };

  return createPortal(
    <div class="modal-overlay storage-dialog-overlay">
      <div
        class="modal-content storage-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '420px' }}
      >
        <button class="modal-close" onClick={onClose}>
          <FontAwesomeIcon icon={faTimes} />
        </button>

        <h2>Upload to Supabase</h2>
        <p class="dialog-subtitle">
          Choose what you want to upload to this Supabase collection.
        </p>

        <div class="upload-options-list" style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <UploadOptionItem
            title="3dgs asset upload"
            subtitle={`Supported files:${supportedExtensions.join(', ')}`}
            icon={CubeIcon}
            selected={mode === 'assets'}
            onSelect={() => setMode('assets')}
          />
          <UploadOptionItem
            title="Images to convert"
            subtitle={`Image files: .jpg, .png, .webp, .heic, etc.`}
            icon={ImageIcon}
            selected={mode === 'images'}
            onSelect={() => setMode('images')}
            disabled={!isCloudGpuConfigured}
          />
        </div>

        <div class="form-info" style={{ marginTop: '16px' }}>
           {isCloudGpuConfigured ? (
             <p style={{ fontSize: '0.9em', color: 'var(--text-muted, #888)' }}>
               <FontAwesomeIcon icon={faCloud} style={{ marginRight: '6px' }} />
               Cloud GPU conversion is available for Supabase collections only.
             </p>
           ) : (
             <p style={{ fontSize: '0.9em', color: 'var(--text-muted, #888)' }}>
               <FontAwesomeIcon icon={faCloud} style={{ marginRight: '6px' }} />
               Cloud GPU is not configured.{' '}
               <button class="link-button" style={{marginTop: "12px"}} type="button" onClick={handleOpenCloudGpu}>
                 Configure Cloud GPU
               </button>
             </p>
           )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '24px' }}>
          <button
            class="secondary-button"
            onClick={onClose}
            style={{ height: '36px', padding: '0 16px', minWidth: '80px', marginTop: '0' }}
          >
            Cancel
          </button>
          <button
            class="primary-button"
            onClick={handleUpload}
            disabled={mode === 'images' && !isCloudGpuConfigured}
            style={{ height: '36px', padding: '0 16px' }}
          >
            <FontAwesomeIcon icon={faUpload} />
            {' '}Upload
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default UploadChoiceModal;
