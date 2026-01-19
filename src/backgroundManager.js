/**
 * Background manager centralizes preview/blur application and animation hand-off.
 * Keeps background updates in one place so loaders only request set/clear/capture.
 */
import { setBgImageUrl, updateBackgroundImage, requestRender, renderer, scene, THREE } from './viewer.js';
import { getAssetList } from './assetManager.js';

const isObjectUrl = (value) => typeof value === 'string' && value.startsWith('blob:');
let lastBgObjectUrl = null;

const isUrlInAssetPreviews = (url) => {
  if (!url) return false;
  try {
    return getAssetList().some((asset) => asset?.preview === url);
  } catch {
    return false;
  }
};

// Revoke the given blob URL after a short delay to avoid breaking in-flight loads
const scheduleRevoke = (url) => {
  if (!url || !isObjectUrl(url)) return;
  // Give the browser time to fetch/use the URL before revoking
  setTimeout(() => {
    // Only revoke if it is no longer the active one
    if (url !== lastBgObjectUrl && !isUrlInAssetPreviews(url)) {
      URL.revokeObjectURL(url);
    }
  }, 1200);
};

/** Apply (or clear) the viewer background image. */
export const applyBackground = (url) => {
  const prev = lastBgObjectUrl;
  if (!url) {
    lastBgObjectUrl = null;
    setBgImageUrl(null);
    updateBackgroundImage(null);
    if (scene && renderer) {
      scene.background = null;
      renderer.setClearColor(0x000000, 0);
    }
    requestRender();
    // Revoke the previous URL after a delay (avoid killing pending loads)
    scheduleRevoke(prev);
    return null;
  }

  if (isObjectUrl(url)) {
    lastBgObjectUrl = url;
  } else {
    lastBgObjectUrl = null;
  }

  setBgImageUrl(url);
  updateBackgroundImage(url);
  if (scene && renderer) {
    // Keep the Three.js canvas transparent so the CSS background shows through
    scene.background = null;
    renderer.setClearColor(new THREE.Color(0x000000), 0);
  }
  requestRender();

  // Revoke the previous URL after a delay (do not revoke the active one)
  if (prev && prev !== url) {
    scheduleRevoke(prev);
  }

  return url;
};

/** Convenience to clear background explicitly. */
export const clearBackground = () => applyBackground(null);

/** Apply a preview image as the background. */
export const applyPreviewBackground = (previewUrl) => applyBackground(previewUrl);

/**
 * Capture a blurred background from the renderer and apply it.
 * Returns the data URL used for the background (JPEG).
 */
export const captureAndApplyBackground = ({ renderer, composer, scene, THREE, backgroundColor = '#0c1018', quality = 0.9 }) => {
  if (!renderer || !composer || !scene || !THREE) return null;

  const originalBg = scene.background;
  const clearColor = new THREE.Color();
  renderer.getClearColor(clearColor);
  const clearAlpha = renderer.getClearAlpha();

  scene.background = new THREE.Color(backgroundColor);
  renderer.setClearColor(backgroundColor, 1);
  composer.render();

  const canvas = renderer.domElement;

  const finish = (blob, url) => {
    scene.background = originalBg;
    renderer.setClearColor(clearColor, clearAlpha);
    const appliedUrl = applyBackground(url);
    return { url: appliedUrl, blob };
  };

  return new Promise((resolve) => {
    const tryJpeg = () => {
      canvas.toBlob((jpegBlob) => {
        if (jpegBlob) {
          const objectUrl = URL.createObjectURL(jpegBlob);
          resolve(finish(jpegBlob, objectUrl));
        } else {
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(finish(null, dataUrl));
        }
      }, 'image/jpeg', quality);
    };

    canvas.toBlob((webpBlob) => {
      if (webpBlob) {
        const objectUrl = URL.createObjectURL(webpBlob);
        resolve(finish(webpBlob, objectUrl));
      } else {
        tryJpeg();
      }
    }, 'image/webp', quality * 0.6);
  });
};
