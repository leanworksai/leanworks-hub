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
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.warn('Failed to save offline queue:', error);
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
  const queue = getQueue();
  
  // Check if there's already a queued save for this doc
  const existingIndex = queue.findIndex(item => item.docId === docId);
  
  const queuedSave: QueuedSave = {
    docId,
    updates,
    timestamp: Date.now(),
    retryCount: 0,
    type,
    fullDoc,
  };

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
    console.error('Failed to process queued save:', error);
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
 * Initialize offline queue monitoring
 */
export function initOfflineQueue(): () => void {
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

