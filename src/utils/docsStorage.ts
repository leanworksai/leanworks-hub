/**
 * Utilities for managing last opened document in localStorage
 * Scoped per user and organization
 */

/**
 * Get the localStorage key for storing last opened doc
 * @param userEmail - User's email address
 * @param orgId - Organization ID
 * @returns localStorage key string
 */
export function getLastOpenedDocKey(userEmail: string, orgId: string): string {
  return `lastOpenedDoc_${userEmail.toLowerCase()}_${orgId}`;
}

/**
 * Save the last opened document ID to localStorage
 * @param userEmail - User's email address
 * @param orgId - Organization ID
 * @param docId - Document ID to save
 */
export function saveLastOpenedDoc(
  userEmail: string,
  orgId: string,
  docId: string
): void {
  try {
    const key = getLastOpenedDocKey(userEmail, orgId);
    localStorage.setItem(key, docId);
  } catch (error) {
    console.error('Failed to save last opened doc:', error);
  }
}

/**
 * Load the last opened document ID from localStorage
 * @param userEmail - User's email address
 * @param orgId - Organization ID
 * @returns Document ID or null if not found
 */
export function loadLastOpenedDoc(
  userEmail: string,
  orgId: string
): string | null {
  try {
    const key = getLastOpenedDocKey(userEmail, orgId);
    return localStorage.getItem(key);
  } catch (error) {
    console.error('Failed to load last opened doc:', error);
    return null;
  }
}
