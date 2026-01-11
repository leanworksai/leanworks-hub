import { useState, useEffect, useCallback } from 'react';
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
  const [formState, setFormState] = useState<DocFormState>(DEFAULT_FORM_STATE);

  // Load form state from doc when it changes
  useEffect(() => {
    if (initialDoc && !isNew) {
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
    } else if (isNew) {
      // Reset form for new doc
      setFormState(DEFAULT_FORM_STATE);
    }
  }, [initialDoc, isNew]);

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
