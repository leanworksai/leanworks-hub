import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useCreateDoc, useUpdateDoc } from './useDocs';
import { saveDraft, removeDraft } from '@/services/draftService';
import { queueSave, isOnline } from '@/services/offlineQueue';
import { useAuth } from '@/contexts/AuthContext';
import type { Doc, DocFile } from '@/data/docsData';
import { v4 as uuidv4 } from 'uuid';
import { extractFirstLineAsTitle } from '@/utils/contentUtils';

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
  
  // CRITICAL: Capture save context to prevent race conditions when switching docs
  // This ensures saves complete for the correct doc even if user switches docs
  const saveContextRef = useRef<{
    docId: string | 'new';
    content: string;
    title: string;
    visibility: 'all_members' | 'specific_members';
    visibleToMembers: string[];
    files: DocFile[];
    timestamp: number;
  } | null>(null);

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
  
  // Cancel debounce timer when switching docs (but allow in-flight saves to complete in background)
  useEffect(() => {
    // Clear debounce timer when docId changes
    // This prevents new saves from starting for the old doc
    // But any in-flight saves will complete in background using captured context
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, [docId]);

  // Check if content has changed
  const hasChanges = useCallback(() => {
    const currentTitle = title.trim() || extractFirstLineAsTitle(content, 100) || '';
    const titleChanged = currentTitle !== lastSavedTitleRef.current;
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
    
    // CRITICAL: Capture context at save initiation to prevent race conditions
    // This ensures we save the correct doc's content even if user switches docs
    const saveContext = {
      docId: docId,
      content: content,
      title: title,
      visibility: visibility,
      visibleToMembers: Array.from(visibleToMembers),
      files: files,
      timestamp: Date.now(),
    };
    
    // Store context for this save operation
    saveContextRef.current = saveContext;
    
    // Extract title from content if title is empty (use captured content)
    const finalTitle = saveContext.title.trim() || extractFirstLineAsTitle(saveContext.content, 100) || 'Untitled';
    
    // Validate content - allow empty content for new docs (will be saved as empty)
    // Use CAPTURED content, not current closure value
    const isEmptyContent = !saveContext.content.trim() || saveContext.content === '<p></p>' || saveContext.content === '{"type":"doc","content":[{"type":"paragraph"}]}';
    if (isEmptyContent && saveContext.docId !== 'new') {
      // For existing docs, require some content
      setError(new Error('Content is required'));
      setSaveStatus('error');
      return;
    }

    // Validate visibility (use captured values)
    if (saveContext.visibility === 'specific_members' && saveContext.visibleToMembers.length === 0) {
      setError(new Error('Please select at least one member when visibility is set to Specific Members'));
      setSaveStatus('error');
      return;
    }

    // Check if there are actual changes (compare captured content with last saved)
    const currentTitle = finalTitle;
    const titleChanged = currentTitle !== lastSavedTitleRef.current;
    const contentChanged = saveContext.content !== lastSavedContentRef.current;
    const hasChanges = titleChanged || contentChanged;
    
    if (!hasChanges && saveContext.docId !== 'new' && !createdDocIdRef.current) {
      return; // No changes to save
    }

    isSavingRef.current = true;
    setSaveStatus('saving');
    setError(null);

    try {
      // Always save draft locally first (use captured context)
      if (userIdRef.current && enabled) {
        try {
          saveDraft(saveContext.docId, userIdRef.current, {
            title: saveContext.title,
            content: saveContext.content,
            visibility: saveContext.visibility,
            visibleToMembers: saveContext.visibleToMembers,
            files: saveContext.files,
          });
          setIsDirty(true);
        } catch (err) {
          console.warn('Failed to save draft locally:', err);
        }
      }

      // Check if online
      if (!isOnline()) {
        // Queue save for when online (use CAPTURED context)
        if (saveContext.docId === 'new') {
          // For new docs, we need the full doc object
            const newDoc: Doc = {
              id: uuidv4(), // Generate ID for queue
              title: finalTitle,
              content: saveContext.content, // Use captured content
              ownerEmail: user?.email || '',
              projectId: null,
              teamId: null,
              visibility: saveContext.visibility,
              visibleToMembers: saveContext.visibleToMembers,
              metadata: { files: saveContext.files },
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
          queueSave('new', {}, 'create', newDoc);
        } else {
          // Build updates object, only including valid content
          const updates: Partial<Doc> = {
            title: finalTitle,
            visibility: saveContext.visibility,
            visibleToMembers: saveContext.visibleToMembers,
            metadata: { files: saveContext.files },
          };
          
          // Only include content if it's valid and non-empty (use captured content)
          const isValidContent = saveContext.content && 
            saveContext.content.trim().length > 0 && 
            saveContext.content !== '<p></p>' && 
            saveContext.content !== '{"type":"doc","content":[{"type":"paragraph"}]}';
          
          if (isValidContent) {
            try {
              JSON.parse(saveContext.content);
              updates.content = saveContext.content; // Use captured content
            } catch {
              // Invalid JSON, skip content
            }
          }
          
          queueSave(saveContext.docId, updates); // Use captured docId
        }
        // Only update UI if user is still on this doc
        if (docId === saveContext.docId) {
          setSaveStatus('offline');
        }
        isSavingRef.current = false;
        return;
      }

      // Perform actual save (use CAPTURED context throughout)
      if (saveContext.docId === 'new') {
        // If we've already created a doc but docId is still 'new', update it instead
        if (createdDocIdRef.current) {
          // Build updates object, only including valid content (use captured context)
          const updates: Partial<Doc> = {
            title: finalTitle,
            visibility: saveContext.visibility,
            visibleToMembers: saveContext.visibleToMembers,
            metadata: { files: saveContext.files },
          };
          
          // Only include content if it's valid and non-empty (use captured content)
          const isValidContent = saveContext.content && 
            saveContext.content.trim().length > 0 && 
            saveContext.content !== '<p></p>' && 
            saveContext.content !== '{"type":"doc","content":[{"type":"paragraph"}]}';
          
          if (isValidContent) {
            try {
              JSON.parse(saveContext.content);
              updates.content = saveContext.content; // Use captured content
            } catch {
              console.warn('Skipping content update: invalid JSON format');
            }
          }
          
          await updateDoc.mutateAsync({
            docId: createdDocIdRef.current,
            updates,
          });
          
          // Clear draft after successful save
          if (userIdRef.current) {
            removeDraft(createdDocIdRef.current, userIdRef.current);
          }
          
          // Update saved state immediately to prevent duplicate saves (only if still on this doc)
          if (docId === saveContext.docId) {
            lastSavedContentRef.current = saveContext.content;
            lastSavedTitleRef.current = finalTitle;
          }
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
                title: finalTitle,
                content: saveContext.content, // Use captured content
                ownerEmail: user?.email || '',
                projectId: null,
                teamId: null,
                visibility: saveContext.visibility,
                visibleToMembers: saveContext.visibleToMembers,
                metadata: { files: saveContext.files },
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
            
            // Update saved state immediately to prevent duplicate saves (only if still on this doc)
            // Use the actual saved content from the created doc if available
            if (docId === saveContext.docId) {
              lastSavedContentRef.current = createdDoc?.content || saveContext.content;
              lastSavedTitleRef.current = createdDoc?.title || finalTitle;
            }
          } finally {
            // Always release the lock, even on error
            isCreatingRef.current = false;
          }
        }
      } else {
        // Build updates object, only including valid content (use CAPTURED context)
        const updates: Partial<Doc> = {
          title: finalTitle,
          visibility: saveContext.visibility,
          visibleToMembers: saveContext.visibleToMembers,
          metadata: { files: saveContext.files },
        };
        
        // Only include content if it's valid and non-empty (use captured content)
        // Check if content is valid JSON and not empty
        const isValidContent = saveContext.content && 
          saveContext.content.trim().length > 0 && 
          saveContext.content !== '<p></p>' && 
          saveContext.content !== '{"type":"doc","content":[{"type":"paragraph"}]}';
        
        if (isValidContent) {
          // Validate it's valid JSON
          try {
            JSON.parse(saveContext.content);
            updates.content = saveContext.content; // Use captured content
          } catch {
            // Invalid JSON, skip content update
            console.warn('Skipping content update: invalid JSON format');
          }
        }
        
        // CRITICAL: Use CAPTURED docId, not current docId
        // This prevents saving old content to new doc after navigation
        await updateDoc.mutateAsync({
          docId: saveContext.docId, // Use captured docId
          updates,
        });
        
        // Clear draft after successful save
        if (userIdRef.current) {
          removeDraft(saveContext.docId, userIdRef.current); // Use captured docId
        }
      }

      // Update saved state (only if user is still on this doc)
      // Background saves for switched docs complete silently
      if (docId === saveContext.docId) {
        lastSavedContentRef.current = saveContext.content;
        lastSavedTitleRef.current = finalTitle;
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
        const savedDocId = saveContext.docId === 'new' ? (createdDocIdRef.current || '') : saveContext.docId;
        onSaveSuccess?.(savedDocId, false); // false = auto save
      } else {
        // Background save completed for a different doc - silent success
        console.log('[useAutoSave] Background save completed for doc:', saveContext.docId);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to save document');
      
      // Only update UI if user is still on this doc
      if (docId === saveContext.docId) {
        setError(error);
        setSaveStatus('error');
        onSaveError?.(error);
      }
      
      // Queue save for retry (use CAPTURED context)
      if (saveContext.docId === 'new') {
        // If we've already created a doc, queue an update instead of create
        if (createdDocIdRef.current) {
          queueSave(createdDocIdRef.current, {
            title: finalTitle,
            content: saveContext.content, // Use captured content
            visibility: saveContext.visibility,
            visibleToMembers: saveContext.visibleToMembers,
            metadata: { files: saveContext.files },
          });
        } else {
            const newDoc: Doc = {
              id: uuidv4(), // Generate ID for queue
              title: finalTitle,
              content: saveContext.content, // Use captured content
              ownerEmail: user?.email || '',
              projectId: null,
              teamId: null,
              visibility: saveContext.visibility,
              visibleToMembers: saveContext.visibleToMembers,
              metadata: { files: saveContext.files },
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
          queueSave('new', {}, 'create', newDoc);
        }
      } else {
        // Build updates object, only including valid content (use captured context)
        const updates: Partial<Doc> = {
          title: finalTitle,
          visibility: saveContext.visibility,
          visibleToMembers: saveContext.visibleToMembers,
          metadata: { files: saveContext.files },
        };
        
        // Only include content if it's valid and non-empty (use captured content)
        const isValidContent = saveContext.content && 
          saveContext.content.trim().length > 0 && 
          saveContext.content !== '<p></p>' && 
          saveContext.content !== '{"type":"doc","content":[{"type":"paragraph"}]}';
        
        if (isValidContent) {
          try {
            JSON.parse(saveContext.content);
            updates.content = saveContext.content; // Use captured content
          } catch {
            // Invalid JSON, skip content
          }
        }
        
        queueSave(saveContext.docId, updates); // Use captured docId
      }
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

  // Don't flush saves on unmount - let them complete in background
  // The debounce timer is already cleared when docId changes
  // Any in-flight saves will complete using captured context

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

  // Initialize saved state when doc loads (only when docId changes, not on every content change)
  const initializedDocIdRef = useRef<string | null>(null);
  const isInitializedRef = useRef(false);
  
  useEffect(() => {
    // Only initialize if this is a different doc than we've already initialized
    if (docId !== 'new' && docId !== initializedDocIdRef.current) {
      // Wait for content to load before initializing
      if (content) {
        const initialTitle = title.trim() || extractFirstLineAsTitle(content, 100) || '';
        lastSavedTitleRef.current = initialTitle;
        lastSavedContentRef.current = content;
        initializedDocIdRef.current = docId;
        isInitializedRef.current = true;
      }
    } else if (docId === 'new' && initializedDocIdRef.current !== 'new') {
      // Reset refs for new docs
      lastSavedTitleRef.current = '';
      lastSavedContentRef.current = '';
      initializedDocIdRef.current = 'new';
      isInitializedRef.current = true;
    }
  }, [docId, content, title]); // Run when docId changes or when content first loads

  // Manual save function
  const manualSave = useCallback(async (): Promise<void> => {
    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    
    // CRITICAL: Capture context for manual save too
    const saveContext = {
      docId: docId,
      content: content,
      title: title,
      visibility: visibility,
      visibleToMembers: Array.from(visibleToMembers),
      files: files,
      timestamp: Date.now(),
    };
    
    // Store context for this save operation
    saveContextRef.current = saveContext;
    
    // Store original onSaveSuccess to call with manual flag
    const originalOnSaveSuccess = onSaveSuccess;
    const wrappedOnSaveSuccess = (savedDocId: string) => {
      originalOnSaveSuccess?.(savedDocId, true); // true = manual save
    };
    
    // Temporarily replace onSaveSuccess for this save
    const performManualSave = async () => {
      if (!enabled || isSavingRef.current) return;
      
      // Extract title from content if title is empty (use captured context)
      const finalTitle = saveContext.title.trim() || extractFirstLineAsTitle(saveContext.content, 100) || 'Untitled';
      
      // Validate content - allow empty content for new docs (use captured context)
      const isEmptyContent = !saveContext.content.trim() || saveContext.content === '<p></p>' || saveContext.content === '{"type":"doc","content":[{"type":"paragraph"}]}';
      if (isEmptyContent && saveContext.docId !== 'new') {
        setError(new Error('Content is required'));
        setSaveStatus('error');
        return;
      }

      // Validate visibility (use captured context)
      if (saveContext.visibility === 'specific_members' && saveContext.visibleToMembers.length === 0) {
        setError(new Error('Please select at least one member when visibility is set to Specific Members'));
        setSaveStatus('error');
        return;
      }

      isSavingRef.current = true;
      setSaveStatus('saving');
      setError(null);

      try {
        // Save draft locally (use captured context)
        if (userIdRef.current && enabled) {
          try {
            saveDraft(saveContext.docId, userIdRef.current, {
              title: saveContext.title,
              content: saveContext.content,
              visibility: saveContext.visibility,
              visibleToMembers: saveContext.visibleToMembers,
              files: saveContext.files,
            });
            setIsDirty(true);
          } catch (err) {
            console.warn('Failed to save draft locally:', err);
          }
        }

        if (!isOnline()) {
          // Queue save for when online (use captured context)
          if (saveContext.docId === 'new') {
            const newDoc: Doc = {
              id: uuidv4(),
              title: finalTitle,
              content: saveContext.content, // Use captured content
              ownerEmail: user?.email || '',
              projectId: null,
              teamId: null,
              visibility: saveContext.visibility,
              visibleToMembers: saveContext.visibleToMembers,
              metadata: { files: saveContext.files },
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            queueSave('new', {}, 'create', newDoc);
          } else {
            queueSave(saveContext.docId, { // Use captured docId
              title: finalTitle,
              content: saveContext.content, // Use captured content
              visibility: saveContext.visibility,
              visibleToMembers: saveContext.visibleToMembers,
              metadata: { files: saveContext.files },
            });
          }
          // Only update UI if still on this doc
          if (docId === saveContext.docId) {
            setSaveStatus('offline');
          }
          isSavingRef.current = false;
          return;
        }

        let savedDocId = saveContext.docId; // Use captured docId
        if (saveContext.docId === 'new') {
          if (createdDocIdRef.current) {
            await updateDoc.mutateAsync({
              docId: createdDocIdRef.current,
              updates: {
                title: finalTitle,
                content: saveContext.content, // Use captured content
                visibility: saveContext.visibility,
                visibleToMembers: saveContext.visibleToMembers,
                metadata: { files: saveContext.files },
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
                title: finalTitle,
                content: saveContext.content, // Use captured content
                ownerEmail: user?.email || '',
                projectId: null,
                teamId: null,
                visibility: saveContext.visibility,
                visibleToMembers: saveContext.visibleToMembers,
                metadata: { files: saveContext.files },
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
          // CRITICAL: Use CAPTURED docId and content
          await updateDoc.mutateAsync({
            docId: saveContext.docId, // Use captured docId
            updates: {
              title: finalTitle,
              content: saveContext.content, // Use captured content
              visibility: saveContext.visibility,
              visibleToMembers: saveContext.visibleToMembers,
              metadata: { files: saveContext.files },
            },
          });
          if (userIdRef.current) {
            removeDraft(saveContext.docId, userIdRef.current); // Use captured docId
          }
        }

        // Only update UI if user is still on this doc
        if (docId === saveContext.docId) {
          lastSavedContentRef.current = saveContext.content;
          lastSavedTitleRef.current = finalTitle;
          const savedAt = new Date();
          setLastSavedAt(savedAt);
          setSaveStatus('saved');
          setIsDirty(false);
          
          setTimeout(() => {
            setSaveStatus((current) => current === 'saved' ? 'idle' : current);
          }, 2000);
          
          wrappedOnSaveSuccess(savedDocId);
        } else {
          // Background manual save completed - silent success
          console.log('[useAutoSave] Background manual save completed for doc:', saveContext.docId);
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to save document');
        
        // Only update UI if user is still on this doc
        if (docId === saveContext.docId) {
          setError(error);
          setSaveStatus('error');
          onSaveError?.(error);
        }
      } finally {
        isSavingRef.current = false;
      }
    };
    
    await performManualSave();
  }, [enabled, title, content, visibility, visibleToMembers, files, user?.email, docId, createDoc, updateDoc, onSaveSuccess, onSaveError]);

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

