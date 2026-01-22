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
import { setDebugForceZoomOut, reloadCurrentAsset, resize } from '../fileLoader';
import { clearCustomMetadataForAsset } from '../customMetadata.js';
import { requestRender, setStereoEffectEnabled } from '../viewer';

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
  const debugStochasticRendering = useStore((state) => state.debugStochasticRendering);
  const setDebugStochasticRendering = useStore((state) => state.setDebugStochasticRendering);
  const debugFpsLimitEnabled = useStore((state) => state.debugFpsLimitEnabled);
  const setDebugFpsLimitEnabled = useStore((state) => state.setDebugFpsLimitEnabled);
  const debugSparkMaxStdDev = useStore((state) => state.debugSparkMaxStdDev);
  const setDebugSparkMaxStdDev = useStore((state) => state.setDebugSparkMaxStdDev);
  const setQualityPreset = useStore((state) => state.setQualityPreset);
  const customMetadataAvailable = useStore((state) => state.customMetadataAvailable);
  const setCustomMetadataAvailable = useStore((state) => state.setCustomMetadataAvailable);
  const setCustomMetadataControlsVisible = useStore((state) => state.setCustomMetadataControlsVisible);
  const stereoEnabled = useStore((state) => state.stereoEnabled);
  const setStereoEnabled = useStore((state) => state.setStereoEnabled);
  const devtoolsUserApprovedRef = useRef(false);

  const {
    currentAssetName,
    currentAssetHasCustomMetadata,
    setCurrentAssetHasCustomMetadata,
    resetCustomMetadataState,
  } = useStore();

  const [wipingDb, setWipingDb] = useState(false);
  const [clearingSupabaseCache, setClearingSupabaseCache] = useState(false);
  const [generatingPreview, setGeneratingPreview] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null); // { current, total, name }
  const [generatingBatch, setGeneratingBatch] = useState(false);
  const [debugZoomOut, setDebugZoomOut] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

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

  /** Toggle stochastic rendering */
  const handleStochasticToggle = useCallback((e) => {
    const enabled = Boolean(e.target.checked);
    setQualityPreset('debug-custom');
    setDebugStochasticRendering(enabled);
  }, [setDebugStochasticRendering, setQualityPreset]);

  /** Toggle FPS limiting */
  const handleFpsLimitToggle = useCallback((e) => {
    const enabled = Boolean(e.target.checked);
    setQualityPreset('debug-custom');
    setDebugFpsLimitEnabled(enabled);
  }, [setDebugFpsLimitEnabled, setQualityPreset]);

  /** Force viewer refresh for fullscreen resize debugging */
  const handleForceViewerRefresh = useCallback(async () => {
    resize();
    requestRender();
    addLog('Forced viewer refresh (resize + render)');
  }, [addLog]);

  /** Toggle side-by-side stereo effect; enter fullscreen when enabling */
  const handleStereoToggle = useCallback(async (e) => {
    const enabled = e.target.checked;
    const fullscreenRoot = document.getElementById('app');
    if (!fullscreenRoot) return;

    try {
      if (enabled) {
        // Hide background images when entering stereo mode
        const bgContainers = document.querySelectorAll('.bg-image-container');
        bgContainers.forEach(el => el.classList.add('stereo-hidden'));

        if (document.fullscreenElement !== fullscreenRoot) {
          await fullscreenRoot.requestFullscreen();
        }
        setStereoEffectEnabled(true);
        setStereoEnabled(true);
        resize();
        addLog('Side-by-side stereo enabled');
      } else {
        // Restore background images when exiting stereo mode
        const bgContainers = document.querySelectorAll('.bg-image-container');
        bgContainers.forEach(el => el.classList.remove('stereo-hidden'));

        setStereoEffectEnabled(false);
        setStereoEnabled(false);
        requestRender();
        if (document.fullscreenElement === fullscreenRoot) {
          await document.exitFullscreen();
        }
        resize();
        addLog('Stereo mode disabled');
      }
    } catch (err) {
      // Restore background images on error
      const bgContainers = document.querySelectorAll('.bg-image-container');
      bgContainers.forEach(el => el.classList.remove('stereo-hidden'));

      setStereoEffectEnabled(false);
      setStereoEnabled(false);
      e.target.checked = false;
      addLog('Stereo toggle failed');
      console.warn('Stereo toggle failed:', err);
    }
  }, [setStereoEnabled, addLog]);

  const handleSparkStdDevChange = useCallback((e) => {
    const value = Number(e.target.value);
    setQualityPreset('debug-custom');
    setDebugSparkMaxStdDev(Number.isFinite(value) ? value : Math.sqrt(5));
  }, [setDebugSparkMaxStdDev, setQualityPreset]);

  const handleClearCustomMetadata = useCallback(async () => {
    if (!currentAssetName || isClearing) return;
    
    setIsClearing(true);
    try {
      await clearCustomMetadataForAsset(currentAssetName);
      setCurrentAssetHasCustomMetadata(false);
      resetCustomMetadataState();
      console.log(`Cleared custom metadata for ${currentAssetName}`);
    } catch (err) {
      console.error("Failed to clear custom metadata:", err);
    } finally {
      setIsClearing(false);
    }
  }, [currentAssetName, isClearing, setCurrentAssetHasCustomMetadata, resetCustomMetadataState]);

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

  // If fullscreen is exited while stereo is on, disable stereo to avoid misalignment
  useEffect(() => {
    const handleFsChange = () => {
      const fullscreenRoot = document.getElementById('app');
      const inFullscreen = document.fullscreenElement === fullscreenRoot;
      if (stereoEnabled && !inFullscreen) {
        // Restore background images on exit
        const bgContainers = document.querySelectorAll('.bg-image-container');
        bgContainers.forEach(el => el.classList.remove('stereo-hidden'));
        setStereoEffectEnabled(false);
        setStereoEnabled(false);
        requestRender();
        resize();
      }
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, [stereoEnabled, setStereoEnabled]);

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
          <span class="control-label">Stochastic rendering</span>
          <label class="switch">
            <input
              type="checkbox"
              checked={debugStochasticRendering}
              onChange={handleStochasticToggle}
            />
            <span class="switch-track" aria-hidden="true" />
          </label>
        </div>

        <button
          class="secondary"
          type="button"
          onClick={handleForceViewerRefresh}
        >
          Force viewer refresh
        </button>

        <div class="control-row">
          <span class="control-label">Limit FPS (60)</span>
          <label class="switch">
            <input
              type="checkbox"
              checked={debugFpsLimitEnabled}
              onChange={handleFpsLimitToggle}
            />
            <span class="switch-track" aria-hidden="true" />
          </label>
        </div>

        <div class="control-row">
          <span class="control-label">Side-by-side stereo</span>
          <label class="switch">
            <input
              type="checkbox"
              checked={stereoEnabled}
              onChange={handleStereoToggle}
            />
            <span class="switch-track" aria-hidden="true" />
          </label>
        </div>

        <div class="control-row">
          <span class="control-label">Splat width</span>
          <div class="control-track">
            <input
              type="range"
              min="0.5"
              max="8"
              step="0.1"
              value={debugSparkMaxStdDev}
              onInput={handleSparkStdDevChange}
            />
            <span class="control-value">{debugSparkMaxStdDev.toFixed(2)}</span>
          </div>
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

        {currentAssetHasCustomMetadata && (
          <div class="control-row">
            <span class="control-label">Clear custom metadata</span>
            <button
              type="button"
              class="secondary danger"
              onClick={handleClearCustomMetadata}
              disabled={isClearing}
            >
              {isClearing ? 'Clearing...' : '🗑️ Clear Custom Metadata'}
            </button>
          </div>
        )}

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
