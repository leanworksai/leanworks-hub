import { useState, useCallback } from 'react';

type DialogType = 'share' | 'shareViaEmail' | 'files' | 'delete' | null;

interface UseDocDialogsReturn {
  openDialog: (type: DialogType) => void;
  closeDialog: () => void;
  isOpen: (type: DialogType) => boolean;
  shareDialogOpen: boolean;
  shareViaEmailDialogOpen: boolean;
  filesDialogOpen: boolean;
  deleteDialogOpen: boolean;
}

/**
 * Hook to manage all dialog states for DocDetail component
 * Provides a single source of truth for dialog state management
 */
export function useDocDialogs(): UseDocDialogsReturn {
  const [openDialogType, setOpenDialogType] = useState<DialogType>(null);
  
  const openDialog = useCallback((type: DialogType) => {
    setOpenDialogType(type);
  }, []);
  
  const closeDialog = useCallback(() => {
    setOpenDialogType(null);
  }, []);
  
  const isOpen = useCallback((type: DialogType) => {
    return openDialogType === type;
  }, [openDialogType]);
  
  return {
    openDialog,
    closeDialog,
    isOpen,
    shareDialogOpen: openDialogType === 'share',
    shareViaEmailDialogOpen: openDialogType === 'shareViaEmail',
    filesDialogOpen: openDialogType === 'files',
    deleteDialogOpen: openDialogType === 'delete',
  };
}
