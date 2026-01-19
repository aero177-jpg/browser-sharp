/**
 * Storage Module Index
 * 
 * Re-exports all storage-related functionality for convenient imports.
 */

// Types and constants
export {
  SOURCE_TIERS,
  MANIFEST_VERSION,
  SUPPORTED_MANIFEST_VERSIONS,
  isFileSystemAccessSupported,
  createSourceId,
} from './types.js';

// Base class
export { AssetSource } from './AssetSource.js';

// Source adapters
export { 
  LocalFolderSource, 
  createLocalFolderSource, 
  restoreLocalFolderSource,
} from './LocalFolderSource.js';

export { 
  PublicUrlSource, 
  createPublicUrlSource, 
  restorePublicUrlSource,
} from './PublicUrlSource.js';

export {
  SupabaseStorageSource,
  createSupabaseStorageSource,
  restoreSupabaseStorageSource,
} from './SupabaseStorageSource.js';

// Import restore functions for local use in restoreSource()
import { restoreLocalFolderSource as _restoreLocalFolderSource } from './LocalFolderSource.js';
import { restorePublicUrlSource as _restorePublicUrlSource } from './PublicUrlSource.js';
import { restoreSupabaseStorageSource as _restoreSupabaseStorageSource } from './SupabaseStorageSource.js';
import { createPublicUrlSource as _createPublicUrlSource } from './PublicUrlSource.js';

// Source manager - import for local use
import {
  loadAllSources as _loadAllSources,
  registerSource as _registerSource,
  saveSource as _saveSource,
} from './sourceManager.js';

// Source manager - re-export
export {
  saveSource,
  loadSource,
  loadAllSources,
  deleteSource,
  registerSource,
  unregisterSource,
  getSource,
  getAllSources,
  getSourcesArray,
  onSourceChange,
  clearAllSources,
  touchSource,
  setDefaultSource,
  getDefaultSourceId,
  saveDirectoryHandle,
  loadDirectoryHandle,
} from './sourceManager.js';

// Source asset adapter
export {
  adaptRemoteAsset,
  loadAssetFile,
  loadAssetPreview,
  loadAssetMetadata,
  isSourceAsset,
  loadSourceAssets,
  loadAllSourceAssets,
} from './sourceAssetAdapter.js';


/**
 * Restore a source from persisted config based on its type.
 * @param {Object} config - Persisted source configuration
 * @returns {import('./AssetSource.js').AssetSource | null}
 */
export const restoreSource = (config) => {
  if (!config || !config.type) return null;

  switch (config.type) {
    case 'local-folder':
      return _restoreLocalFolderSource(config);
    case 'public-url':
      return _restorePublicUrlSource(config);
    case 'supabase-storage':
      return _restoreSupabaseStorageSource(config);
    default:
      console.warn(`Unknown source type: ${config.type}`);
      return null;
  }
};

/**
 * Initialize all persisted sources on app startup.
 * Restores sources from IndexedDB and attempts to reconnect.
 * @returns {Promise<import('./AssetSource.js').AssetSource[]>}
 */
export const initializeSources = async () => {
  const configs = await _loadAllSources();
  console.log('[Storage] Found persisted configs:', configs);
  const sources = [];

  for (const config of configs) {
    const source = restoreSource(config);
    if (source) {
      _registerSource(source);
      sources.push(source);
      console.log('[Storage] Restored source:', source.id, source.name);
    }
  }

  return sources;
};
