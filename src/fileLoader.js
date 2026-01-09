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
  originalImageAspect,
  activeCamera,
  requestRender,
  updateBackgroundImage,
  setBgImageUrl,
  THREE,
} from "./viewer.js";
import { savePreviewImage } from "./fileStorage.js";
import {
  fitViewToMesh,
  applyMetadataCamera,
  clearMetadataCamera,
  saveHomeView,
  applyCameraProjection,
  animateCameraMutation,
} from "./cameraUtils.js";
import { slideOutAnimation, slideInAnimation, cancelSlideAnimation } from "./cameraAnimations.js";
import { isImmersiveModeActive, pauseImmersiveMode, resumeImmersiveMode } from "./immersiveMode.js";

/** Navigation lock to prevent concurrent asset loads */
let isNavigationLocked = false;

/** Cleanup function for any in-flight animation state */
const cleanupSlideTransitionState = () => {
  const viewerEl = document.getElementById('viewer');
  if (viewerEl) {
    viewerEl.classList.remove('slide-out', 'slide-in');
  }
  const bgContainer = document.querySelector('.bg-image-container');
  if (bgContainer) {
    bgContainer.classList.remove('blur-out');
  }
  cancelSlideAnimation();
};
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
  setCapturePreviewFn,
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

/** Page padding in pixels */
const PAGE_PADDING = 36;

/** Mobile sheet closed height (handle visible) */
const MOBILE_SHEET_CLOSED_HEIGHT = 50;

/** Mobile sheet open height as percentage of viewport (matches CSS max-height in portrait mode) */
const MOBILE_SHEET_OPEN_HEIGHT_VH = 40;

/** Accesses Zustand store state */
const getStoreState = () => useStore.getState();

/** Supported file extensions for display */
const supportedExtensions = getSupportedExtensions();
const supportedExtensionsText = supportedExtensions.join(", ");

const focusDirection = new THREE.Vector3();

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

const applyIntrinsicsAspect = (entry) => {
  const intrinsics = entry?.cameraMetadata?.intrinsics;
  if (!intrinsics || !intrinsics.imageWidth || !intrinsics.imageHeight) return;
  const aspect = intrinsics.imageWidth / intrinsics.imageHeight;
  setOriginalImageAspect(aspect);
  updateViewerAspectRatio();
  requestRender();
};

const waitForViewerResizeTransition = () => new Promise((resolve) => {
  const viewerEl = document.getElementById('viewer');
  if (!viewerEl) {
    resolve();
    return;
  }

  let timeoutId = null;
  const done = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    viewerEl.removeEventListener('transitionend', onEnd);
    resolve();
  };

  const onEnd = (event) => {
    if (event.propertyName === 'width' || event.propertyName === 'height') {
      done();
    }
  };

  timeoutId = setTimeout(done, 280); // Fallback in case transitionend doesn't fire
  viewerEl.addEventListener('transitionend', onEnd);
});

const applyFocusDistanceOverride = (distance) => {
  if (distance === undefined || distance === null) return;
  if (!camera || !controls) return;
  camera.getWorldDirection(focusDirection);
  const target = camera.position.clone().addScaledVector(focusDirection, distance);
  controls.target.copy(target);
  controls.update();
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
    } = await import("./cameraAnimations.js");
    setLoadAnimationEnabled(enabled);
    setLoadAnimationIntensity(intensity);
    setLoadAnimationDirection(direction);
  } catch (err) {
    console.warn("Failed to sync animation module", err);
  }
};

/**
 * Updates viewer dimensions based on window size and panel state.
 * If camera metadata provides an aspect ratio, constrains viewer to match it.
 * Otherwise fills available space.
 * In mobile portrait mode, accounts for mobile sheet height.
 */
