/**
  * File loader module.
 * Handles file loading, drag/drop, format detection, and asset management.
 * Works with Zustand store for state updates and Preact components for UI.
 */

import { getSupportedExtensions } from "./formats/index.js";
import { useStore } from "./store.js";
import {
  scene,
  renderer,
  composer,
  camera,
  controls,
  spark,
  currentMesh,
  setCurrentMesh,
  setOriginalImageAspect,
  requestRender,
  THREE,
} from "./viewer.js";
import { applyPreviewBackground, captureAndApplyBackground, clearBackground, hasBackgroundForPreview } from "./backgroundManager.js";
import { savePreviewBlob, listCachedFileNames } from "./fileStorage.js";
import {
  fitViewToMesh,
  applyMetadataCamera,
  clearMetadataCamera,
  saveHomeView,
  applyFocusDistanceOverride,
  animateCameraMutation,
} from "./cameraUtils.js";
import {
  loadCustomMetadataForAsset,
  applyCustomModelTransform,
  applyCameraPose,
  applyFullOrbitConstraints,
  restoreOrbitConstraints,
} from "./customMetadata.js";
import { slideOutAnimation, slideInAnimation, cancelContinuousZoomAnimation, cancelContinuousOrbitAnimation, cancelContinuousVerticalOrbitAnimation } from "./cameraAnimations.js";
import { isImmersiveModeActive, pauseImmersiveMode, resumeImmersiveMode } from "./immersiveMode.js";
import { applyIntrinsicsAspect, updateViewerAspectRatio, resize } from "./layout.js";
import { cleanupSlideTransitionState, waitForViewerResizeTransition } from "./transitionUtils.js";
import { hydrateAssetPreviewFromStorage, replacePreviewUrl, formatBytes } from "./previewManager.js";

// Re-export layout helpers for existing callers
export { updateViewerAspectRatio, resize } from "./layout.js";

/** Navigation lock to prevent concurrent asset loads */
let isNavigationLocked = false;

export const isNavigationLockedRef = () => isNavigationLocked;
export const setNavigationLocked = (locked) => {
  isNavigationLocked = locked;
};

/** Track if this is the very first asset load (no previous mesh) */
let hasLoadedFirstAsset = false;

import {
  setAssetList as setAssetListManager,
  getAssetList,
  getCurrentAssetIndex,
  setCurrentAssetIndex as setCurrentAssetIndexManager,
  getAssetByIndex,
  onPreviewGenerated,
  hasMultipleAssets,
  getAssetCount,
  nextAsset,
  prevAsset,
  captureCurrentAssetPreview,
  addAssets,
} from "./assetManager.js";
import {
  activateSplatEntry,
  ensureSplatEntry,
  retainOnlySplats,
  resetSplatManager,
  isSplatCached,
  getSplatCache,
} from "./splatManager.js";

/** Warmup frames for renderer stabilization (fresh load) */
const WARMUP_FRAMES = 120;

/** Reduced warmup frames for preloaded/cached splats */
const WARMUP_FRAMES_CACHED = 15;

/** Frame at which to capture background */
const BG_CAPTURE_FRAME = 90;

/** Frame at which to capture preview thumbnail */
const PREVIEW_CAPTURE_FRAME = 60;

/** Frame at which to capture for cached splats */
const PREVIEW_CAPTURE_FRAME_CACHED = 10;

/** Debug helper: force camera far out to inspect backgrounds */
let debugForceZoomOut = false; // toggled via DebugSettings
const DEBUG_ZOOM_MULTIPLIER = 6; // how much farther to push camera back

/** Accesses Zustand store state */
const getStoreState = () => useStore.getState();

/** Supported file extensions for display */
const supportedExtensions = getSupportedExtensions();
const supportedExtensionsText = supportedExtensions.join(", ");

const isFile = (value) => typeof File !== "undefined" && value instanceof File;

