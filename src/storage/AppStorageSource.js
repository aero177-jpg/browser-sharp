/**
 * App Storage Source Adapter
 *
 * Stores collections inside the app's private filesystem (Capacitor Filesystem).
 * Collections persist across launches and work offline.
 */

import { AssetSource } from './AssetSource.js';
import { createSourceId, MANIFEST_VERSION, SUPPORTED_MANIFEST_VERSIONS } from './types.js';
import { saveSource } from './sourceManager.js';
import { getSupportedExtensions } from '../formats/index.js';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

const BASE_DIR = 'radia';
const COLLECTIONS_DIR = `${BASE_DIR}/collections`;

const stripLeadingSlash = (value) => (value || '').replace(/^\/+/, '');

const getExtension = (filename) => {
  const parts = filename.split('.');
  return parts.length > 1 ? `.${parts.pop().toLowerCase()}` : '';
};

const getFilename = (path) => {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
};

const base64ToArrayBuffer = (base64) => {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unexpected file reader result'));
        return;
      }
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
};

const ensureDirectory = async (path) => {
  if (!path) return;
  try {
    await Filesystem.mkdir({
      path,
      directory: Directory.Data,
      recursive: true,
    });
  } catch (err) {
    const message = err?.message || '';
    if (message.includes('EEXIST') || message.includes('exists')) {
      return;
    }
    throw err;
  }
};

export class AppStorageSource extends AssetSource {
  constructor(config) {
    super(config);
    this._manifest = null;
  }

  getCapabilities() {
    return {
      canList: true,
      canStream: false,
      canReadMetadata: false,
      canReadPreviews: false,
      persistent: true,
      writable: true,
    };
  }

  _collectionRoot() {
    return `${COLLECTIONS_DIR}/${this.config.config.collectionId}`;
  }

  _assetsRoot() {
    return `${this._collectionRoot()}/assets`;
  }

  _manifestPath() {
    return `${this._collectionRoot()}/manifest.json`;
  }

  _assetFsPath(relativePath) {
    const safePath = stripLeadingSlash(relativePath);
    return `${this._collectionRoot()}/${safePath}`;
  }

  _remotePathForFileName(name) {
    return `assets/${name}`;
  }

