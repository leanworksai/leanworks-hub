import { useState, useEffect, useCallback, useRef } from 'react';
import type { Doc } from '@/data/docsData';

export interface DocFormState {
  title: string;
  content: string;
  visibility: 'all_members' | 'specific_members';
  visibleToMembers: string[]; // Use array instead of Set for consistency
}

interface UseDocFormOptions {
  initialDoc?: Doc | null;
  isNew: boolean;
}

interface UseDocFormReturn {
  formState: DocFormState;
  updateField: <K extends keyof DocFormState>(
    field: K,
    value: DocFormState[K]
  ) => void;
  reset: () => void;
  setFormState: (state: DocFormState) => void;
}

const DEFAULT_FORM_STATE: DocFormState = {
  title: '',
  content: '',
  visibility: 'all_members',
  visibleToMembers: [],
};

/**
 * Hook to manage document form state
 * Consolidates title, content, visibility, and visibleToMembers into a single state object
 */
export function useDocForm({
  initialDoc,
  isNew,
}: UseDocFormOptions): UseDocFormReturn {
  // Track previous values to detect transitions
  const prevIsNewRef = useRef(isNew);
  const prevInitialDocIdRef = useRef<string | null>(initialDoc?.id || null);
  
  // Track doc ID to detect changes immediately
  const currentDocId = initialDoc?.id || (isNew ? 'new' : null);
  const prevDocIdRef = useRef<string | null>(currentDocId);
  
  // Initialize state based on current props
  const [formState, setFormState] = useState<DocFormState>(() => {
    if (isNew) {
      return DEFAULT_FORM_STATE;
    } else if (initialDoc) {
      return {
        title: initialDoc.title || '',
        content: initialDoc.content !== null && initialDoc.content !== undefined 
          ? initialDoc.content 
          : '',
        visibility: initialDoc.visibility || 'all_members',
        visibleToMembers: Array.isArray(initialDoc.visibleToMembers) 
          ? initialDoc.visibleToMembers 
          : [],
      };
    }
    return DEFAULT_FORM_STATE;
  });
  
  // CRITICAL: Reset immediately when doc ID changes (synchronously during render)
  // This prevents showing old content during transitions
  if (currentDocId !== prevDocIdRef.current) {
    if (isNew) {
      // Switching to new doc - reset immediately
      if (formState.content || formState.title) {
        setFormState(DEFAULT_FORM_STATE);
      }
    } else if (initialDoc && initialDoc.id !== prevDocIdRef.current) {
      // Switching to different existing doc - set immediately
      setFormState({
        title: initialDoc.title || '',
        content: initialDoc.content !== null && initialDoc.content !== undefined 
          ? initialDoc.content 
          : '',
        visibility: initialDoc.visibility || 'all_members',
        visibleToMembers: Array.isArray(initialDoc.visibleToMembers) 
          ? initialDoc.visibleToMembers 
          : [],
      });
    } else if (!isNew && !initialDoc) {
      // Doc is loading - reset to prevent showing old content
      setFormState(DEFAULT_FORM_STATE);
    }
    prevDocIdRef.current = currentDocId;
  }
  
  // CRITICAL: Reset immediately when transitioning between docs to prevent flash
  // Use useEffect with immediate execution to reset before render
  useEffect(() => {
    // Detect transition to new doc
    if (isNew && !prevIsNewRef.current) {
      // Transitioning to new doc - reset immediately
      setFormState(DEFAULT_FORM_STATE);
      prevIsNewRef.current = true;
      prevInitialDocIdRef.current = null;
      return;
    }
    
    // Detect transition from new to existing doc
    if (!isNew && prevIsNewRef.current && initialDoc) {
      setFormState({
        title: initialDoc.title || '',
        content: initialDoc.content !== null && initialDoc.content !== undefined 
          ? initialDoc.content 
          : '',
        visibility: initialDoc.visibility || 'all_members',
        visibleToMembers: Array.isArray(initialDoc.visibleToMembers) 
          ? initialDoc.visibleToMembers 
          : [],
      });
      prevIsNewRef.current = false;
      prevInitialDocIdRef.current = initialDoc.id;
      return;
    }
    
    // Detect switching between different existing docs
    if (!isNew && initialDoc && initialDoc.id !== prevInitialDocIdRef.current) {
      // CRITICAL: Reset immediately to prevent showing old doc content
      setFormState({
        title: initialDoc.title || '',
        content: initialDoc.content !== null && initialDoc.content !== undefined 
          ? initialDoc.content 
          : '',
        visibility: initialDoc.visibility || 'all_members',
        visibleToMembers: Array.isArray(initialDoc.visibleToMembers) 
          ? initialDoc.visibleToMembers 
          : [],
      });
      prevIsNewRef.current = false;
      prevInitialDocIdRef.current = initialDoc.id;
      return;
    }
    
    // For new doc, ensure it stays reset
    if (isNew) {
      if (formState.content || formState.title) {
        setFormState(DEFAULT_FORM_STATE);
      }
      prevIsNewRef.current = true;
      prevInitialDocIdRef.current = null;
    } else if (initialDoc && initialDoc.id === prevInitialDocIdRef.current) {
      // Same doc, but content might have been updated externally
      const newContent = initialDoc.content !== null && initialDoc.content !== undefined 
        ? initialDoc.content 
        : '';
      if (formState.content !== newContent || formState.title !== (initialDoc.title || '')) {
        setFormState({
          title: initialDoc.title || '',
          content: newContent,
          visibility: initialDoc.visibility || 'all_members',
          visibleToMembers: Array.isArray(initialDoc.visibleToMembers) 
            ? initialDoc.visibleToMembers 
            : [],
        });
      }
      prevIsNewRef.current = false;
    } else if (!isNew && !initialDoc) {
      // Doc is loading or doesn't exist - reset to prevent showing old content
      setFormState(DEFAULT_FORM_STATE);
      prevInitialDocIdRef.current = null;
      prevIsNewRef.current = false;
    }
  }, [initialDoc, isNew]); // Removed formState.content from deps to prevent loops

  const updateField = useCallback(<K extends keyof DocFormState>(
    field: K,
    value: DocFormState[K]
  ) => {
    setFormState(prev => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const reset = useCallback(() => {
    setFormState(DEFAULT_FORM_STATE);
  }, []);

  return {
    formState,
    updateField,
    reset,
    setFormState,
  };
}
