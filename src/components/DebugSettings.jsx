/**
 * Debug settings dropdown for the side panel.
 * Hosts FPS overlay toggle, mobile devtools toggle, and a DB wipe action.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { useStore } from '../store';
import { captureCurrentAssetPreview, getAssetList, getCurrentAssetIndex } from '../assetManager';
import { savePreviewBlob } from '../fileStorage';
import { clearSupabaseManifestCache } from '../storage/supabaseSettings.js';
import { generateAllPreviews, abortBatchPreview } from '../batchPreview';
import { setDebugForceZoomOut } from '../fileLoader';

let erudaInitPromise = null;

/** Lazily load and enable Eruda devtools */
const enableMobileDevtools = async () => {
  if (typeof window === 'undefined') return false;

  if (window.eruda) {
    window.eruda.show?.();
    return true;
  }

  if (!erudaInitPromise) {
    erudaInitPromise = import('eruda')
      .then(({ default: erudaLib }) =>
        import('eruda-indexeddb').then(({ default: erudaIndexedDB }) => {
          erudaLib.init();
          erudaLib.add(erudaIndexedDB);
          return erudaLib;
        })
      )
      .catch((err) => {
        erudaInitPromise = null;
        throw err;
      });
  }

  await erudaInitPromise;
  return true;
};

/** Tear down Eruda devtools if present */
const disableMobileDevtools = () => {
  const instance = typeof window !== 'undefined' ? window.eruda : null;
  if (instance?.hide) instance.hide();
  if (instance?.destroy) instance.destroy();
  if (typeof window !== 'undefined') {
    // Ensure any leftover DOM is removed
    const erudaRoot = document.getElementById('eruda');
    if (erudaRoot?.parentNode) {
      erudaRoot.parentNode.removeChild(erudaRoot);
    }
    if (window.eruda) {
      delete window.eruda;
    }
  }
};

