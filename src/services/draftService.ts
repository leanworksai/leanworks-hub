import type { Doc } from '@/data/docsData';

export interface DraftData {
  docId: string | 'new';
  title: string;
  content: string;
  visibility: 'all_members' | 'specific_members';
  visibleToMembers: string[];
  files: any[];
  timestamp: number;
  userId: string;
}

const DRAFT_PREFIX = 'doc_draft_';
const DRAFT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Maximum size for a single draft (5MB - localStorage typically has 5-10MB total)
const MAX_DRAFT_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Get draft storage key for a document
 */
function getDraftKey(docId: string | 'new', userId: string): string {
  if (docId === 'new') {
    return `${DRAFT_PREFIX}new_${userId}`;
  }
  return `${DRAFT_PREFIX}${docId}`;
}

/**
 * Estimate the size of a draft in bytes
 */
function estimateDraftSize(data: {
  docId: string | 'new';
  title: string;
  content: string;
  visibility: 'all_members' | 'specific_members';
  visibleToMembers: string[];
  files: any[];
  timestamp: number;
  userId: string;
}): number {
  // Rough estimate: JSON string length * 2 (UTF-16 encoding)
  const jsonString = JSON.stringify(data);
  return jsonString.length * 2;
}

/**
 * Save a draft to localStorage
 */
export function saveDraft(
  docId: string | 'new',
  userId: string,
  data: {
    title: string;
    content: string;
    visibility: 'all_members' | 'specific_members';
    visibleToMembers: string[];
    files: any[];
  }
): void {
  try {
    const draft: DraftData = {
      docId,
      ...data,
      timestamp: Date.now(),
      userId,
    };
    
    // Check size before attempting to save
    const estimatedSize = estimateDraftSize(draft);
    if (estimatedSize > MAX_DRAFT_SIZE) {
      console.warn(`Draft too large to save (${(estimatedSize / 1024 / 1024).toFixed(2)}MB), skipping localStorage save`);
      return; // Silently skip - draft is too large for localStorage
    }
    
    const key = getDraftKey(docId, userId);
    localStorage.setItem(key, JSON.stringify(draft));
  } catch (error) {
    console.warn('Failed to save draft to localStorage:', error);
    // If quota exceeded, try to clean up old drafts
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      cleanupOldDrafts();
      // Retry once after cleanup, but only if size is reasonable
      try {
        const draft: DraftData = {
          docId,
          ...data,
          timestamp: Date.now(),
          userId,
        };
        const estimatedSize = estimateDraftSize(draft);
        if (estimatedSize > MAX_DRAFT_SIZE) {
          console.warn('Draft still too large after cleanup, skipping save');
          return;
        }
        const key = getDraftKey(docId, userId);
        localStorage.setItem(key, JSON.stringify(draft));
      } catch (retryError) {
        console.error('Failed to save draft after cleanup:', retryError);
        // If still failing, the draft is likely too large - skip it
        if (retryError instanceof DOMException && retryError.name === 'QuotaExceededError') {
          console.warn('Draft exceeds localStorage quota, skipping save');
        }
      }
    }
  }
}

/**
 * Get a draft from localStorage
 */
export function getDraft(docId: string | 'new', userId: string): DraftData | null {
  try {
    const key = getDraftKey(docId, userId);
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const draft: DraftData = JSON.parse(stored);
    
    // Check if draft is expired
    if (Date.now() - draft.timestamp > DRAFT_EXPIRATION_MS) {
      removeDraft(docId, userId);
      return null;
    }

    return draft;
  } catch (error) {
    console.warn('Failed to get draft from localStorage:', error);
    return null;
  }
}

/**
 * Remove a draft from localStorage
 */
export function removeDraft(docId: string | 'new', userId: string): void {
  try {
    const key = getDraftKey(docId, userId);
    localStorage.removeItem(key);
  } catch (error) {
    console.warn('Failed to remove draft from localStorage:', error);
  }
}

/**
 * Check if a draft exists and is newer than the server version
 */
export function isDraftNewer(
  docId: string | 'new',
  userId: string,
  serverUpdatedAt?: string
): boolean {
  const draft = getDraft(docId, userId);
  if (!draft) return false;
  
  if (docId === 'new') return true; // New docs always have newer drafts
  
  if (!serverUpdatedAt) return true; // If no server version, draft is newer
  
  const serverTime = new Date(serverUpdatedAt).getTime();
  return draft.timestamp > serverTime;
}

/**
 * Clean up expired drafts
 */
export function cleanupOldDrafts(): void {
  try {
    const now = Date.now();
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DRAFT_PREFIX)) continue;

      try {
        const stored = localStorage.getItem(key);
        if (!stored) continue;

        const draft: DraftData = JSON.parse(stored);
        if (now - draft.timestamp > DRAFT_EXPIRATION_MS) {
          keysToRemove.push(key);
        }
      } catch (error) {
        // Invalid draft, remove it
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (error) {
    console.warn('Failed to cleanup old drafts:', error);
  }
}

/**
 * Get all drafts for a user
 */
export function getAllDrafts(userId: string): DraftData[] {
  const drafts: DraftData[] = [];
  
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DRAFT_PREFIX)) continue;

      try {
        const stored = localStorage.getItem(key);
        if (!stored) continue;

        const draft: DraftData = JSON.parse(stored);
        if (draft.userId === userId) {
          // Check if expired
          if (Date.now() - draft.timestamp <= DRAFT_EXPIRATION_MS) {
            drafts.push(draft);
          }
        }
      } catch (error) {
        // Skip invalid drafts
      }
    }
  } catch (error) {
    console.warn('Failed to get all drafts:', error);
  }

  return drafts;
}

