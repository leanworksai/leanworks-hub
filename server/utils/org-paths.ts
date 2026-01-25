import { getOrgSlugById } from '../../database/multi-tenant-pool.js';

/**
 * Get Firestore collection path using org slug
 * Handles org slug lookup with fallback to default org
 */
export async function getOrgCollectionPath(
  collection: string,
  orgId: string | undefined
): Promise<string> {
  if (!orgId) {
    return `orgs/default/${collection}`;
  }

  try {
    const orgSlug = await getOrgSlugById(orgId);
    return `orgs/${orgSlug}/${collection}`;
  } catch (error) {
    console.error(`Failed to get org slug for ${orgId}, using default:`, error);
    return `orgs/default/${collection}`;
  }
}