const makeAdHocAssetId = (file) =>
  `adhoc-${file?.name ?? "asset"}-${file?.size ?? 0}-${file?.lastModified ?? Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

const normalizeAssetCandidate = (candidate) => {
  if (!candidate) return null;
  if (candidate.file && isFile(candidate.file)) {
    if (!candidate.id) {
      candidate.id = makeAdHocAssetId(candidate.file);
    }
    if (!candidate.name) {
      candidate.name = candidate.file.name ?? "Untitled";
    }
    return candidate;
  }
  // Storage source asset - file will be loaded lazily
  if (candidate.sourceId && candidate._remoteAsset) {
    if (!candidate.id) {
      candidate.id = `source-${candidate.sourceId}-${Date.now()}`;
    }
    return candidate;
  }
  if (isFile(candidate)) {
    return {
      id: makeAdHocAssetId(candidate),
      file: candidate,
      name: candidate.name ?? "Untitled",
      preview: null,
      previewSource: null,
      loaded: false,
    };
  }
  return null;
};

const collectNeighborAssets = (assets, centerIndex) => {
  if (!assets || assets.length === 0) return [];
  const n = assets.length;
  const indices = [];

  if (centerIndex >= 0 && centerIndex < n) {
    // Use circular indices so neighbors wrap around the list (important for seamless looping)
    const prev = (centerIndex - 1 + n) % n;
    const next = (centerIndex + 1) % n;
    indices.push(centerIndex, prev, next);
  } else {
    indices.push(0);
  }

  const seen = new Set();
  const results = [];
  for (const idx of indices) {
    const asset = assets[idx];
    if (!asset || seen.has(asset.id)) continue;
    seen.add(asset.id);
    results.push(asset);
  }
  return results;
};

const syncStoredAnimationSettings = async (animationSettings, wasImmersiveModeActive, store) => {
  if (!animationSettings) return;
  const { enabled, intensity, direction } = animationSettings;
  store.setAnimationEnabled(enabled);
  store.setAnimationIntensity(intensity);
  store.setAnimationDirection(direction);

  if (wasImmersiveModeActive) return;

  try {
    const {
      setLoadAnimationEnabled,
      setLoadAnimationIntensity,
      setLoadAnimationDirection,
    } = await import("./customAnimations.js");
    setLoadAnimationEnabled(enabled);
    setLoadAnimationIntensity(intensity);
    setLoadAnimationDirection(direction);
  } catch (err) {
    console.warn("Failed to sync animation module", err);
  }
};


const applyDebugZoomOut = () => {
  if (!debugForceZoomOut) return;
  if (!camera || !controls) return;
  const dir = camera.position.clone().sub(controls.target);
  const dist = dir.length();
  if (dist <= 0) return;
  dir.normalize().multiplyScalar(dist * DEBUG_ZOOM_MULTIPLIER);
  camera.position.copy(controls.target.clone().add(dir));
  camera.updateProjectionMatrix();
  requestRender();
};

/** Enable or disable debug zoom-out mode */
export const setDebugForceZoomOut = (enabled) => {
  debugForceZoomOut = Boolean(enabled);
};

/**
 * Loads and displays a 3DGS splat file.
 * Handles format detection, camera metadata parsing, mesh creation,
 * and post-load effects (animation, preview capture, background).
 * 
 * @param {Object|File} assetOrFile - Asset descriptor or File object to load
 * @param {Object} options - Load options
 * @param {string} options.slideDirection - 'next' or 'prev' for slide transition
 */
export const loadSplatFile = async (assetOrFile, options = {}) => {
  const viewerEl = document.getElementById('viewer');
  if (!viewerEl) return;

  const asset = normalizeAssetCandidate(assetOrFile);
  // Allow assets with file OR storage source (file loaded lazily)
  if (!asset) return;
  const hasFileOrSource = asset.file || (asset.sourceId && asset._remoteAsset);
  if (!hasFileOrSource) return;

  await hydrateAssetPreviewFromStorage(asset);

  // Cancel any in-flight slide transitions before starting a new load
  // This prevents race conditions where previous animation state corrupts the new load
  cleanupSlideTransitionState();

  const store = getStoreState();
  const { slideDirection } = options;
  const immersiveActive = isImmersiveModeActive();
  const isFirstLoad = !hasLoadedFirstAsset; // Detect first asset load before any mesh exists
  const forceFadeForNonSequential = !slideDirection; // random asset clicks should use fade transition
  const baseSlideMode = store.slideMode ?? 'horizontal';
  const shouldUseContinuous = store.slideshowMode && store.slideshowContinuousMode && baseSlideMode !== 'fade';
  const resolvedSlideMode = shouldUseContinuous
    ? (baseSlideMode === 'horizontal'
      ? 'continuous-orbit'
      : baseSlideMode === 'vertical'
        ? 'continuous-orbit-vertical'
        : baseSlideMode === 'zoom'
          ? 'continuous-zoom'
          : baseSlideMode)
    : baseSlideMode;

  const slideMode = (immersiveActive || forceFadeForNonSequential)
    ? 'fade'
    : resolvedSlideMode;
  const wasAlreadyCached = isSplatCached(asset);

  // For first load, immediately hide content to prevent flash before fade-in
  // This must happen BEFORE any async work that might cause a render
  if (isFirstLoad) {
    viewerEl.classList.add('slide-out');
  }

  // Preload entry early (reused later to avoid duplicate loads)
  const entryPromise = ensureSplatEntry(asset);
  let aspectApplied = false;
  
  // For transitions (slides or random asset clicks), start fade/slide-out and entry prep in parallel
  const transitionDirection = slideDirection ?? 'next';
  const shouldRunTransition = currentMesh && (slideDirection || forceFadeForNonSequential);
  let preloadedEntry = null;
  if (shouldRunTransition) {
    const isFadeMode = slideMode === 'fade';
    const slideOpts = isFadeMode
      ? { duration: 650, amount: 0.35, fadeDelay: 0.5, mode: slideMode }
      : { duration: 1200, amount: 0.5, fadeDelay: 0.625, mode: slideMode };

    const slideOutPromise = slideOutAnimation(transitionDirection, slideOpts);
    const prepPromise = entryPromise.catch((err) => {
      console.warn('Failed to preload during transition:', err);
      return null;
    });
    const [, entry] = await Promise.all([slideOutPromise, prepPromise]);
    if (entry) {
      applyIntrinsicsAspect(entry);
      aspectApplied = true;
    }
    preloadedEntry = entry;
  }
  
  store.setFileInfo({ name: asset.name });

  const wasImmersiveModeActive = immersiveActive;
  if (wasImmersiveModeActive) {
    pauseImmersiveMode();
  }

  const start = performance.now();

  try {
    // Only clear background if not cached (avoid flash)
    if (!wasAlreadyCached && !asset.preview) {
      clearBackground();
      const pageEl = document.querySelector(".page");
      if (pageEl) {
        pageEl.classList.remove("has-glow");
      }
    }

    // Only show loading overlay for non-cached loads
    if (!wasAlreadyCached) {
      viewerEl.classList.add("loading");
      store.setIsLoading(true);
      store.setStatus("Preparing splat...");
    }

    const assetList = getAssetList();
    const assetIndex = assetList.findIndex((a) => a.id === asset.id);
    const neighborAssets = assetIndex >= 0
      ? collectNeighborAssets(assetList, assetIndex)
      : [asset];

    let entry = preloadedEntry; // Use preloaded if available
    if (!entry) {
      try {
        entry = await entryPromise;
        // Toggle visibility now that the entry is loaded
        if (entry) {
          if (!aspectApplied) {
            applyIntrinsicsAspect(entry);
            aspectApplied = true;
          }
          const cache = getSplatCache();
          cache.forEach((cached, id) => {
            cached.mesh.visible = id === asset.id;
          });
          requestRender();
        }
      } catch (error) {
        if (error?.code === "UNSUPPORTED_FORMAT") {
          store.setStatus(`Only ${supportedExtensionsText} 3DGS files are supported`);
          viewerEl.classList.remove("loading");
          store.setIsLoading(false);
          if (wasImmersiveModeActive) {
            resumeImmersiveMode();
          }
          return;
        }
        throw error;
      }
    } else {
      // Activate the preloaded entry
      const cache = getSplatCache();
      cache.forEach((cached, id) => {
        cached.mesh.visible = id === asset.id;
      });
      requestRender(); // Immediately render the new mesh
    }

    if (!entry) {
      throw new Error("Unable to activate splat entry");
    }

    setCurrentMesh(entry.mesh);
    viewerEl.classList.add("has-mesh");
    spark.update({ scene });

    // Fire-and-forget neighbor preloading (don't block current asset)
    const neighborIds = new Set(neighborAssets.map((neighbor) => neighbor.id));
    retainOnlySplats(neighborIds);
    
    // Preload neighbors in background without awaiting
    neighborAssets
      .filter((neighbor) => neighbor.id !== asset.id)
      .forEach((neighbor) => {
        ensureSplatEntry(neighbor)
          .then(() => spark.update({ scene }))
          .catch((err) => {
            console.warn(`[SplatManager] Failed to preload ${neighbor.name}:`, err);
          });
      });

    const { cameraMetadata, storedSettings, focusDistanceOverride, formatLabel } = entry;
    const customMetadata = await loadCustomMetadataForAsset(asset.name);
    const hasCustomMetadata = Boolean(customMetadata?.cameraPose);

    // For non-ML Sharp splats, always apply CV→GL coordinate flip
    // This is the same transform ML Sharp files get automatically
    const shouldApplyFlip = !cameraMetadata?.intrinsics;
    const modelOverrides = {
      applyCoordinateFlip: shouldApplyFlip,
      modelScale: customMetadata?.model?.modelScale ?? 1,
    };

    if (shouldApplyFlip || hasCustomMetadata) {
      applyCustomModelTransform(entry.mesh, modelOverrides);
    }

    store.setCustomModelScale(modelOverrides.modelScale);

    const metadataMissing = !cameraMetadata?.intrinsics && !hasCustomMetadata;
    store.setMetadataMissing(metadataMissing);
    store.setCustomMetadataAvailable(hasCustomMetadata);
    store.setCustomMetadataControlsVisible(metadataMissing);

    const shouldDisableOrbitLimits = metadataMissing || hasCustomMetadata || store.slideshowMode;
    if (shouldDisableOrbitLimits) {
      applyFullOrbitConstraints();
    } else {
      restoreOrbitConstraints(store.cameraRange);
    }

    const applyCameraForAsset = () => {
      if (hasCustomMetadata && customMetadata?.cameraPose) {
        applyCameraPose(customMetadata.cameraPose);
      } else if (cameraMetadata) {
        applyMetadataCamera(entry.mesh, cameraMetadata, resize);
      } else {
        fitViewToMesh(entry.mesh);
      }
    };

    if (storedSettings) {
      store.addLog(`Found stored settings for ${asset.name}`);
    }

    await syncStoredAnimationSettings(
      storedSettings?.animation,
      wasImmersiveModeActive,
      store,
    );

    if (focusDistanceOverride !== undefined) {
      store.setHasCustomFocus(true);
      store.setFocusDistanceOverride(focusDistanceOverride);
      store.addLog(`Found focus distance override: ${focusDistanceOverride.toFixed(2)} units`);
    } else {
      store.setHasCustomFocus(false);
      store.setFocusDistanceOverride(null);
    }

    // Extract custom aspect ratio from metadata (for non-ML Sharp assets)
    const customAspectRatio = customMetadata?.view?.aspectRatio;

    if (cameraMetadata?.intrinsics) {
      const { intrinsics } = cameraMetadata;
      const aspect = intrinsics.imageWidth / intrinsics.imageHeight;
      setOriginalImageAspect(aspect);
      // console.log(`[Aspect] ${asset.name}: ${aspect.toFixed(4)} (${intrinsics.imageWidth}x${intrinsics.imageHeight})`);
      store.addLog(
        `${formatLabel ?? "3DGS"} camera: fx=${intrinsics.fx.toFixed(1)}, fy=${intrinsics.fy.toFixed(1)}, ` +
          `cx=${intrinsics.cx.toFixed(1)}, cy=${intrinsics.cy.toFixed(1)}, ` +
          `img=${intrinsics.imageWidth}x${intrinsics.imageHeight}`,
      );
    } else if (customAspectRatio && customAspectRatio > 0) {
      // Apply custom aspect ratio from saved metadata
      setOriginalImageAspect(customAspectRatio);
      console.log(`[Aspect] ${asset.name}: custom override ${customAspectRatio.toFixed(4)}`);
      
      // Sync dropdown state - convert ratio to key
      const aspectRatioToKey = (ratio) => {
        if (!ratio || ratio === null) return 'full';
        const tolerance = 0.01;
        if (Math.abs(ratio - 1) < tolerance) return '1:1';
        if (Math.abs(ratio - 16/9) < tolerance) return '16:9';
        if (Math.abs(ratio - 9/16) < tolerance) return '9:16';
        if (Math.abs(ratio - 4/3) < tolerance) return '4:3';
        if (Math.abs(ratio - 3/4) < tolerance) return '3:4';
        return 'full'; // fallback for custom ratios not in list
      };
      store.setCustomAspectRatio(aspectRatioToKey(customAspectRatio));
    } else {
      setOriginalImageAspect(null);
      store.setCustomAspectRatio('full');
    }

    // slide-out class was already added at the start of loadSplatFile for first load

    if (aspectApplied) {
      await waitForViewerResizeTransition();
    }

    updateViewerAspectRatio();

    // For custom aspect ratio on non-first loads, wait for CSS transition then resize renderer
    if (customAspectRatio && !isFirstLoad) {
      await waitForViewerResizeTransition();
      resize();
      requestRender();
    }

    // For first load, wait for aspect ratio transition then prepare for fade-in
    if (isFirstLoad) {
      // Wait for the CSS resize transition to complete
      await waitForViewerResizeTransition();
      // Resize renderer to match new viewer dimensions
      resize();
      hasLoadedFirstAsset = true;
    }

    clearMetadataCamera(resize);

    // Stop any in-progress continuous zoom before applying new camera settings
    cancelContinuousZoomAnimation();
    cancelContinuousOrbitAnimation();
    cancelContinuousVerticalOrbitAnimation();

    // For slide transitions on cached splats, apply camera instantly then slide in
    // Otherwise use the smooth camera mutation animation
    if (slideDirection && wasAlreadyCached) {
      // Apply camera settings instantly
      applyCameraForAsset();

      if (focusDistanceOverride !== undefined) {
        applyFocusDistanceOverride(focusDistanceOverride);
        store.addLog(`Applied focus distance override: ${focusDistanceOverride.toFixed(2)} units`);
      }

      try {
        store.setFov(camera.fov);
      } catch (err) {
        console.warn('Failed to set store FOV from camera:', err);
      }

      saveHomeView();
      applyDebugZoomOut();
      
      // Apply background BEFORE slideIn so it fades in sync with canvas
      if (asset.preview) {
        applyPreviewBackground(asset.preview);
      }
      
      // Slide in from the navigation direction (1s pan with quick fade-in)
      await slideInAnimation(slideDirection, { duration: 1000, amount: 0.5, mode: slideMode });
      
      // Safety cleanup in case slideInAnimation didn't fully clean up
      const viewerEl = document.getElementById('viewer');
      if (viewerEl && (viewerEl.classList.contains('slide-out') || viewerEl.classList.contains('slide-in'))) {
        viewerEl.classList.remove('slide-out', 'slide-in');
      }
    } else {
      // For first load, skip camera animation entirely - just fade in
      // For subsequent loads, use the configured animation
      const shouldAnimateCamera = !isFirstLoad && !wasImmersiveModeActive && store.animationEnabled;

      await animateCameraMutation(() => {
        applyCameraForAsset();

        if (focusDistanceOverride !== undefined) {
          applyFocusDistanceOverride(focusDistanceOverride);
          store.addLog(`Applied focus distance override: ${focusDistanceOverride.toFixed(2)} units`);
        }

        try {
          store.setFov(camera.fov);
        } catch (err) {
          console.warn('Failed to set store FOV from camera:', err);
        }

        saveHomeView();
        applyDebugZoomOut();
      }, { animate: shouldAnimateCamera });
      
      // Apply background BEFORE slideIn so it fades in sync with canvas
      if (shouldRunTransition && asset.preview) {
        applyPreviewBackground(asset.preview);
      }
      
      if (shouldRunTransition) {
        // Bring content back with fade/slide-in after camera is set
        await slideInAnimation(transitionDirection, { duration: slideMode === 'fade' ? 750 : 1000, amount: 0.45, mode: slideMode });
        const viewerEl = document.getElementById('viewer');
        if (viewerEl) {
          viewerEl.classList.remove('slide-out');
          viewerEl.classList.remove('slide-in');
        }
      } else if (slideDirection) {
        // Legacy fade-in for slide transitions when slideOutAnimation was skipped
        const viewerEl = document.getElementById('viewer');
        if (viewerEl) {
          viewerEl.classList.remove('slide-out');
          viewerEl.classList.add('slide-in');
          setTimeout(() => {
            viewerEl.classList.remove('slide-in');
          }, 550);
        }
      } else if (isFirstLoad) {
        // First load: fade-in after aspect ratio transition completed
        // Content was hidden with slide-out class during resize
        const viewerEl = document.getElementById('viewer');
        if (viewerEl) {
          viewerEl.classList.remove('slide-out');
          viewerEl.classList.add('slide-in');
          setTimeout(() => {
            viewerEl.classList.remove('slide-in');
          }, 500);
        }
      }
    }

    // Apply preview for non-transition cases (transitions handled above)
    // For slideDirection/shouldRunTransition cases, preview was already applied before slideInAnimation
    const alreadyAppliedPreview = slideDirection || shouldRunTransition;
    if (!alreadyAppliedPreview) {
      if (asset.preview) {
        if (wasAlreadyCached) {
          applyPreviewBackground(asset.preview);
        } else {
          setTimeout(() => {
            applyPreviewBackground(asset.preview);
          }, 50);
        }
      } else {
        applyPreviewBackground(null);
      }
    } else if (!asset.preview) {
      // Clear stale background for transitions without preview
      applyPreviewBackground(null);
    }

    // Use reduced warmup for cached splats
    let warmupFrames = wasAlreadyCached ? WARMUP_FRAMES_CACHED : WARMUP_FRAMES;
    let bgCaptured = wasAlreadyCached; // Skip bg capture for cached
    let previewCaptured = false;

    const skipBgGeneration = wasAlreadyCached || (asset.preview && asset.previewSource === "image");

    const warmup = () => {
      if (warmupFrames > 0) {
        warmupFrames--;
        requestRender();
        requestAnimationFrame(warmup);

        if (!bgCaptured && warmupFrames === BG_CAPTURE_FRAME && !skipBgGeneration) {
          // Also skip background capture in VR/stereo mode
          const bgStoreState = getStoreState();
          const isDistortedBg = bgStoreState.stereoEnabled || bgStoreState.vrSessionActive;
          const backgroundMatchesPreview = hasBackgroundForPreview(asset.preview);
          if (!isDistortedBg && !backgroundMatchesPreview) {
            bgCaptured = true;
            captureAndApplyBackground({ renderer, composer, scene, THREE });
          }
        }

        const previewFrame = wasAlreadyCached ? PREVIEW_CAPTURE_FRAME_CACHED : PREVIEW_CAPTURE_FRAME;
        if (!previewCaptured && warmupFrames === previewFrame) {
          previewCaptured = true;
          
          // Skip preview capture if VR or stereo mode is active (would produce distorted preview)
          const currentStoreState = getStoreState();
          const isDistortedMode = currentStoreState.stereoEnabled || currentStoreState.vrSessionActive;
          const shouldGeneratePreview = !isDistortedMode && (!asset.preview || asset.previewSource === 'image');

          if (shouldGeneratePreview) {
            const capturePromise = captureCurrentAssetPreview();
            if (capturePromise?.then) {
              capturePromise
                .then(async (previewResult) => {
                  if (!previewResult?.blob) return;
                  const sizeKB = (previewResult.blob.size / 1024).toFixed(1);
                  store.addLog(`Preview saved (${sizeKB} KB, ${previewResult.format ?? 'image/webp'})`);
                  
                  // Sync the captured preview to the store for gallery display
                  const assetIndex = getAssetList().findIndex((a) => a.id === asset.id);
                  if (assetIndex >= 0 && asset.preview) {
                    store.updateAssetPreview(assetIndex, asset.preview);
                    if (assetIndex === getCurrentAssetIndex()) {
                      applyPreviewBackground(asset.preview);
                    }
                  }
                  
                  await savePreviewBlob(asset.name, previewResult.blob, {
                    width: previewResult.width,
                    height: previewResult.height,
                    format: previewResult.format,
                  }).catch((err) => {
                    console.warn('Failed to save preview:', err);
                  });
                })
                .catch((err) => {
                  console.warn('Preview capture failed', err);
                });
            }
          } else {
            store.addLog('Using stored preview from IndexedDB');
          }
        }
      } else if (wasImmersiveModeActive) {
        resumeImmersiveMode();
      }
    };
    warmup();

    const loadMs = performance.now() - start;

    store.setFileInfo({
      name: asset.name,
      size: formatBytes(asset.file?.size ?? asset.size),
      splatCount: entry.mesh?.packedSplats?.numSplats ?? "-",
      loadTime: `${loadMs.toFixed(1)} ms`,
    });

    // Remove loading state immediately for cached, short delay for fresh loads
    if (wasAlreadyCached) {
      viewerEl.classList.remove("loading");
      store.setIsLoading(false);
    } else {
      requestAnimationFrame(() => {
        viewerEl.classList.remove("loading");
        store.setIsLoading(false);
      });
    }

    const formatName = formatLabel ?? asset.name ?? "asset";
    const loadedMessage = cameraMetadata
      ? `Loaded ${formatName}`
      : `Loaded ${formatName} (no camera data)`;
    store.setStatus(loadedMessage);
    store.addLog(
      `Debug: splats=${entry.mesh?.packedSplats?.numSplats ?? "-"}`,
    );
  } catch (error) {
    console.error(error);
    viewerEl.classList.remove("loading");
    store.setIsLoading(false);
    clearMetadataCamera(resize);
    store.setStatus("Load failed, please check the file or console log");
    
    // Clean up any slide transition state on error
    cleanupSlideTransitionState();

    if (wasImmersiveModeActive) {
      resumeImmersiveMode();
    }
  }
};

/**
 * Prevents default browser behavior for drag events.
 * @param {DragEvent} event - Drag event
 */
const preventDefaults = (event) => {
  event.preventDefault();
  event.stopPropagation();
};

/**
 * Collect files from a drag event, supporting folder drops.
 * @param {DragEvent} event
 * @returns {Promise<File[]>}
 */
export const collectDroppedFiles = async (event) => {
  const items = event.dataTransfer?.items;
  const files = [];

  if (items) {
    // Try to get folder contents using webkitGetAsEntry
    const entries = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        entries.push(entry);
      }
    }

    if (entries.length > 0) {
      const processedFiles = await processEntries(entries);
      files.push(...processedFiles);
    } else {
      const fileList = event.dataTransfer?.files;
      if (fileList) {
        files.push(...Array.from(fileList));
      }
    }
  } else {
    const fileList = event.dataTransfer?.files;
    if (fileList) {
      files.push(...Array.from(fileList));
    }
  }

  return files;
};

/**
 * Initializes drag-and-drop file loading on the viewer element.
 * Supports both individual files and folder drops.
 * Called from Viewer component after viewer is ready.
 */
export const initDragDrop = () => {
  const viewerEl = document.getElementById('viewer');
  if (!viewerEl) return;

  ["dragenter", "dragover"].forEach((eventName) => {
    viewerEl.addEventListener(eventName, (event) => {
      preventDefaults(event);
      viewerEl.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    viewerEl.addEventListener(eventName, (event) => {
      preventDefaults(event);
      if (eventName === "dragleave") {
        viewerEl.classList.remove("dragging");
      }
    });
  });

  viewerEl.addEventListener("drop", async (event) => {
    viewerEl.classList.remove("dragging");

    const files = await collectDroppedFiles(event);
    if (files.length > 0) {
      const hasExistingAssets = getAssetCount() > 0;
      if (hasExistingAssets) {
        await handleAddFiles(files, { selectFirstAdded: true });
      } else {
        await handleMultipleFiles(files);
      }
    }
  });
};

/**
 * Recursively processes FileSystemEntry objects from drag/drop.
 * Handles both files and directories.
 * @param {FileSystemEntry[]} entries - Array of file system entries
 * @returns {Promise<File[]>} Array of File objects
 */
const processEntries = async (entries) => {
  const files = [];
  
  /**
   * Reads a single entry (file or directory).
   * @param {FileSystemEntry} entry - Entry to read
   * @returns {Promise<File[]>} Array of files from this entry
   */
  const readEntry = async (entry) => {
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((file) => resolve([file]), () => resolve([]));
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const subEntries = await new Promise((resolve) => {
        const allEntries = [];
        const readEntries = () => {
          dirReader.readEntries((entries) => {
            if (entries.length === 0) {
              resolve(allEntries);
            } else {
              allEntries.push(...entries);
              readEntries();
            }
          }, () => resolve(allEntries));
        };
        readEntries();
      });
      const subFiles = await processEntries(subEntries);
      return subFiles;
    }
    return [];
  };
  
  for (const entry of entries) {
    const entryFiles = await readEntry(entry);
    files.push(...entryFiles);
  }
  
  return files;
};

/**
 * Processes multiple files from drag/drop or file picker.
 * Filters supported formats, updates asset gallery, and loads first file.
 * Called from SidePanel (file picker) and initDragDrop (drag/drop).
 * 
 * @param {File[]} files - Array of File objects to process
 */
export const handleMultipleFiles = async (files) => {
  if (!files || files.length === 0) return;
  const store = getStoreState();
  store.clearActiveSource();
  const result = await setAssetListManager(files);
  
  if (result.count === 0) {
    store.setStatus(`No supported files found. Supported: ${supportedExtensionsText}`);
    return;
  }
  
  resetSplatManager();
  setCurrentMesh(null);
  hasLoadedFirstAsset = false; // Reset first load flag for new asset list
  spark.update({ scene });

  // Update store with assets
  store.setAssets(result.assets);
  
  if (result.count === 1) {
    // Single file - load directly
    // First, hydrate preview from storage (same as multi-file branch)
    const asset = result.assets[0];
    if (!asset.preview) {
      const storedPreview = await hydrateAssetPreviewFromStorage(asset);
      if (storedPreview?.blob) {
        store.updateAssetPreview(0, asset.preview);
      }
    }
    
    // Set up preview generation callback (same as multi-file branch)
    onPreviewGenerated((asset, index) => {
      store.updateAssetPreview(index, asset.preview);
    });
    
    setCurrentAssetIndexManager(0);
    store.setCurrentAssetIndex(0);
    await loadSplatFile(asset);
  } else {
    // Multiple files - show gallery and start loading
    store.addLog(`Found ${result.count} assets`);
    
    // Load stored previews from IndexedDB for all assets
    for (let i = 0; i < result.assets.length; i++) {
      const asset = result.assets[i];
      if (asset.preview) continue;
      const storedPreview = await hydrateAssetPreviewFromStorage(asset);
      if (storedPreview?.blob) {
        store.updateAssetPreview(i, asset.preview);
      }
    }
    
    // Set up preview generation callback
    onPreviewGenerated((asset, index) => {
      store.updateAssetPreview(index, asset.preview);
    });
    
    // Load first asset (preview will be captured automatically after warmup)
    setCurrentAssetIndexManager(0);
    store.setCurrentAssetIndex(0);
    await loadSplatFile(result.assets[0]);
  }
};

/**
 * Adds files to the existing asset list.
 */
export const handleAddFiles = async (files, options = {}) => {
  if (!files || files.length === 0) return;
  const store = getStoreState();
  store.clearActiveSource();
  
  const result = await addAssets(files);
  
  if (result.added === 0) {
    store.setStatus(`No supported files found. Supported: ${supportedExtensionsText}`);
    return;
  }
  
  // Update store with new assets list
  const allAssets = getAssetList();
  store.setAssets([...allAssets]);
  
  store.addLog(`Added ${result.added} assets`);
  
  // Load stored previews for new assets
  const startIndex = allAssets.length - result.added;
  
  for (let i = 0; i < result.newAssets.length; i++) {
    const asset = result.newAssets[i];
    const globalIndex = startIndex + i;
    if (asset.preview) continue;
    const storedPreview = await hydrateAssetPreviewFromStorage(asset);
    if (storedPreview?.blob) {
      store.updateAssetPreview(globalIndex, asset.preview);
    }
  }

  if (options.selectFirstAdded && result.newAssets.length > 0) {
    const firstNewIndex = startIndex;
    setCurrentAssetIndexManager(firstNewIndex);
    store.setCurrentAssetIndex(firstNewIndex);
    await loadSplatFile(result.newAssets[0]);
  }
};

/**
 * Loads a specific asset by index.
 * Called from AssetGallery component when user clicks a thumbnail.
 * @param {number} index - Asset index to load
 */
/**
 * Loads a specific asset by index.
 * Called from AssetGallery and AssetSidebar when user clicks a thumbnail.
 * @param {number} index - Asset index to load
 */
export const loadAssetByIndex = async (index) => {
  const asset = getAssetByIndex(index);
  if (!asset) return;
  if (isNavigationLocked) return;
  
  isNavigationLocked = true;
  
  // Pause immersive mode immediately to prevent erratic camera during transition
  const wasImmersive = isImmersiveModeActive();
  if (wasImmersive) {
    pauseImmersiveMode();
  }
  
  try {
    const store = getStoreState();
    setCurrentAssetIndexManager(index);
    store.setCurrentAssetIndex(index);
    await loadSplatFile(asset);
  } finally {
    isNavigationLocked = false;
    // Resume immersive mode after navigation completes
    if (wasImmersive) {
      resumeImmersiveMode();
    }
  }
};

/**
 * Loads assets from a connected storage source.
 * Replaces current asset list with assets from the source.
 * 
 * @param {import('./storage/AssetSource.js').AssetSource} source
 */
export const loadFromStorageSource = async (source, options = {}) => {
  const store = getStoreState();
  const { preferredIndex } = options || {};

  store.setIsLoading(true);

  try {
    store.setStatus(`Loading assets from ${source.name}...`);
    
    // Import storage adapter
    const { loadSourceAssets, loadAssetPreview } = await import('./storage/index.js');
    const { setAdaptedAssets } = await import('./assetManager.js');
    
    // Get assets from source
    const adaptedAssets = await loadSourceAssets(source);

    // Record the active collection for UI highlighting
    store.setActiveSourceId(source.id);
    
    if (adaptedAssets.length === 0) {
      store.setStatus(`No supported assets found in ${source.name}`);
      store.setAssets([]);
      store.setCurrentAssetIndex(-1);
      resetSplatManager();
      setCurrentMesh(null);
      hasLoadedFirstAsset = false;
      spark.update({ scene });
      clearBackground();
      const pageEl = document.querySelector(".page");
      if (pageEl) {
        pageEl.classList.remove("has-glow");
      }
      return;
    }
    
    // Reset current state
    resetSplatManager();
    setCurrentMesh(null);
    hasLoadedFirstAsset = false; // Reset first load flag for new source
    spark.update({ scene });
    
    // Clear background
    clearBackground();
    const pageEl = document.querySelector(".page");
    if (pageEl) {
      pageEl.classList.remove("has-glow");
    }
    
    // Set the adapted assets in the asset manager
    const result = setAdaptedAssets(adaptedAssets);

    // Hydrate cached flags from IndexedDB settings
    try {
      const cachedNames = await listCachedFileNames();
      const cachedSet = new Set(cachedNames);
      result.assets.forEach((asset) => {
        asset.isCached = cachedSet.has(asset.name);
      });
    } catch (err) {
      console.warn('[FileLoader] Failed to hydrate cache flags', err);
    }

    // Update store with assets
    store.setAssets(result.assets);
    
    store.addLog(`Found ${adaptedAssets.length} assets from ${source.name}`);
    
    // Set up preview generation callback
    onPreviewGenerated((asset, index) => {
      store.updateAssetPreview(index, asset.preview);
    });
    
    // Load previews from source for all assets (in background)
    const loadPreviews = async () => {
      for (let i = 0; i < result.assets.length; i++) {
        const asset = result.assets[i];
        if (asset.preview) continue;
        const storedPreview = await hydrateAssetPreviewFromStorage(asset);
        if (storedPreview?.blob) {
          store.updateAssetPreview(i, asset.preview);
          continue;
        }

        const preview = await loadAssetPreview(asset);
        if (preview) {
          replacePreviewUrl(asset, preview);
          store.updateAssetPreview(i, asset.preview);
        }
      }
    };
    loadPreviews(); // Don't await, run in background
    
    // Load preferred asset (fallback to first)
    if (result.assets.length > 0) {
      const fallbackIndex = 0;
      const candidate = Number.isInteger(preferredIndex) ? preferredIndex : fallbackIndex;
      const indexToLoad = candidate >= 0 && candidate < result.assets.length ? candidate : fallbackIndex;
      setCurrentAssetIndexManager(indexToLoad);
      store.setCurrentAssetIndex(indexToLoad);
      await loadSplatFile(result.assets[indexToLoad]);
    }
    
  } catch (error) {
    console.error('Failed to load from storage source:', error);
    store.setStatus(`Failed to load from ${source.name}: ${error.message}`);
    store.clearActiveSource();
  } finally {
    store.setIsLoading(false);
  }
};

/**
 * Loads the next asset in the list.
 * Called from keyboard shortcut (arrow keys).
 */
export const loadNextAsset = async () => {
  if (!hasMultipleAssets()) return;
  if (isNavigationLocked) return;
  
  isNavigationLocked = true;
  
  // Pause immersive mode immediately to prevent erratic camera during transition
  const wasImmersive = isImmersiveModeActive();
  if (wasImmersive) {
    pauseImmersiveMode();
  }
  
  try {
    const asset = nextAsset();
    if (asset) {
      const index = getCurrentAssetIndex();
      const store = getStoreState();
      store.setCurrentAssetIndex(index);
      await loadSplatFile(asset, { slideDirection: 'next' });
    }
  } finally {
    isNavigationLocked = false;
    // Resume immersive mode after navigation completes
    if (wasImmersive) {
      resumeImmersiveMode();
    }
  }
};

/**
 * Loads the previous asset in the list.
 * Called from keyboard shortcut (arrow keys).
 */
export const loadPrevAsset = async () => {
  if (!hasMultipleAssets()) return;
  if (isNavigationLocked) return;
  
  isNavigationLocked = true;
  
  // Pause immersive mode immediately to prevent erratic camera during transition
  const wasImmersive = isImmersiveModeActive();
  if (wasImmersive) {
    pauseImmersiveMode();
  }
  
  try {
    const asset = prevAsset();
    if (asset) {
      const index = getCurrentAssetIndex();
      const store = getStoreState();
      store.setCurrentAssetIndex(index);
      await loadSplatFile(asset, { slideDirection: 'prev' });
    }
  } finally {
    isNavigationLocked = false;
    // Resume immersive mode after navigation completes
    if (wasImmersive) {
      resumeImmersiveMode();
    }
  }
};

/**
 * Reloads the current asset to force a clean render (e.g., after fullscreen).
 * Skips if navigation is already locked or no asset is selected.
 */
export const reloadCurrentAsset = async () => {
  if (isNavigationLocked) return;

  const index = getCurrentAssetIndex();
  if (index < 0) return;

  const asset = getAssetByIndex(index);
  if (!asset) return;

  isNavigationLocked = true;

  const wasImmersive = isImmersiveModeActive();
  if (wasImmersive) {
    pauseImmersiveMode();
  }

  try {
    await loadSplatFile(asset);
  } finally {
    isNavigationLocked = false;
    if (wasImmersive) {
      resumeImmersiveMode();
    }
  }
};

