/**
 * Cloudflare R2 API helpers for bucket exploration
 * Standalone functions to list and inspect bucket contents
 * before creating a full source connection.
 */

import {
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSupportedExtensions } from '../formats/index.js';
import { loadR2ManifestCache } from './r2Settings.js';
import { getR2Client, buildR2Endpoint } from './r2Client.js';

const normalizePrefixId = (prefix) => {
  if (!prefix) return '';
  return prefix.replace(/^collections\//, '').replace(/\/$/, '');
};

const listAllObjects = async (client, bucket, options = {}) => {
  const results = [];
  let continuationToken = undefined;
  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      ...options,
      ContinuationToken: continuationToken,
    });
    const response = await client.send(command);
    if (response?.Contents?.length) {
      results.push(...response.Contents);
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
  return results;
};

/**
 * List all collection folders in the bucket under `collections/`
 * Returns array of { id, name, assetCount, hasManifest }
 */
export async function listExistingCollections({ accountId, accessKeyId, secretAccessKey, bucket }) {
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return { success: false, error: 'Missing R2 configuration', collections: [] };
  }

  try {
    const client = getR2Client({ accountId, accessKeyId, secretAccessKey });

    const listResponse = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: 'collections/',
      Delimiter: '/',
      MaxKeys: 1000,
    }));

    const prefixes = listResponse?.CommonPrefixes || [];
    if (!prefixes.length) {
      return { success: true, collections: [] };
    }

    const supportedExtensions = getSupportedExtensions();
    const collections = [];

    for (const prefixEntry of prefixes) {
      const collectionId = normalizePrefixId(prefixEntry?.Prefix);
      if (!collectionId) continue;

      const basePath = `collections/${collectionId}`;
      let assetCount = 0;
      let collectionName = collectionId;

      const cachedManifest = loadR2ManifestCache({ accountId, bucket, collectionId });
      let hasManifest = Boolean(cachedManifest);

      if (cachedManifest) {
        assetCount = cachedManifest.assets?.length || 0;
        if (cachedManifest.name) collectionName = cachedManifest.name;
      } else {
        const manifestProbe = await client.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: `${basePath}/manifest.json`,
          MaxKeys: 1,
        }));
        hasManifest = Boolean(manifestProbe?.Contents?.length);

        const assetFiles = await listAllObjects(client, bucket, {
          Prefix: `${basePath}/assets/`,
          MaxKeys: 1000,
        });
        assetCount = assetFiles.filter((entry) => {
          const key = entry?.Key || '';
          const ext = key.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
          return supportedExtensions.includes(ext);
        }).length;
      }

      collections.push({
        id: collectionId,
        name: collectionName,
        assetCount,
        hasManifest,
      });
    }

    return { success: true, collections };
  } catch (err) {
    return { success: false, error: err.message, collections: [] };
  }
}

/**
 * Test bucket connection with current settings
 */
export async function testR2Connection({ accountId, accessKeyId, secretAccessKey, bucket }) {
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return { success: false, error: 'Missing configuration' };
  }

  try {
    const client = getR2Client({ accountId, accessKeyId, secretAccessKey });
    const permissions = {
      canRead: false,
      canWrite: false,
      canDelete: false,
    };

    try {
      await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
      permissions.canRead = true;
    } catch {
      // Read is required to use this source; keep false and return below.
    }

    let probeKey = null;
    try {
      probeKey = `__cap_probe_${Date.now()}.txt`;
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: probeKey,
        Body: 'ok',
        ContentType: 'text/plain',
      }));
      permissions.canWrite = true;
    } catch {
      probeKey = null;
    }

    try {
      const deleteKey = probeKey || `__cap_delete_probe_${Date.now()}.txt`;
      const deleteResult = await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: [{ Key: deleteKey }], Quiet: true },
      }));
      permissions.canDelete = !(deleteResult?.Errors?.length);
    } catch {
      permissions.canDelete = false;
    }

    if (!permissions.canRead) {
      return {
        success: false,
        error: 'Connected, but missing read/list permission for this bucket.',
        permissions,
      };
    }

    return {
      success: true,
      endpoint: buildR2Endpoint(accountId),
      permissions,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