export const updateViewerAspectRatio = () => {
  const viewerEl = document.getElementById('viewer');
  if (!viewerEl) return;
  
  const { isMobile, isPortrait, panelOpen } = getStoreState();
  
  let availableWidth = Math.max(0, window.innerWidth - PAGE_PADDING);
  let availableHeight = Math.max(0, window.innerHeight - PAGE_PADDING);
  
  // In mobile portrait mode, subtract the mobile sheet height from available space
  if (isMobile && isPortrait) {
    // Always use closed height to prevent viewer resize/camera reset when opening sheet
    // The sheet will overlay the bottom of the viewer
    const sheetHeight = MOBILE_SHEET_CLOSED_HEIGHT;
    availableHeight = Math.max(0, window.innerHeight - sheetHeight - (PAGE_PADDING / 2));
  }

  if (originalImageAspect && originalImageAspect > 0) {
    // Calculate what the aspect ratio of available space is
    const availableAspect = availableWidth / availableHeight;
    
    let viewerWidth, viewerHeight;
    
    // If image is wider than available space, constrain by width
    // If image is taller than available space, constrain by height
    if (originalImageAspect > availableAspect) {
      // Image is wider - fill width
      viewerWidth = availableWidth;
      viewerHeight = viewerWidth / originalImageAspect;
    } else {
      // Image is taller - fill height
      viewerHeight = availableHeight;
      viewerWidth = viewerHeight * originalImageAspect;
    }
    
    viewerEl.style.width = `${viewerWidth}px`;
    viewerEl.style.height = `${viewerHeight}px`;
  } else {
    viewerEl.style.width = `${availableWidth}px`;
    viewerEl.style.height = `${availableHeight}px`;
  }
};

/**
 * Resizes renderer and updates camera projection.
 * Called on window resize and panel toggle.
 */
export const resize = () => {
  const viewerEl = document.getElementById('viewer');
  if (!viewerEl) return;
  
  updateViewerAspectRatio();
  const { clientWidth, clientHeight } = viewerEl;
  renderer.setSize(clientWidth, clientHeight, false);
//   composer.setSize(clientWidth, clientHeight);
  
  if (activeCamera) {
    applyCameraProjection(activeCamera, clientWidth, clientHeight);
  } else {
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  }
  requestRender();
};

/**
 * Captures a JPEG thumbnail of the current render.
 * Used for asset gallery previews.
 * @returns {string|null} Data URL of captured image, or null if no mesh loaded
 */
const capturePreviewThumbnail = () => {
  if (!currentMesh) return null;
  
  // Render with solid background for capture
  scene.background = new THREE.Color("#0c1018");
  renderer.setClearColor(0x0c1018, 1);
  composer.render();
  
  const dataUrl = renderer.domElement.toDataURL("image/jpeg", 0.85);
  
  // Restore transparent background
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  
  return dataUrl;
};

// Register capture function with asset manager
setCapturePreviewFn(capturePreviewThumbnail);

/**
 * Applies a preview image as background immediately.
 * Used when loading an asset that already has a preview.
 */
const applyPreviewAsBackground = (previewUrl) => {
  if (!previewUrl) return;
  setBgImageUrl(previewUrl);
  updateBackgroundImage(previewUrl);
  
  // Apply glow effect to page container
  const pageEl = document.querySelector(".page");
  if (pageEl) {
    pageEl.style.setProperty("--glow-image", `url(${previewUrl})`);
    pageEl.classList.add("has-glow");
  }
  
  // Make canvas transparent so background shows through
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  
  requestRender();
};

/**
 * Captures current render as blurred background image.
 * Creates depth effect behind the model and glow effect around the viewer.
 */
const captureAndApplyBackground = () => {
  if (!currentMesh) return;

  // Set solid background for capture
  scene.background = new THREE.Color("#0c1018");
  renderer.setClearColor(0x0c1018, 1);
  
  composer.render();
  
  const dataUrl = renderer.domElement.toDataURL("image/jpeg", 0.9);
  
  setBgImageUrl(dataUrl);
  updateBackgroundImage(dataUrl);
  
  // Apply glow effect to page container
  const pageEl = document.querySelector(".page");
  if (pageEl) {
    pageEl.style.setProperty("--glow-image", `url(${dataUrl})`);
    pageEl.classList.add("has-glow");
  }
  
  // Set transparent background so blurred image shows through
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  
  requestRender();
  getStoreState().addLog("Background captured from model render");
};

/**
 * Formats byte count into human-readable string.
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string (e.g., "1.5 MB")
 */
