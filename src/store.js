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

export const useStore = create((set, get) => ({
  // Camera settings
  fov: 60,
  cameraRange: 8,
  dollyZoomEnabled: true,

  // Animation settings
  animationEnabled: true,
  animationIntensity: 'medium',
  animationDirection: 'left',

  // File info
  fileInfo: DEFAULT_FILE_INFO,

  // Status
  status: 'Waiting for file...',
  isLoading: false,

  // Assets
  assets: [],
  currentAssetIndex: -1,

  // Logs
  logs: [],

  // UI state
  panelOpen: false,
  logExpanded: false,
  animSettingsExpanded: false,
  cameraSettingsExpanded: true,
  galleryExpanded: true,
  
  // Mobile state
  isMobile: false,
  isPortrait: false,
  immersiveMode: false,
  
  // Debug
  debugLoadingMode: false,

  // ============ Actions ============
  
  /** Sets camera field of view */
  setFov: (fov) => set({ fov }),
  
  /** Sets camera orbit range in degrees */
  setCameraRange: (range) => set({ cameraRange: range }),
  
  /** Enables/disables dolly zoom compensation */
  setDollyZoomEnabled: (enabled) => set({ dollyZoomEnabled: enabled }),
  
  /** Enables/disables load animation */
  setAnimationEnabled: (enabled) => set({ animationEnabled: enabled }),
  
  /** Sets animation intensity preset */
  setAnimationIntensity: (intensity) => set({ animationIntensity: intensity }),
  
  /** Sets animation sweep direction */
  setAnimationDirection: (direction) => set({ animationDirection: direction }),
  
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
  
  /** Sets mobile state */
  setMobileState: (isMobile, isPortrait) => set({ isMobile, isPortrait }),
  
  /** Sets immersive mode */
  setImmersiveMode: (enabled) => set({ immersiveMode: enabled }),
  
  /** Toggles immersive mode */
  toggleImmersiveMode: () => set((state) => ({ immersiveMode: !state.immersiveMode })),
  
  /** Toggles debug loading mode */
  toggleDebugLoadingMode: () => set((state) => ({ 
    debugLoadingMode: !state.debugLoadingMode 
  })),
}));
