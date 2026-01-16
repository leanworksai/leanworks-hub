import { docsService } from './api';
import type { Doc } from '@/data/docsData';

export interface QueuedSave {
  docId: string;
  updates: Partial<Doc>;
  timestamp: number;
  retryCount: number;
  type: 'create' | 'update';
  fullDoc?: Doc; // For create operations
}

const QUEUE_KEY = 'doc_offline_queue';
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff in ms
// Maximum size for the entire queue (2MB - leave room for other localStorage data)
const MAX_QUEUE_SIZE = 2 * 1024 * 1024; // 2MB

/**
 * Estimate the size of a queued save in bytes
 */
function estimateQueuedSaveSize(item: QueuedSave): number {
  const jsonString = JSON.stringify(item);
  return jsonString.length * 2; // UTF-16 encoding
}

/**
 * Get the offline queue from localStorage
 */
function getQueue(): QueuedSave[] {
  try {
    const stored = localStorage.getItem(QUEUE_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch (error) {
    console.warn('Failed to get offline queue:', error);
    return [];
  }
}

/**
 * Save the offline queue to localStorage
 */
function saveQueue(queue: QueuedSave[]): void {
  try {
    const queueString = JSON.stringify(queue);
    const estimatedSize = queueString.length * 2;
    
    // If queue is too large, remove oldest items
    if (estimatedSize > MAX_QUEUE_SIZE) {
      console.warn(`Queue too large (${(estimatedSize / 1024 / 1024).toFixed(2)}MB), removing oldest items`);
      // Sort by timestamp and remove oldest items until under limit
      const sorted = [...queue].sort((a, b) => a.timestamp - b.timestamp);
      const trimmed: QueuedSave[] = [];
      let currentSize = 0;
      
      // Keep most recent items that fit
      for (let i = sorted.length - 1; i >= 0; i--) {
        const item = sorted[i];
        const itemSize = estimateQueuedSaveSize(item);
        if (currentSize + itemSize <= MAX_QUEUE_SIZE) {
          trimmed.unshift(item);
          currentSize += itemSize;
        } else {
          console.warn(`Removing queued save for doc ${item.docId} (too large)`);
        }
      }
      
      localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
      return;
    }
    
    localStorage.setItem(QUEUE_KEY, queueString);
  } catch (error) {
    console.warn('Failed to save offline queue:', error);
    // If quota exceeded, try to clean up old items
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      // Remove items with highest retry count first (they're likely to fail)
      const sorted = [...queue].sort((a, b) => b.retryCount - a.retryCount);
      const trimmed = sorted.slice(0, Math.floor(sorted.length / 2)); // Keep half
      try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
        console.warn('Cleaned up offline queue due to quota exceeded');
      } catch (retryError) {
        // If still failing, clear the queue
        console.error('Failed to save queue after cleanup, clearing it');
        localStorage.removeItem(QUEUE_KEY);
      }
    }
  }
}

/**
 * Validate that content is valid before queuing
 */
function isValidContent(content: any): boolean {
  if (content === undefined || content === null) return true; // Optional in updates
  if (typeof content !== 'string') return false;
  if (content.trim().length === 0) return false;
  
  // Must be valid JSON
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Add a save operation to the queue
 */
export function queueSave(
  docId: string,
  updates: Partial<Doc>,
  type: 'create' | 'update' = 'update',
  fullDoc?: Doc
): void {
  // Validate content before queuing
  if (updates.content !== undefined && !isValidContent(updates.content)) {
    console.warn('Skipping queue save: invalid content', {
      docId,
      hasContent: !!updates.content,
      contentType: typeof updates.content,
    });
    return; // Don't queue invalid saves that will never succeed
  }
  
  if (fullDoc && fullDoc.content && !isValidContent(fullDoc.content)) {
    console.warn('Skipping queue save: invalid content in fullDoc', { docId });
    return;
  }
  
  // Check size before queuing
  const queuedSave: QueuedSave = {
    docId,
    updates,
    timestamp: Date.now(),
    retryCount: 0,
    type,
    fullDoc,
  };
  
  const estimatedSize = estimateQueuedSaveSize(queuedSave);
  if (estimatedSize > MAX_QUEUE_SIZE / 4) { // Don't allow single item to take more than 25% of queue
    console.warn(`Skipping queue save: item too large (${(estimatedSize / 1024 / 1024).toFixed(2)}MB)`, { docId });
    return;
  }
  
  const queue = getQueue();
  
  // Check if there's already a queued save for this doc
  const existingIndex = queue.findIndex(item => item.docId === docId);

  if (existingIndex >= 0) {
    // Update existing queued save
    queue[existingIndex] = queuedSave;
  } else {
    // Add new queued save
    queue.push(queuedSave);
  }

  saveQueue(queue);
}

/**
 * Remove a save operation from the queue
 */
export function removeFromQueue(docId: string): void {
  const queue = getQueue();
  const filtered = queue.filter(item => item.docId !== docId);
  saveQueue(filtered);
}

/**
 * Get all queued saves
 */
export function getQueuedSaves(): QueuedSave[] {
  return getQueue();
}

/**
 * Clear the entire queue
 */
export function clearQueue(): void {
  saveQueue([]);
}

/**
 * Check if online
 */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

/**
 * Process a single queued save
 */
async function processQueuedSave(item: QueuedSave): Promise<boolean> {
  try {
    if (item.type === 'create' && item.fullDoc) {
      await docsService.create(item.fullDoc);
    } else {
      await docsService.update(item.docId, item.updates);
    }
    return true;
  } catch (error) {
    // Log the full error with details for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Failed to process queued save:', {
      docId: item.docId,
      type: item.type,
      error: errorMessage,
      retryCount: item.retryCount,
    });
    
    // If it's a validation error or payload too large, don't retry indefinitely
    // These are likely permanent issues that won't be fixed by retrying
    if (errorMessage.includes('Validation failed') || 
        errorMessage.includes('too large') ||
        errorMessage.includes('Payload Too Large')) {
      console.warn('Permanent error detected, will not retry:', errorMessage);
      // Still return false so it gets removed from queue after max retries
    }
    
    return false;
  }
}