const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
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

  // Cancel any in-flight slide transitions before starting a new load
  // This prevents race conditions where previous animation state corrupts the new load
  cleanupSlideTransitionState();

  const store = getStoreState();
  const { slideDirection } = options;
  const slideMode = store.slideMode ?? 'horizontal';
  const wasAlreadyCached = isSplatCached(asset);

  // Preload entry early (reused later to avoid duplicate loads)
  const entryPromise = ensureSplatEntry(asset);
  let aspectApplied = false;
  
  // For slide transitions, start slide-out and entry prep in parallel
  let preloadedEntry = null;
  if (slideDirection && currentMesh) {
    const slideOutPromise = slideOutAnimation(slideDirection, { duration: 1200, amount: 0.5, fadeDelay: 0.625, mode: slideMode });
    const prepPromise = entryPromise.catch((err) => {
      console.warn('Failed to preload during slide-out:', err);
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

  const wasImmersiveModeActive = isImmersiveModeActive();
  if (wasImmersiveModeActive) {
    pauseImmersiveMode();
  }

  const start = performance.now();

  try {
    // Only clear background if not cached (avoid flash)
    if (!wasAlreadyCached) {
      updateBackgroundImage(null);
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

    if (storedSettings) {
      store.addLog(`Found stored settings for ${asset.name}`);
    }

    if (storedSettings?.preview) {
      applyPreviewAsBackground(storedSettings.preview);
    }

    await syncStoredAnimationSettings(
      storedSettings?.animation,
      wasImmersiveModeActive,
      store,
    );

    if (focusDistanceOverride !== undefined) {
      store.setHasCustomFocus(true);
      store.addLog(`Found focus distance override: ${focusDistanceOverride.toFixed(2)} units`);
    } else {
      store.setHasCustomFocus(false);
    }

    if (cameraMetadata?.intrinsics) {
      const { intrinsics } = cameraMetadata;
      setOriginalImageAspect(intrinsics.imageWidth / intrinsics.imageHeight);
      store.addLog(
        `${formatLabel ?? "3DGS"} camera: fx=${intrinsics.fx.toFixed(1)}, fy=${intrinsics.fy.toFixed(1)}, ` +
          `cx=${intrinsics.cx.toFixed(1)}, cy=${intrinsics.cy.toFixed(1)}, ` +
          `img=${intrinsics.imageWidth}x${intrinsics.imageHeight}`,
      );
    } else {
      setOriginalImageAspect(null);
    }

    if (aspectApplied) {
      await waitForViewerResizeTransition();
    }

    updateViewerAspectRatio();
    clearMetadataCamera(resize);

    // For slide transitions on cached splats, apply camera instantly then slide in
    // Otherwise use the smooth camera mutation animation
    if (slideDirection && wasAlreadyCached) {
      // Apply camera settings instantly
      if (cameraMetadata) {
        applyMetadataCamera(entry.mesh, cameraMetadata, resize);
      } else {
        fitViewToMesh(entry.mesh);
      }

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
      
      // Slide in from the navigation direction (1s pan with quick fade-in)
      await slideInAnimation(slideDirection, { duration: 1000, amount: 0.5, mode: slideMode });
      
      // Safety cleanup in case slideInAnimation didn't fully clean up
      const viewerEl = document.getElementById('viewer');
      if (viewerEl && (viewerEl.classList.contains('slide-out') || viewerEl.classList.contains('slide-in'))) {
        viewerEl.classList.remove('slide-out', 'slide-in');
      }
    } else {
      const shouldAnimateCamera = !wasImmersiveModeActive && store.animationEnabled;

      await animateCameraMutation(() => {
        if (cameraMetadata) {
          applyMetadataCamera(entry.mesh, cameraMetadata, resize);
        } else {
          fitViewToMesh(entry.mesh);
        }

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
      }, { animate: shouldAnimateCamera });
      
      // For non-cached slide transitions, we need to fade the canvas back in
      // since slideOutAnimation ran but slideInAnimation didn't
      if (slideDirection) {
        const viewerEl = document.getElementById('viewer');
        if (viewerEl) {
          // Add slide-in to trigger fade-in transition, remove slide-out
          viewerEl.classList.remove('slide-out');
          viewerEl.classList.add('slide-in');
          // Remove slide-in after transition completes (match CSS transition duration)
          setTimeout(() => {
            viewerEl.classList.remove('slide-in');
          }, 550);
        }
      }
    }

    // Apply preview immediately for cached splats
    if (asset.preview) {
      if (wasAlreadyCached) {
        applyPreviewAsBackground(asset.preview);
      } else {
        setTimeout(() => {
          applyPreviewAsBackground(asset.preview);
        }, 50);
      }
    }

    // Use reduced warmup for cached splats
    let warmupFrames = wasAlreadyCached ? WARMUP_FRAMES_CACHED : WARMUP_FRAMES;
    let bgCaptured = wasAlreadyCached; // Skip bg capture for cached
    let previewCaptured = false;

    const skipBgGeneration = wasAlreadyCached || (asset.preview && asset.previewSource === "image");

    const storedSettingsRef = storedSettings;

    const warmup = () => {
      if (warmupFrames > 0) {
        warmupFrames--;
        requestRender();
        requestAnimationFrame(warmup);

        if (!bgCaptured && warmupFrames === BG_CAPTURE_FRAME && !skipBgGeneration) {
          bgCaptured = true;
          captureAndApplyBackground();
        }

        const previewFrame = wasAlreadyCached ? PREVIEW_CAPTURE_FRAME_CACHED : PREVIEW_CAPTURE_FRAME;
        if (!previewCaptured && warmupFrames === previewFrame) {
          previewCaptured = true;
          const shouldGeneratePreview = !storedSettingsRef?.preview;

          if (shouldGeneratePreview) {
            captureCurrentAssetPreview();
            const previewUrl = capturePreviewThumbnail();
            if (previewUrl) {
              const sizeKB = (previewUrl.length * 0.75 / 1024).toFixed(1);
              store.addLog(`Preview saved (${sizeKB} KB)`);
              // Use asset.name as key (works for both local files and source assets)
              savePreviewImage(asset.name, previewUrl).catch((err) => {
                console.warn('Failed to save preview:', err);
              });
            }
          } else {
            captureCurrentAssetPreview();
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
        // Process entries (files and folders)
        const processedFiles = await processEntries(entries);
        files.push(...processedFiles);
      } else {
        // Fallback to regular file list
        const fileList = event.dataTransfer?.files;
        if (fileList) {
          files.push(...Array.from(fileList));
        }
      }
    } else {
      // Fallback to regular file list
      const fileList = event.dataTransfer?.files;
      if (fileList) {
        files.push(...Array.from(fileList));
      }
    }
    
    if (files.length > 0) {
      await handleMultipleFiles(files);
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
  spark.update({ scene });

  // Update store with assets
  store.setAssets(result.assets);
  
  if (result.count === 1) {
    // Single file - load directly
    setCurrentAssetIndexManager(0);
    store.setCurrentAssetIndex(0);
    await loadSplatFile(result.assets[0]);
  } else {
    // Multiple files - show gallery and start loading
    store.addLog(`Found ${result.count} assets`);
    
    // Load stored previews from IndexedDB for all assets
    const { loadFileSettings } = await import('./fileStorage.js');
    for (let i = 0; i < result.assets.length; i++) {
      const asset = result.assets[i];
      const storedSettings = await loadFileSettings(asset.name);
      if (storedSettings?.preview && !asset.preview) {
        asset.preview = storedSettings.preview;
        asset.previewSource = 'indexeddb';
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
 * Loads a specific asset by index.
 * Called from AssetGallery component when user clicks a thumbnail.
 * @param {number} index - Asset index to load
 */
/**
 * Adds files to the existing asset list.
 */
export const handleAddFiles = async (files) => {
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
  const { loadFileSettings } = await import('./fileStorage.js');
  
  const startIndex = allAssets.length - result.added;
  
  for (let i = 0; i < result.newAssets.length; i++) {
    const asset = result.newAssets[i];
    const globalIndex = startIndex + i;
    
    const storedSettings = await loadFileSettings(asset.name);
    if (storedSettings?.preview && !asset.preview) {
      asset.preview = storedSettings.preview;
      asset.previewSource = 'indexeddb';
      store.updateAssetPreview(globalIndex, asset.preview);
    }
  }
};

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
export const loadFromStorageSource = async (source) => {
  const store = getStoreState();
  
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
      store.clearActiveSource();
      return;
    }
    
    // Reset current state
    resetSplatManager();
    setCurrentMesh(null);
    spark.update({ scene });
    
    // Clear background
    updateBackgroundImage(null);
    const pageEl = document.querySelector(".page");
    if (pageEl) {
      pageEl.classList.remove("has-glow");
    }
    
    // Set the adapted assets in the asset manager
    const result = setAdaptedAssets(adaptedAssets);
    
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
        if (!asset.preview) {
          const preview = await loadAssetPreview(asset);
          if (preview) {
            asset.preview = preview;
            store.updateAssetPreview(i, preview);
          }
        }
      }
    };
    loadPreviews(); // Don't await, run in background
    
    // Load first asset
    if (result.assets.length > 0) {
      setCurrentAssetIndexManager(0);
      store.setCurrentAssetIndex(0);
      await loadSplatFile(result.assets[0]);
    }
    
  } catch (error) {
    console.error('Failed to load from storage source:', error);
    store.setStatus(`Failed to load from ${source.name}: ${error.message}`);
    store.clearActiveSource();
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
