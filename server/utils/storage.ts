import { Storage } from '@google-cloud/storage';
import { getOrgSlugById } from '../../database/multi-tenant-pool.js';
import { getStorageBucket } from './env.js';

const BUCKET_NAME = getStorageBucket();

/**
 * Generate a signed URL for a file in Google Cloud Storage
 * @param storage - Storage instance
 * @param storagePath - Path to the file in storage
 * @param expirationDays - Number of days until URL expires (default: 365)
 * @returns Signed URL string
 */
export async function generateSignedUrl(
  storage: Storage,
  storagePath: string,
  expirationDays: number = 365
): Promise<string> {
  const bucket = storage.bucket(BUCKET_NAME);
  const file = bucket.file(storagePath);
  
  const expiresIn = expirationDays * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + expiresIn);
  
  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: expiresAt,
  });
  
  return signedUrl;
}

/**
 * Extract storage path from signed URL or construct from parameters
 * @param storage - Storage instance
 * @param fileUrlOrId - Either a signed URL, storage path, or file ID
 * @param orgId - Organization ID (optional)
 * @param orgSlug - Organization slug (optional, preferred over orgId)
 * @param basePath - Base path pattern (e.g., 'doc-files' or 'chat-images')
 * @param contextId - Context ID (e.g., docId or chatId)
 * @returns Storage path or null if cannot be determined
 */
export async function extractStoragePath(
  storage: Storage,
  fileUrlOrId: string,
  orgId: string | undefined,
  basePath: string,
  contextId: string,
  orgSlug?: string
): Promise<string | null> {
  // If it's already a storage path (old domains/ or new orgs/ format), return it
  if (fileUrlOrId.startsWith('domains/') || fileUrlOrId.startsWith('orgs/')) {
    return fileUrlOrId;
  }
  
  // Get org slug for path construction
  let orgSlugForPath: string;
  if (orgSlug) {
    orgSlugForPath = orgSlug;
  } else if (orgId) {
    try {
      orgSlugForPath = await getOrgSlugById(orgId);
    } catch (error) {
      console.error(`Failed to get org slug for ${orgId}, using default:`, error);
      orgSlugForPath = 'default';
    }
  } else {
    orgSlugForPath = 'default';
  }
  
  // Try to extract from signed URL
  try {
    const url = new URL(fileUrlOrId);
    const pathMatch = url.pathname.match(/\/[^\/]+\/(.+)$/);
    if (pathMatch) {
      return decodeURIComponent(pathMatch[1]);
    }
  } catch (e) {
    // Not a valid URL, construct path from context
    // For files: orgs/{orgSlug}/doc-files/{docId}/{fileId}
    // For images: orgs/{orgSlug}/chat-images/{chatId}/{imageId}.jpg
    if (basePath === 'chat-images') {
      // Check if it's an imageId (UUID.jpg)
      if (fileUrlOrId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i)) {
        return `orgs/${orgSlugForPath}/chat-images/${contextId}/${fileUrlOrId}`;
      }
      // Otherwise construct from chatId
      return `orgs/${orgSlugForPath}/chat-images/${contextId}/${fileUrlOrId}`;
    } else {
      // For doc-files, construct from docId and fileId
      return `orgs/${orgSlugForPath}/doc-files/${contextId}/${fileUrlOrId}`;
    }
  }
  
  return null;
}
