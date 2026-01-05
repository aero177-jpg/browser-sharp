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

function AssetSidebar() {
  const assets = useStore((state) => state.assets);
  const currentAssetIndex = useStore((state) => state.currentAssetIndex);
  const setAssets = useStore((state) => state.setAssets);
  const setCurrentAssetIndex = useStore((state) => state.setCurrentAssetIndex);

  const [isVisible, setIsVisible] = useState(false);
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
  }, []);

  const showSidebar = useCallback(() => {
    setIsVisible(true);
    openedByHoverRef.current = true;
  }, []);

  // Show on index change (navigation)
  useEffect(() => {
    if (hasMultipleAssets) {
      showSidebar();
    }
  }, [currentAssetIndex, hasMultipleAssets, showSidebar]);

  // No hide timer: sidebar visibility is manual or based on navigation

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
        accept={formatAccept} 
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

      {/* Trigger Button (Index indicator) - Visible when sidebar is hidden */}
      <button 
        class={`sidebar-trigger-btn left${isVisible ? ' hidden' : ''}`}
        onClick={showSidebar}
        title="Open asset browser"
      >
        {currentAssetIndex + 1} / {assets.length}
      </button>

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
              title="Delete asset"
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
            <h3>Delete Asset</h3>
            
            <div class="modal-options">
              <label class="radio-option">
                <input 
                  type="radio" 
                  name="deleteScope" 
                  value="single" 
                  checked={deleteScope === 'single'}
                  onChange={(e) => setDeleteScope(e.target.value)}
                />
                Delete this image
              </label>
              
              <label class="radio-option">
                <input 
                  type="radio" 
                  name="deleteScope" 
                  value="all" 
                  checked={deleteScope === 'all'}
                  onChange={(e) => setDeleteScope(e.target.value)}
                />
                Delete all images
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
