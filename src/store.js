/**
 * Zustand store - centralized application state.
 * 
 * Contains all UI state, camera settings, file info, and assets.
 * Components should use `useStore` hook to subscribe to state slices.
 * 
 * @example
 * // Subscribe to a single value
 * const fov = useStore((state) => state.fov);
 * 
 * @example
 * // Subscribe to an action
 * const setFov = useStore((state) => state.setFov);
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

/** Safely load a persisted boolean flag from localStorage */
const getPersistedBoolean = (key, fallback = false) => {
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null) return fallback;
    return stored === 'true';
  } catch (err) {
    console.warn(`[Store] Failed to read ${key} from localStorage`, err);
    return fallback;
  }
};

/** Safely load a persisted string from localStorage */
const getPersistedString = (key, fallback = '') => {
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null) return fallback;
    return stored;
  } catch (err) {
    console.warn(`[Store] Failed to read ${key} from localStorage`, err);
    return fallback;
  }
};

/** Safely load a persisted number from localStorage */
const getPersistedNumber = (key, fallback = 0) => {
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null) return fallback;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch (err) {
    console.warn(`[Store] Failed to read ${key} from localStorage`, err);
    return fallback;
  }
};

/** Default state for mobile devtools.
 * - Default: OFF (safety-first)
 * - Persisted user preference is still respected, but Eruda will not auto-init
 *   on app startup — explicit user toggle (approval) is required to initialize.
 */
const defaultDevtoolsEnabled = getPersistedBoolean('mobileDevtoolsEnabled', false);

const QUALITY_PRESET_KEY = 'qualityPreset';
const DEBUG_STOCHASTIC_KEY = 'debugStochasticRendering';
const DEBUG_SPARK_STDDEV_KEY = 'debugSparkMaxStdDev';
const DEBUG_FPS_LIMIT_KEY = 'debugFpsLimitEnabled';

const QUALITY_PRESETS = {
  high: { stdDev: 7, stochastic: false, fpsLimit: true },
  default: { stdDev: 5, stochastic: false, fpsLimit: true },
  performance: { stdDev: 2.5, stochastic: false, fpsLimit: false },
  experimental: { stdDev: 1.8, stochastic: true, fpsLimit: false },
};

const persistedQualityPreset = getPersistedString(QUALITY_PRESET_KEY, 'default');
const persistedCustomStdDev = getPersistedNumber(DEBUG_SPARK_STDDEV_KEY, Math.sqrt(5));
const persistedCustomStochastic = getPersistedBoolean(DEBUG_STOCHASTIC_KEY, false);
const persistedCustomFpsLimit = getPersistedBoolean(DEBUG_FPS_LIMIT_KEY, true);

const resolveInitialQuality = (preset) => {
  if (QUALITY_PRESETS[preset]) return QUALITY_PRESETS[preset];
  if (preset === 'debug-custom') {
    return {
      stdDev: persistedCustomStdDev,
      stochastic: persistedCustomStochastic,
      fpsLimit: persistedCustomFpsLimit,
    };
  }
  return QUALITY_PRESETS.default;
};

const initialQuality = resolveInitialQuality(persistedQualityPreset);


/** Maximum number of log entries to keep */
const MAX_LOG_ENTRIES = 14;

/** Default file info values */
const DEFAULT_FILE_INFO = {
  name: '-',
  size: '-',
  splatCount: '-',
  loadTime: '-',
  bounds: '-',
};

