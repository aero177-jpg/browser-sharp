import { useEffect, useState, useRef, useCallback } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import useSwipe from '../utils/useSwipe';
import { useStore } from '../store';
import { loadAssetByIndex, handleAddFiles } from '../fileLoader';
import { removeAsset, clearAssets, getAssetList, getCurrentAssetIndex } from '../assetManager';
import { deleteFileSettings, clearAllFileSettings } from '../fileStorage';
import { getFormatAccept } from '../formats/index';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { getSource } from '../storage/index.js';

function AssetSidebar() {
  const assets = useStore((state) => state.assets);
  const currentAssetIndex = useStore((state) => state.currentAssetIndex);
  const setAssets = useStore((state) => state.setAssets);
  const setCurrentAssetIndex = useStore((state) => state.setCurrentAssetIndex);

  const isVisible = useStore((state) => state.assetSidebarOpen);
  const setIsVisible = useStore((state) => state.setAssetSidebarOpen);
  const imageAccept = '.jpg,.jpeg,.png,.webp,.avif,.tif,.tiff,image/*';
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteScope, setDeleteScope] = useState('single'); // 'single' or 'all'
  const [clearMetadata, setClearMetadata] = useState(false);
  const sidebarRef = useRef(null);
  const fileInputRef = useRef(null);
  const hoverTargetRef = useRef(null);
  const openedByHoverRef = useRef(false);
  const hideTimeoutRef = useRef(null);

  const formatAccept = getFormatAccept();

  // Portal target for modal - render to fullscreen-safe container
  const [portalTarget, setPortalTarget] = useState(null);

  useEffect(() => {
    // Use viewer element if in fullscreen, otherwise document body
    const getPortalTarget = () => {
      const viewerEl = document.getElementById('viewer');
      return document.fullscreenElement === viewerEl ? viewerEl : document.body;
    };

    setPortalTarget(getPortalTarget());

    // Update portal target when fullscreen state changes
    const handleFullscreenChange = () => {
      setPortalTarget(getPortalTarget());
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Only show if we have multiple assets
  const hasMultipleAssets = assets.length > 1;

  const hideSidebar = useCallback(() => {
    setIsVisible(false);
  }, [setIsVisible]);

  const showSidebar = useCallback(() => {
    setIsVisible(true);
    openedByHoverRef.current = true;
  }, [setIsVisible]);

  // Sidebar visibility is manual only - no auto-open on navigation

  // Cleanup hide timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };
  }, []);

  // Click outside listener to close sidebar
  useEffect(() => {
    if (!isVisible || showDeleteModal) return;

    const handleClickOutside = (event) => {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target)) {
        hideSidebar();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isVisible, hideSidebar, showDeleteModal]);

  const handleAddClick = () => {
    const current = assets[currentAssetIndex];
    const isSupabase = current?.sourceType === 'supabase-storage';
    console.log('[AssetSidebar] Add clicked. Supabase collection?', isSupabase, 'sourceId:', current?.sourceId);
    fileInputRef.current?.click();
    openedByHoverRef.current = false; // opened by explicit click
  };

  const handleFileChange = async (event) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      await handleAddFiles(Array.from(files));
      event.target.value = '';
    }
  };

  const handleDeleteClick = () => {
    setDeleteScope('single');
    setClearMetadata(false);
    setShowDeleteModal(true);
    openedByHoverRef.current = false; // explicit action
  };

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimeout();
    hideTimeoutRef.current = setTimeout(() => {
      if (openedByHoverRef.current) {
        setIsVisible(false);
      }
      hideTimeoutRef.current = null;
    }, 500);
  }, [clearHideTimeout]);

  const syncAssets = () => {
    const newAssets = getAssetList();
    const newIndex = getCurrentAssetIndex();
    setAssets([...newAssets]);
    setCurrentAssetIndex(newIndex);
    
    if (newAssets.length > 0) {
        loadAssetByIndex(newIndex);
    } else {
        window.location.reload();
    }
  };

  const confirmDelete = async () => {
    if (deleteScope === 'single') {
      const asset = assets[currentAssetIndex];
      if (clearMetadata && asset) {
        await deleteFileSettings(asset.name);
      }
      removeAsset(currentAssetIndex);
    } else {
      if (clearMetadata) {
        await clearAllFileSettings();
      }
      clearAssets();
    }
    
    syncAssets();
    setShowDeleteModal(false);
  };

  if (assets.length === 0) return null;

  // Swipe-right gesture for mobile
  useSwipe(hoverTargetRef, {
    direction: 'horizontal',
    threshold: 60,
    allowCross: 80,
    onSwipe: ({ dir }) => {
      if (dir === 'right') showSidebar();
    }
  });

  return (
    <>
      <input 
        ref={fileInputRef}
        type="file" 
        accept={`${formatAccept},${imageAccept}`} 
        multiple 
        hidden 
        onChange={handleFileChange}
      />

      {/* Invisible hover target on left edge */}
      <div 
        ref={hoverTargetRef}
        class="sidebar-hover-target"
        onMouseEnter={showSidebar}
      />

      {/* Trigger Button moved to App.jsx - bottom controls container */}

      {/* Sidebar */}
      <div 
        ref={sidebarRef}
        class={`asset-sidebar ${isVisible ? 'visible' : ''}`}
        onMouseEnter={clearHideTimeout}
        onMouseLeave={scheduleHide}
      >
        <div class="asset-list-vertical">
          {assets.map((asset, index) => (
            <button
              key={asset.id || index}
              class={`asset-item-vertical ${index === currentAssetIndex ? 'active' : ''}`}
              title={asset.name}
              onClick={() => loadAssetByIndex(index)}
            >
              <div class={`asset-preview ${asset.preview ? '' : 'loading'}`}>
                {asset.preview ? (
                  <img src={asset.preview} alt={asset.name} loading="lazy" />
                ) : (
                  <div class="preview-spinner" />
                )}
              </div>
            </button>
          ))}
        </div>
        <div class="sidebar-footer">
          <div class="sidebar-controls">
    <button 
              class="sidebar-btn add" 
              onClick={handleAddClick}
              title="Add files"
            >
              <FontAwesomeIcon icon={faPlus} />
            </button>
      
            <button 
              class="sidebar-btn delete" 
              onClick={handleDeleteClick}
              title="Remove asset(s)"
            >
              <FontAwesomeIcon icon={faTrash} />
            </button>
          </div>
        </div>
      </div>

      {/* Delete Modal - rendered via portal for fullscreen compatibility */}
      {showDeleteModal && portalTarget && createPortal(
        <div class="modal-overlay">
          <div class="modal-content">
            <h3>Remove Image</h3>
            {(() => {
              const asset = assets[currentAssetIndex];
              const sourceType = asset?.sourceType;
              const isCollection = !!asset?.sourceId;
              const source = asset?.sourceId ? getSource(asset.sourceId) : null;
              const isLocalCollection = sourceType === 'local-folder';
              const isUrlCollection = sourceType === 'public-url';
              const isSupabase = sourceType === 'supabase-storage';

              if (!isCollection) {
                return null; // plain queue, no source note
              }

              if (isLocalCollection) {
                return (
                  <p class="modal-note">
                    Removing here only clears it from the app; delete the file in the folder to remove it on your device.
                  </p>
                );
              }

              if (isUrlCollection) {
                return (
                  <p class="modal-note">
                    This only removes the link from the collection; the original URL/file stays online.
                  </p>
                );
              }

              if (isSupabase) {
                // Supabase messaging will be handled separately per request
                return (
                  <p class="modal-note">
                    Removing here only clears it from the app; file remains in the Supabase collection.
                  </p>
                );
              }

              // Fallback
              return (
                <p class="modal-note">
                  Removing here only clears it from the app; the source is unchanged.
                </p>
              );
            })()}
            
            <div class="modal-options">
              <label class="radio-option">
                <input 
                  type="radio" 
                  name="deleteScope" 
                  value="single" 
                  checked={deleteScope === 'single'}
                  onChange={(e) => setDeleteScope(e.target.value)}
                />
                Remove image from queue 
              </label>
              
              <label class="radio-option">
                <input 
                  type="radio" 
                  name="deleteScope" 
                  value="all" 
                  checked={deleteScope === 'all'}
                  onChange={(e) => setDeleteScope(e.target.value)}
                />
                Remove all images from queue
              </label>
            </div>

            <div class="modal-checkbox">
              <label>
                <input 
                  type="checkbox" 
                  checked={clearMetadata}
                  onChange={(e) => setClearMetadata(e.target.checked)}
                />
                Clear stored metadata
              </label>
              <div class="modal-subnote">
                Keeping metadata preserves image previews and camera settings, so re-adding the image restores them.
              </div>
            </div>

            <div class="modal-actions">
              <button onClick={() => setShowDeleteModal(false)}>Cancel</button>
              <button class="danger" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>,
        portalTarget
      )}
    </>
  );
}

export default AssetSidebar;
