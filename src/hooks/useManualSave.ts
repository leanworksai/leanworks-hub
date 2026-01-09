import { useState, useCallback, useRef, useEffect } from 'react';
import type { SaveStatus } from './useAutoSave';
import { DOC_CONSTANTS } from '@/constants/docs';

interface UseManualSaveOptions {
  onSave: () => Promise<void>;
  onError?: (error: Error) => void;
}

interface UseManualSaveReturn {
  saveStatus: SaveStatus;
  isSaving: boolean;
  handleSave: () => Promise<void>;
}

/**
 * Hook to manage manual save status and UI feedback
 * Separates manual save UI state from auto-save background operations
 */
export function useManualSave({
  onSave,
  onError,
}: UseManualSaveOptions): UseManualSaveReturn {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isSaving, setIsSaving] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveStatus('saving');
    
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    try {
      await onSave();
      setSaveStatus('saved');
      
      // Reset to idle after delay
      timeoutRef.current = setTimeout(() => {
        setSaveStatus('idle');
        setIsSaving(false);
      }, DOC_CONSTANTS.SAVE_STATUS_RESET_DELAY);
    } catch (error) {
      setSaveStatus('error');
      setIsSaving(false);
      onError?.(error instanceof Error ? error : new Error('Save failed'));
    }
  }, [onSave, onError]);
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);
  
  return { saveStatus, isSaving, handleSave };
}