export const useStore = create(
  subscribeWithSelector((set, get) => ({
  // Camera settings
  fov: 60,
  cameraRange: 8,
  dollyZoomEnabled: true,
  viewerFovSlider: false,
  stereoEnabled: false,
  stereoEyeSep: 0.064,
  stereoAspect: 1.0,
  vrSupported: false,
  vrSessionActive: false,
  vrModelScale: 1,

  // Animation settings
  animationEnabled: true,
  animationIntensity: 'medium',
  animationDirection: 'left',
  slideMode: 'horizontal',
  slideshowMode: false,
  slideshowUseCustom: false,
  slideshowDuration: 3,
  slideshowPlaying: false,
  
  // Custom animation settings (used when intensity is 'custom')
  customAnimation: {
    duration: 2.5,
    rotation: 30,
    rotationType: 'left',
    zoom: 1.0,
    zoomType: 'out',
    easing: 'ease-in-out',
    dollyZoom: false,
  },

  // Custom focus state
  hasCustomFocus: false,
  focusDistanceOverride: null,
  focusSettingActive: false,
  // Custom camera metadata state
  metadataMissing: false,
  customMetadataAvailable: false,
  customMetadataControlsVisible: false,
  customModelScale: 1,
  // Show FPS counter overlay
  showFps: false,

  // File info
  fileInfo: DEFAULT_FILE_INFO,

  // Status
  status: 'Waiting for file...',
  isLoading: false,

  // Assets
  assets: [],
  currentAssetIndex: -1,

  // Active storage collection
  activeSourceId: null,

  // Logs
  logs: [],

  // UI state
  panelOpen: false,
  assetSidebarOpen: false,
  logExpanded: false,
  animSettingsExpanded: false,
  cameraSettingsExpanded: true,
  galleryExpanded: true,
  
  // Mobile state - initialize with actual values to prevent flash on load
  isMobile: typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) <= 768,
  isPortrait: typeof window !== 'undefined' && window.innerHeight > window.innerWidth,
  immersiveMode: false,
  immersiveSensitivity: 1.0,
  mobileDevtoolsEnabled: defaultDevtoolsEnabled,
  bgBlur: 40,
  
  // Debug
  debugLoadingMode: false,
  debugSettingsExpanded: false,
  debugStochasticRendering: initialQuality.stochastic,
  debugFpsLimitEnabled: initialQuality.fpsLimit,
  debugSparkMaxStdDev: initialQuality.stdDev,
  qualityPreset: (QUALITY_PRESETS[persistedQualityPreset] || persistedQualityPreset === 'debug-custom')
    ? persistedQualityPreset
    : 'default',

  // ============ Actions ============
  
  /** Sets camera field of view */
  setFov: (fov) => set({ fov }),

  /** Shows/hides the viewer FOV slider overlay */
  setViewerFovSlider: (visible) => set({ viewerFovSlider: visible }),

  /** Toggles the viewer FOV slider overlay */
  toggleViewerFovSlider: () => set((state) => ({ viewerFovSlider: !state.viewerFovSlider })),
  
  /** Sets camera orbit range in degrees */
  setCameraRange: (range) => set({ cameraRange: range }),
  
  /** Enables/disables dolly zoom compensation */
  setDollyZoomEnabled: (enabled) => set({ dollyZoomEnabled: enabled }),

  /** Enables/disables side-by-side stereo rendering */
  setStereoEnabled: (enabled) => set({ stereoEnabled: enabled }),

  /** Sets stereo eye separation distance */
  setStereoEyeSep: (eyeSep) => set({ stereoEyeSep: eyeSep }),

  /** Sets stereo aspect ratio */
  setStereoAspect: (aspect) => set({ stereoAspect: aspect }),

  /** Marks whether WebXR/VR is available */
  setVrSupported: (vrSupported) => set({ vrSupported }),

  /** Tracks if a VR session is active */
  setVrSessionActive: (vrSessionActive) => set({ vrSessionActive }),

  /** Tracks model scale while in VR */
  setVrModelScale: (vrModelScale) => set({ vrModelScale }),
  
  /** Enables/disables load animation */
  setAnimationEnabled: (enabled) => set({ animationEnabled: enabled }),
  
  /** Sets animation intensity preset */
  setAnimationIntensity: (intensity) => set({ animationIntensity: intensity }),
  
  /** Sets animation sweep direction */
  setAnimationDirection: (direction) => set({ animationDirection: direction }),
  
  /** Sets slide transition mode */
  setSlideMode: (mode) => set({ slideMode: mode }),
  
  /** Enables/disables slideshow mode */
  setSlideshowMode: (enabled) => set({ slideshowMode: enabled }),

  /** Enables/disables custom slideshow transitions */
  setSlideshowUseCustom: (enabled) => set({ slideshowUseCustom: enabled }),
  
  /** Sets slideshow hold duration in seconds */
  setSlideshowDuration: (duration) => set({ slideshowDuration: duration }),
  
  /** Sets slideshow playing state */
  setSlideshowPlaying: (playing) => set({ slideshowPlaying: playing }),
  
  /** Updates custom animation settings (merges with existing) */
  setCustomAnimation: (settings) => set((state) => ({
    customAnimation: { ...state.customAnimation, ...settings }
  })),

  /** Sets custom focus state */
  setHasCustomFocus: (hasCustomFocus) => set({ hasCustomFocus }),
  setFocusDistanceOverride: (focusDistanceOverride) => set({ focusDistanceOverride }),
  setFocusSettingActive: (focusSettingActive) => set({ focusSettingActive }),

  /** Custom metadata flags */
  setMetadataMissing: (metadataMissing) => set({ metadataMissing }),
  setCustomMetadataAvailable: (customMetadataAvailable) => set({ customMetadataAvailable }),
  setCustomMetadataControlsVisible: (customMetadataControlsVisible) => set({ customMetadataControlsVisible }),
  setCustomModelScale: (customModelScale) => set({ customModelScale }),
  
  /** Updates file info (merges with existing) */
  setFileInfo: (info) => set((state) => ({ 
    fileInfo: { ...state.fileInfo, ...info } 
  })),
  
  /** Resets file info to defaults */
  resetFileInfo: () => set({ fileInfo: DEFAULT_FILE_INFO }),
  
  /** Sets status message and logs it */
  setStatus: (status) => {
    set({ status });
    get().addLog(status);
  },
  
  /** Sets loading state */
  setIsLoading: (isLoading) => set({ isLoading }),
  
  /** Adds a timestamped log entry */
  addLog: (message) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${message}`;
    set((state) => ({
      logs: [entry, ...state.logs.slice(0, MAX_LOG_ENTRIES - 1)]
    }));
    console.info(message);
  },
  
  /** Sets the loaded assets array */
  setAssets: (assets) => set({ assets }),
  
  /** Sets current asset index */
  setCurrentAssetIndex: (index) => set({ currentAssetIndex: index }),
  
  /** Updates preview thumbnail for an asset */
  updateAssetPreview: (index, preview) => set((state) => ({
    assets: state.assets.map((asset, i) => 
      i === index ? { ...asset, preview } : asset
    )
  })),
  
  /** Sets panel open state */
  setPanelOpen: (open) => set({ panelOpen: open }),

  /** Sets asset sidebar open state */
  setAssetSidebarOpen: (open) => set({ assetSidebarOpen: open }),

  /** Toggles asset sidebar open/closed */
  toggleAssetSidebar: () => set((state) => ({ assetSidebarOpen: !state.assetSidebarOpen })),
  
  /** Toggles panel open/closed */
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
  
  /** Sets log panel expanded state */
  setLogExpanded: (expanded) => set({ logExpanded: expanded }),
  
  /** Toggles log panel expanded */
  toggleLogExpanded: () => set((state) => ({ logExpanded: !state.logExpanded })),
  
  /** Sets animation settings expanded state */
  setAnimSettingsExpanded: (expanded) => set({ animSettingsExpanded: expanded }),
  
  /** Toggles animation settings expanded */
  toggleAnimSettingsExpanded: () => set((state) => ({ 
    animSettingsExpanded: !state.animSettingsExpanded 
  })),
  
  /** Toggles camera settings expanded */
  toggleCameraSettingsExpanded: () => set((state) => ({ 
    cameraSettingsExpanded: !state.cameraSettingsExpanded 
  })),
  
  /** Toggles gallery expanded */
  toggleGalleryExpanded: () => set((state) => ({ 
    galleryExpanded: !state.galleryExpanded 
  })),

  /** Marks which storage source is currently in use */
  setActiveSourceId: (sourceId) => set({ activeSourceId: sourceId }),

  /** Clears active storage source (used for ad-hoc file loads) */
  clearActiveSource: () => set({ activeSourceId: null }),
  
  /** Sets mobile state */
  setMobileState: (isMobile, isPortrait) => set({ isMobile, isPortrait }),
  
  /** Sets immersive mode */
  setImmersiveMode: (enabled) => set({ immersiveMode: enabled }),
  
  /** Toggles immersive mode */
  toggleImmersiveMode: () => set((state) => ({ immersiveMode: !state.immersiveMode })),
  
  /** Sets immersive mode sensitivity multiplier */
  setImmersiveSensitivity: (sensitivity) => set({ immersiveSensitivity: sensitivity }),

  /** Sets visibility of FPS counter overlay */
  setShowFps: (show) => set({ showFps: show }),

  /** Enables/disables mobile devtools (Eruda) and persists preference */
  setMobileDevtoolsEnabled: (enabled) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem('mobileDevtoolsEnabled', String(enabled));
      } catch (err) {
        console.warn('[Store] Failed to persist mobileDevtoolsEnabled', err);
      }
    }
    set({ mobileDevtoolsEnabled: enabled });
  },

  /** Sets blur amount for background container */
  setBgBlur: (bgBlur) => set({ bgBlur }),

  /** Enables/disables stochastic rendering in Spark */
  setDebugStochasticRendering: (enabled) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(DEBUG_STOCHASTIC_KEY, String(enabled));
      } catch (err) {
        console.warn('[Store] Failed to persist debugStochasticRendering', err);
      }
    }
    set({ debugStochasticRendering: enabled });
  },

  /** Enables/disables FPS limiting in the render loop */
  setDebugFpsLimitEnabled: (enabled) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(DEBUG_FPS_LIMIT_KEY, String(enabled));
      } catch (err) {
        console.warn('[Store] Failed to persist debugFpsLimitEnabled', err);
      }
    }
    set({ debugFpsLimitEnabled: enabled });
  },

  /** Sets Spark splat maxStdDev (rendering width) */
  setDebugSparkMaxStdDev: (value) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(DEBUG_SPARK_STDDEV_KEY, String(value));
      } catch (err) {
        console.warn('[Store] Failed to persist debugSparkMaxStdDev', err);
      }
    }
    set({ debugSparkMaxStdDev: value });
  },

  /** Sets rendering quality preset and persists it */
  setQualityPreset: (preset) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(QUALITY_PRESET_KEY, String(preset));
      } catch (err) {
        console.warn('[Store] Failed to persist qualityPreset', err);
      }
    }
    if (QUALITY_PRESETS[preset]) {
      const { stdDev, stochastic, fpsLimit } = QUALITY_PRESETS[preset];
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem(DEBUG_SPARK_STDDEV_KEY, String(stdDev));
          window.localStorage.setItem(DEBUG_STOCHASTIC_KEY, String(stochastic));
          window.localStorage.setItem(DEBUG_FPS_LIMIT_KEY, String(fpsLimit));
        } catch (err) {
          console.warn('[Store] Failed to persist quality preset values', err);
        }
      }
      set({
        qualityPreset: preset,
        debugSparkMaxStdDev: stdDev,
        debugStochasticRendering: stochastic,
        debugFpsLimitEnabled: fpsLimit,
      });
      return;
    }
    set({ qualityPreset: preset });
  },
  
  /** Toggles debug loading mode */
  toggleDebugLoadingMode: () => set((state) => ({ 
    debugLoadingMode: !state.debugLoadingMode 
  })),

  /** Toggles debug settings accordion */
  toggleDebugSettingsExpanded: () => set((state) => ({ 
    debugSettingsExpanded: !state.debugSettingsExpanded 
  })),
}))
);