  async connect() {
    try {
      if (!Capacitor.isNativePlatform() && typeof Filesystem?.readdir !== 'function') {
        return { success: false, error: 'App storage is not available in this environment' };
      }

      await ensureDirectory(COLLECTIONS_DIR);
      await ensureDirectory(this._collectionRoot());
      await ensureDirectory(this._assetsRoot());

      await this._loadManifest();
      await this._ensureManifestLoaded();

      this._connected = true;
      await saveSource(this.toJSON());
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _loadManifest() {
    try {
      const { data } = await Filesystem.readFile({
        path: this._manifestPath(),
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });

      const manifest = JSON.parse(data || '{}');
      if (!SUPPORTED_MANIFEST_VERSIONS.includes(manifest.version)) {
        throw new Error(`Unsupported manifest version: ${manifest.version}`);
      }

      this._manifest = manifest;

      if (manifest.name) {
        this.name = manifest.name;
        this.config.name = manifest.name;
      }
      return manifest;
    } catch (error) {
      this._manifest = null;
      return null;
    }
  }

  async _saveManifest(manifest) {
    const payload = JSON.stringify(manifest, null, 2);
    await Filesystem.writeFile({
      path: this._manifestPath(),
      directory: Directory.Data,
      data: payload,
      encoding: Encoding.UTF8,
    });
    this._manifest = manifest;
    await saveSource(this.toJSON());
  }

  async _ensureManifestLoaded() {
    if (!this._manifest) {
      const manifest = {
        version: MANIFEST_VERSION,
        name: this.config.config.collectionName || this.config.name,
        assets: [],
      };
      await this._saveManifest(manifest);
    }
    return this._manifest;
  }

  async listAssets() {
    if (!this._connected) {
      throw new Error('Not connected');
    }

    await this._ensureManifestLoaded();
    const supportedExtensions = getSupportedExtensions();
    const assets = [];

    if (this._manifest?.assets?.length) {
      for (const item of this._manifest.assets) {
        const ext = getExtension(item.path);
        if (!supportedExtensions.includes(ext)) continue;

        assets.push({
          id: `${this.id}/${item.path}`,
          name: item.name || getFilename(item.path),
          path: item.path,
          sourceId: this.id,
          sourceType: this.type,
          size: item.size,
          preview: item.preview || null,
          previewSource: item.preview ? 'local' : null,
          metadata: item.metadata,
          loaded: false,
        });
      }
    } else {
      try {
        const result = await Filesystem.readdir({
          path: this._assetsRoot(),
          directory: Directory.Data,
        });

        for (const entry of result.files || []) {
          const name = typeof entry === 'string' ? entry : entry.name;
          if (!name) continue;
          const ext = getExtension(name);
          if (!supportedExtensions.includes(ext)) continue;

          assets.push({
            id: `${this.id}/${name}`,
            name,
            path: this._remotePathForFileName(name),
            sourceId: this.id,
            sourceType: this.type,
            preview: null,
            previewSource: null,
            loaded: false,
          });
        }
      } catch (error) {
        console.warn('Failed to list app storage assets:', error);
      }
    }

    assets.sort((a, b) => a.name.localeCompare(b.name));
    this._assets = assets;
    return assets;
  }

  async fetchAssetData(asset) {
    const fsPath = this._assetFsPath(asset.path);
    const { data } = await Filesystem.readFile({
      path: fsPath,
      directory: Directory.Data,
    });
    const base64 = typeof data === 'string' ? data : data?.data;
    if (!base64) {
      throw new Error(`Failed to read asset data: ${asset.path}`);
    }
    return base64ToArrayBuffer(base64);
  }

  async fetchAssetFile(asset) {
    const data = await this.fetchAssetData(asset);
    const name = asset.name || getFilename(asset.path);
    return new File([data], name, { type: 'application/octet-stream' });
  }

  /**
   * Import files into app storage and update manifest.
   * @param {File[]} files
   * @returns {Promise<{success: boolean, error?: string, imported?: number}>}
   */
  async importFiles(files) {
    try {
      if (!files?.length) return { success: true, imported: 0 };
      if (!this._connected) {
        const result = await this.connect();
        if (!result.success) return result;
      }

      const supportedExtensions = getSupportedExtensions();
      const valid = files.filter((file) => supportedExtensions.includes(getExtension(file.name)));
      if (valid.length === 0) {
        return { success: false, error: 'No supported files selected.' };
      }

      await this._ensureManifestLoaded();
      const manifest = this._manifest || { version: MANIFEST_VERSION, assets: [] };

      const updatedAssets = Array.isArray(manifest.assets) ? [...manifest.assets] : [];

      for (const file of valid) {
        const base64 = await fileToBase64(file);
        const remotePath = this._remotePathForFileName(file.name);
        const fsPath = this._assetFsPath(remotePath);

        await Filesystem.writeFile({
          path: fsPath,
          directory: Directory.Data,
          data: base64,
        });

        const existingIndex = updatedAssets.findIndex((item) => item.path === remotePath);
        const entry = {
          path: remotePath,
          name: file.name,
          size: file.size,
        };

        if (existingIndex >= 0) {
          updatedAssets.splice(existingIndex, 1, entry);
        } else {
          updatedAssets.push(entry);
        }
      }

      manifest.assets = updatedAssets;
      if (!manifest.name) {
        manifest.name = this.config.config.collectionName || this.config.name;
      }
      await this._saveManifest(manifest);
      return { success: true, imported: valid.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

/**
 * Create a new AppStorageSource with a fresh ID.
 * @param {{ id?: string, name?: string, collectionId?: string, collectionName?: string }} options
 * @returns {AppStorageSource}
 */
export const createAppStorageSource = (options = {}) => {
  const sourceId = options.id || createSourceId('app-storage');
  const collectionId = options.collectionId || sourceId;
  const name = options.name || options.collectionName || 'App Storage';

  const config = {
    id: sourceId,
    type: 'app-storage',
    name,
    createdAt: Date.now(),
    lastAccessed: Date.now(),
    isDefault: false,
    config: {
      collectionId,
      collectionName: options.collectionName || name,
    },
  };

  return new AppStorageSource(config);
};

/**
 * Restore an AppStorageSource from persisted config.
 * @param {Object} config
 * @returns {AppStorageSource}
 */
export const restoreAppStorageSource = (config) => {
  return new AppStorageSource(config);
};

export default AppStorageSource;