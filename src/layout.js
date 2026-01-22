/**
 * Viewer layout utilities: sizing, aspect handling, projection application.
 */
import { useStore } from "./store.js";
import {
  renderer,
  camera,
  controls,
  defaultCamera,
  defaultControls,
  activeCamera,
  requestRender,
  setOriginalImageAspect,
  originalImageAspect,
  THREE,
} from "./viewer.js";

/** Page padding in pixels */
const PAGE_PADDING = 36;

/** Mobile sheet closed height (handle visible) */
const MOBILE_SHEET_CLOSED_HEIGHT = 50;

/** Mobile sheet open height as percentage of viewport (matches CSS max-height in portrait mode) */
const MOBILE_SHEET_OPEN_HEIGHT_VH = 40;

/** Accesses Zustand store state */
const getStoreState = () => useStore.getState();

// Build projection matrix from intrinsics
const makeProjectionFromIntrinsics = ({ fx, fy, cx, cy, width, height, near, far }) => {
  const left = (-cx * near) / fx;
  const right = ((width - cx) * near) / fx;
  const top = (cy * near) / fy;
  const bottom = (-(height - cy) * near) / fy;

  return new THREE.Matrix4().set(
    (2 * near) / (right - left),
    0,
    (right + left) / (right - left),
    0,
    0,
    (2 * near) / (top - bottom),
    (top + bottom) / (top - bottom),
    0,
    0,
    0,
    -(far + near) / (far - near),
    (-2 * far * near) / (far - near),
    0,
    0,
    -1,
    0,
  );
};

export const applyCameraProjection = (cameraMetadata, viewportWidth, viewportHeight) => {
  const { intrinsics, near, far } = cameraMetadata;
  const sx = viewportWidth / intrinsics.imageWidth;
  const sy = viewportHeight / intrinsics.imageHeight;
  const s = Math.min(sx, sy);
  const scaledWidth = intrinsics.imageWidth * s;
  const scaledHeight = intrinsics.imageHeight * s;
  const offsetX = (viewportWidth - scaledWidth) * 0.5;
  const offsetY = (viewportHeight - scaledHeight) * 0.5;

  const fx = intrinsics.fx * s;
  const fy = intrinsics.fy * s;
  const cx = intrinsics.cx * s + offsetX;
  const cy = intrinsics.cy * s + offsetY;

  camera.aspect = viewportWidth / viewportHeight;
  camera.fov = THREE.MathUtils.radToDeg(
    2 * Math.atan(viewportHeight / (2 * Math.max(1e-6, fy))),
  );
  camera.near = near;
  camera.far = far;

  const fovScale = THREE.MathUtils.clamp(camera.fov / defaultCamera.fov, 0.05, 2.0);
  controls.rotateSpeed = Math.max(0.02, defaultControls.rotateSpeed * fovScale * 0.45);
  controls.zoomSpeed = Math.max(0.05, defaultControls.zoomSpeed * fovScale * 0.8);
  controls.panSpeed = Math.max(0.05, defaultControls.panSpeed * fovScale * 0.8);

  const projection = makeProjectionFromIntrinsics({
    fx,
    fy,
    cx,
    cy,
    width: viewportWidth,
    height: viewportHeight,
    near,
    far,
  });
  camera.projectionMatrix.copy(projection);
  camera.projectionMatrixInverse.copy(projection).invert();
};

export const applyIntrinsicsAspect = (entry) => {
  const intrinsics = entry?.cameraMetadata?.intrinsics;
  if (!intrinsics || !intrinsics.imageWidth || !intrinsics.imageHeight) return;
  const aspect = intrinsics.imageWidth / intrinsics.imageHeight;
  setOriginalImageAspect(aspect);
  updateViewerAspectRatio();
  requestRender();
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
  const fullscreenRoot = document.getElementById('app');
  const isFullscreen = document.fullscreenElement === fullscreenRoot;
  
  let availableWidth = Math.max(0, window.innerWidth - (isFullscreen ? 0 : PAGE_PADDING));
  let availableHeight = Math.max(0, window.innerHeight - (isFullscreen ? 0 : PAGE_PADDING));
  
  // In mobile portrait mode, subtract the mobile sheet height from available space
  if (!isFullscreen && isMobile && isPortrait) {
    // Always use closed height to prevent viewer resize/camera reset when opening sheet
    // The sheet will overlay the bottom of the viewer
    const sheetHeight = MOBILE_SHEET_CLOSED_HEIGHT;
    availableHeight = Math.max(0, window.innerHeight - sheetHeight - (PAGE_PADDING / 2));
  }

  if (isFullscreen) {
    viewerEl.style.width = `${availableWidth}px`;
    viewerEl.style.height = `${availableHeight}px`;
    return;
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
  if (!renderer) return;
  
  updateViewerAspectRatio();
  const { clientWidth, clientHeight } = viewerEl;
  renderer.setSize(clientWidth, clientHeight, false);
  
  if (activeCamera && activeCamera?.cameraMetadata) {
    applyCameraProjection(activeCamera.cameraMetadata, clientWidth, clientHeight);
  } else if (activeCamera) {
    applyCameraProjection(activeCamera, clientWidth, clientHeight);
  } else {
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  }
  requestRender();
};
