import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useCreateDoc, useUpdateDoc } from './useDocs';
import { saveDraft, removeDraft } from '@/services/draftService';
import { queueSave, isOnline } from '@/services/offlineQueue';
import { useAuth } from '@/contexts/AuthContext';
import type { Doc, DocFile } from '@/data/docsData';
import { v4 as uuidv4 } from 'uuid';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline' | 'draft';

interface UseAutoSaveOptions {
  docId: string | 'new';
  title: string;
  content: string;
  visibility: 'all_members' | 'specific_members';
  visibleToMembers: string[];
  files: DocFile[];
  enabled?: boolean;
  debounceDelay?: number;
  onSaveSuccess?: (savedDocId: string, isManual: boolean) => void;
  onSaveError?: (error: Error) => void;
}

interface UseAutoSaveReturn {
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  error: Error | null;
  manualSave: () => Promise<void>;
  isDirty: boolean;
}

const DEFAULT_DEBOUNCE_DELAY = 2000; // 2 seconds

export function useAutoSave({
  docId,
  title,
  content,
  visibility,
  visibleToMembers,
  files,
  enabled = true,
  debounceDelay = DEFAULT_DEBOUNCE_DELAY,
  onSaveSuccess,
  onSaveError,
}: UseAutoSaveOptions): UseAutoSaveReturn {
  const { user } = useAuth();
  const createDoc = useCreateDoc();
  const updateDoc = useUpdateDoc();
  
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef<string>('');
  const lastSavedTitleRef = useRef<string>('');
  const isSavingRef = useRef(false);
  const userIdRef = useRef<string | null>(null);
  // Track the created doc ID to prevent creating multiple new docs
  const createdDocIdRef = useRef<string | null>(null);
  // Lock to prevent concurrent doc creation
  const isCreatingRef = useRef(false);

  // Update userId ref when user changes
  useEffect(() => {
    userIdRef.current = user?.email || null;
  }, [user?.email]);

  // Reset createdDocIdRef and lock when docId changes from a real ID back to 'new'
  useEffect(() => {
    if (docId !== 'new' && docId !== createdDocIdRef.current) {
      // We're viewing an existing doc, reset the refs
      createdDocIdRef.current = null;
      isCreatingRef.current = false;
    }
  }, [docId]);

  // Check if content has changed
  const hasChanges = useCallback(() => {
    const titleChanged = title.trim() !== lastSavedTitleRef.current;
    const contentChanged = content !== lastSavedContentRef.current;
    return titleChanged || contentChanged;
  }, [title, content]);

  // Save draft to localStorage
  const saveDraftLocally = useCallback(() => {
    if (!userIdRef.current || !enabled) return;

    try {
      saveDraft(docId, userIdRef.current, {
        title,
        content,
        visibility,
        visibleToMembers: Array.from(visibleToMembers),
        files,
      });
      setIsDirty(true);
    } catch (err) {
      console.warn('Failed to save draft locally:', err);
    }
  }, [docId, title, content, visibility, visibleToMembers, files, enabled]);

  // Perform the actual save
  const performSave = useCallback(async (): Promise<void> => {
    if (!enabled || isSavingRef.current) return;
    
    // Validate required fields
    if (!title.trim()) {
      setError(new Error('Title is required'));
      setSaveStatus('error');
      return;
    }

    if (!content.trim() || content === '<p></p>') {
      setError(new Error('Content is required'));
      setSaveStatus('error');
      return;
    }

    // Validate visibility
    if (visibility === 'specific_members' && visibleToMembers.length === 0) {
      setError(new Error('Please select at least one member when visibility is set to Specific Members'));
      setSaveStatus('error');
      return;
    }

    // Check if there are actual changes
    if (!hasChanges() && docId !== 'new' && !createdDocIdRef.current) {
      return; // No changes to save
    }

    isSavingRef.current = true;
    setSaveStatus('saving');
    setError(null);

    try {
      // Always save draft locally first
      saveDraftLocally();

      // Check if online
      if (!isOnline()) {
        // Queue save for when online
        if (docId === 'new') {
          // For new docs, we need the full doc object
            const newDoc: Doc = {
              id: uuidv4(), // Generate ID for queue
              title: title.trim(),
              content,
              ownerEmail: user?.email || '',
              projectId: null,
              teamId: null,
              visibility,
              visibleToMembers: Array.from(visibleToMembers),
              metadata: { files },
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
          queueSave('new', {}, 'create', newDoc);
        } else {
          queueSave(docId, {
            title: title.trim(),
            content,
            visibility,
            visibleToMembers: Array.from(visibleToMembers),
            metadata: { files },
          });
        }
        setSaveStatus('offline');
        isSavingRef.current = false;
        return;
      }

      // Perform actual save
      if (docId === 'new') {
        // If we've already created a doc but docId is still 'new', update it instead
        if (createdDocIdRef.current) {
          await updateDoc.mutateAsync({
            docId: createdDocIdRef.current,
            updates: {
              title: title.trim(),
              content,
              visibility,
              visibleToMembers: Array.from(visibleToMembers),
              metadata: { files },
            },
          });
          
          // Clear draft after successful save
          if (userIdRef.current) {
            removeDraft(createdDocIdRef.current, userIdRef.current);
          }
          
          // Update saved state immediately to prevent duplicate saves
          lastSavedContentRef.current = content;
          lastSavedTitleRef.current = title.trim();
        } else if (isCreatingRef.current) {
          // Another save is already creating the doc, skip this one
          // The other save will handle it and set createdDocIdRef
          isSavingRef.current = false;
          return;
        } else {
          // First time creating this doc - set lock immediately to prevent concurrent creation
          isCreatingRef.current = true;
          
          try {
              const newDoc: Doc = {
                id: uuidv4(), // Generate ID for new doc
                title: title.trim(),
                content,
                ownerEmail: user?.email || '',
                projectId: null,
                teamId: null,
                visibility,
                visibleToMembers: Array.from(visibleToMembers),
                metadata: { files },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
            
            const createdDoc = await createDoc.mutateAsync(newDoc);
            
            // Store the created doc ID to prevent duplicate creation
            createdDocIdRef.current = createdDoc.id;
            
            // Clear draft for new doc after successful creation
            if (userIdRef.current) {
              removeDraft('new', userIdRef.current);
            }
            
            // Update saved state immediately to prevent duplicate saves
            // Use the actual saved content from the created doc if available
            lastSavedContentRef.current = createdDoc?.content || content;
            lastSavedTitleRef.current = createdDoc?.title || title.trim();
          } finally {
            // Always release the lock, even on error
            isCreatingRef.current = false;
          }
        }
      } else {
        await updateDoc.mutateAsync({
          docId,
          updates: {
            title: title.trim(),
            content,
            visibility,
            visibleToMembers: Array.from(visibleToMembers),
            metadata: { files },
          },
        });
        
        // Clear draft after successful save
        if (userIdRef.current) {
          removeDraft(docId, userIdRef.current);
        }
      }

      // Update saved state
      lastSavedContentRef.current = content;
      lastSavedTitleRef.current = title.trim();
      const savedAt = new Date();
      setLastSavedAt(savedAt);
      setSaveStatus('saved');
      setIsDirty(false);
      
      // Keep 'saved' status visible for 2 seconds before going to idle
      // (idle state will still show the saved timestamp)
      setTimeout(() => {
        // Only reset to idle if still in saved state (not changed by another save)
        setSaveStatus((current) => current === 'saved' ? 'idle' : current);
      }, 2000);
      
      // Determine the saved doc ID
      const savedDocId = docId === 'new' ? (createdDocIdRef.current || '') : docId;
      onSaveSuccess?.(savedDocId, false); // false = auto save
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to save document');
      setError(error);
      setSaveStatus('error');
      
      // Queue save for retry
      if (docId === 'new') {
        // If we've already created a doc, queue an update instead of create
        if (createdDocIdRef.current) {
          queueSave(createdDocIdRef.current, {
            title: title.trim(),
            content,
            visibility,
            visibleToMembers: Array.from(visibleToMembers),
            metadata: { files },
          });
        } else {
            const newDoc: Doc = {
              id: uuidv4(), // Generate ID for queue
              title: title.trim(),
              content,
              ownerEmail: user?.email || '',
              projectId: null,
              teamId: null,
              visibility,
              visibleToMembers: Array.from(visibleToMembers),
              metadata: { files },
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
          queueSave('new', {}, 'create', newDoc);
        }
      } else {
        queueSave(docId, {
          title: title.trim(),
          content,
          visibility,
          visibleToMembers: Array.from(visibleToMembers),
          metadata: { files },
        });
      }
      
      onSaveError?.(error);
    } finally {
      isSavingRef.current = false;
    }
  }, [
    enabled,
    docId,
    title,
    content,
    visibility,
    visibleToMembers,
    files,
    user?.email,
    hasChanges,
    saveDraftLocally,
    createDoc,
    updateDoc,
    onSaveSuccess,
    onSaveError,
  ]);

  // Debounced auto-save
  useEffect(() => {
    if (!enabled || !hasChanges()) {
      return;
    }

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Save draft immediately (silently, no UI status change)
    saveDraftLocally();

    // Don't change status during debounce - only show "Saving..." when actually saving
    // Status will remain as 'idle' (showing last saved time) or 'saved' until performSave() runs

    // Set up debounced save
    debounceTimerRef.current = setTimeout(() => {
      performSave();
    }, debounceDelay);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [title, content, visibility, visibleToMembers, files, enabled, debounceDelay, hasChanges, performSave, saveDraftLocally]);

  // Store performSave in a ref to avoid stale closures in cleanup effects
  const performSaveRef = useRef(performSave);
  useEffect(() => {
    performSaveRef.current = performSave;
  }, [performSave]);

  // Flush pending saves on component unmount (navigation)
  useEffect(() => {
    return () => {
      // On component unmount (navigation), flush pending saves
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        
        // If there are unsaved changes, save them now
        // Fire-and-forget: don't block navigation
        // Draft is already saved, so this is just syncing to server
        if (enabled && hasChanges() && !isSavingRef.current) {
          performSaveRef.current().catch(() => {
            // Silently fail - draft is already in localStorage
          });
        }
      }
    };
  }, [enabled, hasChanges]);

  // Handle page visibility changes and unload (browser close/refresh)
  useEffect(() => {
    const handleVisibilityChange = () => {
      // When page becomes hidden (tab switch, minimize, etc.)
      // Try to save if there are pending changes
      if (document.visibilityState === 'hidden') {
        if (debounceTimerRef.current && enabled && hasChanges() && !isSavingRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
          // Fire-and-forget save
          performSaveRef.current().catch(() => {
            // Silently fail - draft is already saved
          });
        }
      }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only warn if there are significant unsaved changes
      // AND we're not currently saving (which means changes might be lost)
      if (enabled && hasChanges() && !isSavingRef.current && isDirty) {
        // Modern browsers ignore custom messages, but still show warning
        e.preventDefault();
        e.returnValue = '';
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [enabled, hasChanges, isDirty]);

  // Initialize saved state when doc loads
  useEffect(() => {
    if (docId !== 'new' && title && content) {
      lastSavedTitleRef.current = title.trim();
      lastSavedContentRef.current = content;
    }
  }, [docId]); // Only run when docId changes (initial load)

  // Manual save function
  const manualSave = useCallback(async (): Promise<void> => {
    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    
    // Store original onSaveSuccess to call with manual flag
    const originalOnSaveSuccess = onSaveSuccess;
    const wrappedOnSaveSuccess = (savedDocId: string) => {
      originalOnSaveSuccess?.(savedDocId, true); // true = manual save
    };
    
    // Temporarily replace onSaveSuccess for this save
    const performManualSave = async () => {
      if (!enabled || isSavingRef.current) return;
      
      // Validate required fields
      if (!title.trim()) {
        setError(new Error('Title is required'));
        setSaveStatus('error');
        return;
      }

      if (!content.trim() || content === '<p></p>') {
        setError(new Error('Content is required'));
        setSaveStatus('error');
        return;
      }

      // Validate visibility
      if (visibility === 'specific_members' && visibleToMembers.length === 0) {
        setError(new Error('Please select at least one member when visibility is set to Specific Members'));
        setSaveStatus('error');
        return;
      }

      isSavingRef.current = true;
      setSaveStatus('saving');
      setError(null);

      try {
        saveDraftLocally();

        if (!isOnline()) {
          // Queue save for when online
          if (docId === 'new') {
            const newDoc: Doc = {
              id: uuidv4(),
              title: title.trim(),
              content,
              ownerEmail: user?.email || '',
              projectId: null,
              teamId: null,
              visibility,
              visibleToMembers: Array.from(visibleToMembers),
              metadata: { files },
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            queueSave('new', {}, 'create', newDoc);
          } else {
            queueSave(docId, {
              title: title.trim(),
              content,
              visibility,
              visibleToMembers: Array.from(visibleToMembers),
              metadata: { files },
            });
          }
          setSaveStatus('offline');
          isSavingRef.current = false;
          return;
        }

        let savedDocId = docId;
        if (docId === 'new') {
          if (createdDocIdRef.current) {
            await updateDoc.mutateAsync({
              docId: createdDocIdRef.current,
              updates: {
                title: title.trim(),
                content,
                visibility,
                visibleToMembers: Array.from(visibleToMembers),
                metadata: { files },
              },
            });
            savedDocId = createdDocIdRef.current;
            if (userIdRef.current) {
              removeDraft(createdDocIdRef.current, userIdRef.current);
            }
          } else {
            isCreatingRef.current = true;
            try {
              const newDoc: Doc = {
                id: uuidv4(),
                title: title.trim(),
                content,
                ownerEmail: user?.email || '',
                projectId: null,
                teamId: null,
                visibility,
                visibleToMembers: Array.from(visibleToMembers),
                metadata: { files },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
              const createdDoc = await createDoc.mutateAsync(newDoc);
              createdDocIdRef.current = createdDoc.id;
              savedDocId = createdDoc.id;
              if (userIdRef.current) {
                removeDraft('new', userIdRef.current);
              }
            } finally {
              isCreatingRef.current = false;
            }
          }
        } else {
          await updateDoc.mutateAsync({
            docId,
            updates: {
              title: title.trim(),
              content,
              visibility,
              visibleToMembers: Array.from(visibleToMembers),
              metadata: { files },
            },
          });
          if (userIdRef.current) {
            removeDraft(docId, userIdRef.current);
          }
        }

        lastSavedContentRef.current = content;
        lastSavedTitleRef.current = title.trim();
        const savedAt = new Date();
        setLastSavedAt(savedAt);
        setSaveStatus('saved');
        setIsDirty(false);
        
        setTimeout(() => {
          setSaveStatus((current) => current === 'saved' ? 'idle' : current);
        }, 2000);
        
        wrappedOnSaveSuccess(savedDocId);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to save document');
        setError(error);
        setSaveStatus('error');
        onSaveError?.(error);
      } finally {
        isSavingRef.current = false;
      }
    };
    
    await performManualSave();
  }, [performSave, enabled, title, content, visibility, visibleToMembers, files, user?.email, docId, saveDraftLocally, createDoc, updateDoc, onSaveSuccess, onSaveError]);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      if (isDirty && saveStatus === 'offline') {
        // Try to save when coming back online
        performSave();
      }
    };

    const handleOffline = () => {
      if (saveStatus === 'saving') {
        setSaveStatus('offline');
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isDirty, saveStatus, performSave]);

  // Return memoized object to prevent unnecessary re-renders
  const autoSaveResult = useMemo(() => ({
    saveStatus,
    lastSavedAt,
    error,
    manualSave,
    isDirty,
  }), [saveStatus, lastSavedAt, error, manualSave, isDirty]);

  return autoSaveResult;
}

