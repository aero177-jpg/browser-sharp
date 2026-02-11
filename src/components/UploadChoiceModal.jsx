/**
 * Upload Choice Modal
 * Lets the user pick between image conversion and asset upload.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCloud,
  faCheck,
  faUpload,
} from '@fortawesome/free-solid-svg-icons';
import { CubeIcon, ImageIcon } from '../icons/customIcons';
import { loadCloudGpuSettings } from '../storage/cloudGpuSettings.js';
import Modal from './Modal';

function UploadOptionItem({ title, subtitle, icon: Icon, selected, onSelect, onConfirm, disabled }) {
  const selectedStyle = selected ? {
    borderColor: '#63828866',
    background: '#253039',
    boxShadow: 'rgba(110, 231, 255, 0.2) 0px 0px 0px 0px, rgba(132, 198, 203, 0.15) 0 0 8px',
  } : {};
  const disabledStyle = disabled ? {
    opacity: 0.55,
    cursor: 'not-allowed',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    boxShadow: 'none'
  } : {};
  const combinedStyle = { ...selectedStyle, ...disabledStyle };

  const handleClick = () => {
    if (disabled) return;
    if (selected) {
      onConfirm?.();
      return;
    }
    onSelect?.();
  };

  return (
    <button
      class={`existing-collection-item ${selected ? 'selected' : ''}`}
      onClick={handleClick}
      type="button"
      style={combinedStyle}
      disabled={disabled}
    >
      <div class="collection-info">
        {/* Reusing collection-icon class but centering the custom icon */}
        <div class="collection-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} color={selected ? undefined : "#5e707cb2"} />
        </div>
        <div class="collection-details">
          <span class="collection-name" style={{marginBottom: "4px"}}>{title}</span>
          <span class="collection-meta">{subtitle}</span>
        </div>
      </div>
      <FontAwesomeIcon
        icon={faCheck}
        className="collection-arrow"
        style={{ opacity: selected ? 1 : 0 }}
      />
    </button>
  );
}

function UploadChoiceModal({
  isOpen,
  onClose,
  onPickAssets,
  onPickImages,
  onOpenCloudGpu,
  supportedExtensions = [],
  title = 'Upload files',
  subtitle = 'Choose what you want to upload.',
  assetTitle = '3dgs asset upload',
  assetSubtitle,
  imageTitle = 'Images to convert',
  imageSubtitle,
  note = '',
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
    >
      <h2>{title}</h2>
      <p class="dialog-subtitle">{subtitle}</p>

      <div class="upload-options-list" style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <UploadOptionItem
          title={assetTitle}
          subtitle={assetSubtitle || `Supported files:${supportedExtensions.join(', ')}`}
          icon={CubeIcon}
          selected={mode === 'assets'}
          onSelect={() => setMode('assets')}
          onConfirm={handleUpload}
        />
        <UploadOptionItem
          title={imageTitle}
          subtitle={imageSubtitle || 'Image files: .jpg, .png, .webp, .heic, etc.'}
          icon={ImageIcon}
          selected={mode === 'images'}
          onSelect={() => setMode('images')}
          onConfirm={handleUpload}
          disabled={!isCloudGpuConfigured}
        />
      </div>

      <div class="form-info" style={{ marginTop: '16px' }}>
         {!isCloudGpuConfigured &&
           <p style={{ fontSize: '0.9em', color: 'var(--text-muted, #888)' }}>
             <FontAwesomeIcon icon={faCloud} style={{ marginRight: '6px' }} />
             Cloud GPU is not configured.{' '}
             {onOpenCloudGpu && (
               <button class="link-button" style={{ marginTop: '12px' }} type="button" onClick={handleOpenCloudGpu}>
                 Configure Cloud GPU
               </button>
             )}
           </p>
         }
      </div>

      {note && (
        <p class="dialog-subtitle" style={{ marginTop: '12px', color: 'var(--text-muted, #888)' }}>
          {note}
        </p>
      )}

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
          {' '}browse files
        </button>
      </div>
    </Modal>
  );
}

export default UploadChoiceModal;