/**
 * Process all queued saves
 */
export async function processQueue(): Promise<{ success: number; failed: number }> {
  if (!isOnline()) {
    return { success: 0, failed: 0 };
  }

  const queue = getQueue();
  if (queue.length === 0) {
    return { success: 0, failed: 0 };
  }

  let success = 0;
  let failed = 0;
  const remainingQueue: QueuedSave[] = [];

  for (const item of queue) {
    if (item.retryCount >= MAX_RETRY_ATTEMPTS) {
      // Max retries reached, mark as failed
      failed++;
      continue;
    }

    const isSuccess = await processQueuedSave(item);
    
    if (isSuccess) {
      // Successfully saved, remove from queue
      success++;
    } else {
      // Failed, increment retry count and keep in queue
      item.retryCount++;
      remainingQueue.push(item);
    }
  }

  saveQueue(remainingQueue);
  return { success, failed };
}

/**
 * Process queue with exponential backoff retry
 */
export async function processQueueWithRetry(): Promise<void> {
  if (!isOnline()) {
    return;
  }

  const queue = getQueue();
  if (queue.length === 0) {
    return;
  }

  // Process items that haven't exceeded retry limit
  const itemsToProcess = queue.filter(item => item.retryCount < MAX_RETRY_ATTEMPTS);
  
  for (const item of itemsToProcess) {
    const delay = RETRY_DELAYS[item.retryCount] || 4000;
    
    // Wait for retry delay
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Check if still online
    if (!isOnline()) {
      break;
    }

    const success = await processQueuedSave(item);
    
    if (success) {
      removeFromQueue(item.docId);
    } else {
      // Update retry count
      const updatedQueue = getQueue();
      const itemIndex = updatedQueue.findIndex(q => q.docId === item.docId);
      if (itemIndex >= 0) {
        updatedQueue[itemIndex].retryCount++;
        saveQueue(updatedQueue);
      }
    }
  }
}

/**
 * Clean up invalid queued saves (those with invalid content that will never succeed)
 */
function cleanupInvalidQueuedSaves(): void {
  const queue = getQueue();
  const validQueue: QueuedSave[] = [];
  
  for (const item of queue) {
    // Check if content is valid
    const content = item.updates?.content || item.fullDoc?.content;
    if (content !== undefined && !isValidContent(content)) {
      console.warn(`Removing invalid queued save for doc ${item.docId} (invalid content)`);
      continue; // Skip invalid items
    }
    
    // Check if item is too large
    const estimatedSize = estimateQueuedSaveSize(item);
    if (estimatedSize > MAX_QUEUE_SIZE / 4) {
      console.warn(`Removing queued save for doc ${item.docId} (too large)`);
      continue; // Skip items that are too large
    }
    
    validQueue.push(item);
  }
  
  if (validQueue.length !== queue.length) {
    saveQueue(validQueue);
    console.log(`Cleaned up ${queue.length - validQueue.length} invalid queued saves`);
  }
}

/**
 * Initialize offline queue monitoring
 */
export function initOfflineQueue(): () => void {
  // Clean up invalid queued saves on initialization
  cleanupInvalidQueuedSaves();
  
  // Process queue when coming back online
  const handleOnline = () => {
    processQueueWithRetry();
  };

  window.addEventListener('online', handleOnline);

  // Process queue immediately if online
  if (isOnline()) {
    processQueueWithRetry();
  }

  // Return cleanup function
  return () => {
    window.removeEventListener('online', handleOnline);
  };
}