function DebugSettings() {
  const showFps = useStore((state) => state.showFps);
  const setShowFps = useStore((state) => state.setShowFps);
  const mobileDevtoolsEnabled = useStore((state) => state.mobileDevtoolsEnabled);
  const setMobileDevtoolsEnabled = useStore((state) => state.setMobileDevtoolsEnabled);
  const debugSettingsExpanded = useStore((state) => state.debugSettingsExpanded);
  const toggleDebugSettingsExpanded = useStore((state) => state.toggleDebugSettingsExpanded);
  const updateAssetPreview = useStore((state) => state.updateAssetPreview);
  const setAssets = useStore((state) => state.setAssets);
  const setCurrentAssetIndex = useStore((state) => state.setCurrentAssetIndex);
  const addLog = useStore((state) => state.addLog);
  const bgBlur = useStore((state) => state.bgBlur);
  const setBgBlur = useStore((state) => state.setBgBlur);
  const devtoolsUserApprovedRef = useRef(false);

  const [wipingDb, setWipingDb] = useState(false);
  const [clearingSupabaseCache, setClearingSupabaseCache] = useState(false);
  const [generatingPreview, setGeneratingPreview] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null); // { current, total, name }
  const [generatingBatch, setGeneratingBatch] = useState(false);
  const [debugZoomOut, setDebugZoomOut] = useState(false);

  const refreshAssets = useCallback(() => {
    const assets = getAssetList();
    const idx = getCurrentAssetIndex();
    setAssets([...assets]);
    setCurrentAssetIndex(idx);
  }, [setAssets, setCurrentAssetIndex]);

  /** Toggle FPS overlay visibility */
  const handleFpsToggle = useCallback((e) => {
    const enabled = Boolean(e.target.checked);
    setShowFps(enabled);
    const el = document.getElementById('fps-counter');
    if (el) el.style.display = enabled ? 'block' : 'none';
  }, [setShowFps]);

  /** Enable/disable mobile devtools (Eruda) */
  const handleDevtoolsToggle = useCallback((e) => {
    const enabled = Boolean(e.target.checked);
    // mark that the user explicitly approved initialization for this session
    devtoolsUserApprovedRef.current = true;
    setMobileDevtoolsEnabled(enabled);
    if (!enabled) {
      // immediate teardown so the UI responds without waiting on effects
      disableMobileDevtools();
    }
  }, [setMobileDevtoolsEnabled]);

  /** Wipes IndexedDB image store and reloads */
  const handleWipeDb = useCallback(async () => {
    const confirmed = window.confirm('Wipe IndexedDB "radia-viewer-storage"? This cannot be undone.');
    if (!confirmed) return;

    setWipingDb(true);
    try {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('radia-viewer-storage');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('Failed to delete database'));
        request.onblocked = () => console.warn('Delete blocked: close other tabs or reopen the app.');
      });
      alert('IndexedDB radia-viewer-storage wiped. Reloading...');
      window.location.reload();
    } catch (err) {
      console.error('DB wipe failed:', err);
      alert(err?.message || 'Failed to wipe DB');
    } finally {
      setWipingDb(false);
    }
  }, []);

  /** Clears local Supabase manifest cache */
  const handleClearSupabaseCache = useCallback(async () => {
    const confirmed = window.confirm('Clear cached Supabase manifest data?');
    if (!confirmed) return;

    setClearingSupabaseCache(true);
    try {
      clearSupabaseManifestCache();
      addLog('[Debug] Cleared Supabase manifest cache');
    } catch (err) {
      console.error('[Debug] Supabase cache clear failed:', err);
      addLog(`[Debug] Supabase cache clear failed: ${err.message}`);
    } finally {
      setClearingSupabaseCache(false);
    }
  }, [addLog]);

  /** Debug: force regenerate preview for current asset */
  const handleRegeneratePreview = useCallback(async () => {
    setGeneratingPreview(true);
    try {
      const currentIndex = getCurrentAssetIndex();
      const assetList = getAssetList();
      const asset = assetList[currentIndex];
      
      if (!asset) {
        addLog('[Debug] No current asset to capture preview for');
        return;
      }
      
      addLog(`[Debug] Capturing preview for asset index ${currentIndex}: ${asset.name}`);
      console.log('[Debug] Asset before capture:', { 
        id: asset.id, 
        name: asset.name, 
        preview: asset.preview,
        previewSource: asset.previewSource 
      });
      
      const result = await captureCurrentAssetPreview();
      
      console.log('[Debug] Capture result:', result);
      console.log('[Debug] Asset after capture:', { 
        id: asset.id, 
        name: asset.name, 
        preview: asset.preview,
        previewSource: asset.previewSource 
      });
      
      if (result?.url) {
        addLog(`[Debug] Preview captured: ${result.url.substring(0, 50)}...`);
        
        // Force update the store directly
        console.log('[Debug] Calling updateAssetPreview with index:', currentIndex, 'preview:', asset.preview);
        updateAssetPreview(currentIndex, asset.preview);
        refreshAssets();
        
        // Also save to IndexedDB
        if (result.blob) {
          await savePreviewBlob(asset.name, result.blob, {
            width: result.width,
            height: result.height,
            format: result.format,
          });
          addLog(`[Debug] Preview saved to IndexedDB`);
        }
      } else {
        addLog('[Debug] Preview capture returned no result');
      }
    } catch (err) {
      console.error('[Debug] Preview regeneration failed:', err);
      addLog(`[Debug] Preview failed: ${err.message}`);
    } finally {
      setGeneratingPreview(false);
    }
  }, [addLog, updateAssetPreview]);

  /** Generate previews for all assets in batch mode */
  const handleGenerateAllPreviews = useCallback(async () => {
    const assetList = getAssetList();
    if (assetList.length === 0) {
      addLog('[BatchPreview] No assets loaded');
      return;
    }

    const confirmed = window.confirm(
      `Generate previews for all ${assetList.length} assets?\n\n` +
      `This will rapidly load each asset without animations and capture a preview image. ` +
      `The UI will be hidden during generation.`
    );
    if (!confirmed) return;

    setGeneratingBatch(true);
    setBatchProgress({ current: 0, total: assetList.length, name: '' });

    try {
      await generateAllPreviews({
        onProgress: (current, total, name) => {
          setBatchProgress({ current, total, name });
        },
        onComplete: (success, failed) => {
          addLog(`[BatchPreview] Done: ${success} succeeded, ${failed} failed`);
        },
      });
    } catch (err) {
      console.error('[BatchPreview] Error:', err);
      addLog(`[BatchPreview] Error: ${err.message}`);
    } finally {
      setGeneratingBatch(false);
      setBatchProgress(null);
      refreshAssets();
    }
  }, [addLog, refreshAssets]);

  /** Abort batch preview generation */
  const handleAbortBatchPreview = useCallback(() => {
    abortBatchPreview();
    addLog('[BatchPreview] Abort requested');
  }, [addLog]);

  // React to devtools preference changes — require explicit user approval to initialize
  useEffect(() => {
    if (mobileDevtoolsEnabled) {
      if (!devtoolsUserApprovedRef.current) {
        // persisted preference exists but user has not re-approved in this session;
        // do not auto-initialize Eruda to avoid surprises.
        console.info('[Devtools] Initialization deferred: user approval required (toggle to initialize).');
        return;
      }
      enableMobileDevtools().catch((err) => {
        console.warn('[Devtools] Failed to enable:', err);
        setMobileDevtoolsEnabled(false);
      });
    } else {
      disableMobileDevtools();
    }
  }, [mobileDevtoolsEnabled, setMobileDevtoolsEnabled]);

  return (
    <div class="settings-group">
      <button
        class="group-toggle"
        aria-expanded={debugSettingsExpanded}
        onClick={toggleDebugSettingsExpanded}
      >
        <span class="settings-eyebrow">Debug Settings</span>
        <FontAwesomeIcon icon={faChevronDown} className="chevron" />
      </button>

      <div
        class="group-content"
        style={{ display: debugSettingsExpanded ? 'flex' : 'none' }}
      >
        <div class="control-row">
          <span class="control-label">Show FPS</span>
          <label class="switch">
            <input
              type="checkbox"
              checked={showFps}
              onChange={handleFpsToggle}
            />
            <span class="switch-track" aria-hidden="true" />
          </label>
        </div>

        <div class="control-row">
          <span class="control-label">Mobile devtools</span>
          <label class="switch">
            <input
              type="checkbox"
              checked={mobileDevtoolsEnabled}
              onChange={handleDevtoolsToggle}
            />
            <span class="switch-track" aria-hidden="true" />
          </label>
        </div>

        <div class="control-row">
          <span class="control-label">Delete image store</span>
          <button
            type="button"
            class={`secondary danger ${wipingDb ? 'is-busy' : ''}`}
            onClick={handleWipeDb}
            disabled={wipingDb}
          >
            {wipingDb ? 'Deleting...' : 'Delete'}
          </button>
        </div>

        <div class="control-row">
          <span class="control-label">Clear Supabase cache</span>
          <button
            type="button"
            class={`secondary ${clearingSupabaseCache ? 'is-busy' : ''}`}
            onClick={handleClearSupabaseCache}
            disabled={clearingSupabaseCache}
          >
            {clearingSupabaseCache ? 'Clearing...' : 'Clear'}
          </button>
        </div>

        <div class="control-row">
          <span class="control-label">Regen preview</span>
          <button
            type="button"
            class={`secondary ${generatingPreview ? 'is-busy' : ''}`}
            onClick={handleRegeneratePreview}
            disabled={generatingPreview}
          >
            {generatingPreview ? 'Capturing...' : 'Capture'}
          </button>
        </div>

        <div class="control-row">
          <span class="control-label">Debug zoom-out</span>
          <label class="switch">
            <input
              type="checkbox"
              checked={debugZoomOut}
              onChange={(e) => {
                const enabled = Boolean(e.target.checked);
                setDebugZoomOut(enabled);
                setDebugForceZoomOut(enabled);
              }}
            />
            <span class="switch-track" aria-hidden="true" />
          </label>
        </div>

        <div class="control-row">
          <span class="control-label">Image glow</span>
          <div class="control-track">
            <input
              type="range"
              min="0"
              max="40"
              step="1"
              value={bgBlur}
              onInput={(e) => setBgBlur(Number(e.target.value) || 0)}
            />
            <span class="control-value">{bgBlur}px</span>
          </div>
        </div>

        <div class="control-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span class="control-label">Batch previews</span>
            {generatingBatch ? (
              <button
                type="button"
                class="secondary danger"
                onClick={handleAbortBatchPreview}
              >
                Abort
              </button>
            ) : (
              <button
                type="button"
                class="secondary"
                onClick={handleGenerateAllPreviews}
              >
                Generate All
              </button>
            )}
          </div>
          {batchProgress && (
            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
              <div style={{ marginBottom: '4px' }}>
                {batchProgress.current}/{batchProgress.total}: {batchProgress.name}
              </div>
              <div
                style={{
                  height: '4px',
                  background: 'var(--color-bg-tertiary)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${(batchProgress.current / batchProgress.total) * 100}%`,
                    background: 'var(--color-accent)',
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DebugSettings;
