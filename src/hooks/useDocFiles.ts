import { useState, useCallback, useEffect, useRef } from 'react';
import { useUpdateDoc } from './useDocs';
import { useToast } from '@/hooks/use-toast';
import { fileUploadService } from '@/services/api';
import type { DocFile } from '@/data/docsData';

interface UseDocFilesOptions {
  docId: string | 'new';
  initialFiles?: DocFile[];
  onFilesChange?: (files: DocFile[]) => void;
}

interface UseDocFilesReturn {
  files: DocFile[];
  handleFileUpload: (file: File) => Promise<void>;
  handleRemoveFile: () => Promise<void>;
  fileToDelete: DocFile | null;
  setFileToDelete: (file: DocFile | null) => void;
}

/**
 * Hook to manage document file attachments
 * Handles file upload, removal, and state management
 */
export function useDocFiles({
  docId,
  initialFiles = [],
  onFilesChange,
}: UseDocFilesOptions): UseDocFilesReturn {
  const [files, setFiles] = useState<DocFile[]>(initialFiles);
  const [fileToDelete, setFileToDelete] = useState<DocFile | null>(null);
  const updateDoc = useUpdateDoc();
  const { toast } = useToast();
  const prevInitialFilesRef = useRef<string>('');

  // Sync files when initialFiles change (only if file IDs actually changed)
  useEffect(() => {
    const currentFilesIds = JSON.stringify(initialFiles.map(f => f.fileId).sort());
    
    // Only update if file IDs actually changed
    if (prevInitialFilesRef.current !== currentFilesIds) {
      setFiles(initialFiles);
      prevInitialFilesRef.current = currentFilesIds;
    }
  }, [initialFiles]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!docId || docId === "new") {
      toast({
        title: "Error",
        description: "Please save the document first before uploading files",
        variant: "destructive",
      });
      return;
    }

    try {
      const result = await fileUploadService.uploadFile(docId, file);
      
      // Add file to local state
      const newFile: DocFile = {
        fileId: result.fileId,
        fileName: result.fileName,
        fileUrl: result.fileUrl,
        fileSize: result.fileSize,
        mimeType: result.mimeType,
        uploadedAt: new Date().toISOString(),
      };
      
      const updatedFiles = [...files, newFile];
      setFiles(updatedFiles);
      onFilesChange?.(updatedFiles);

      // Update doc metadata with new file
      await updateDoc.mutateAsync({
        docId,
        updates: {
          metadata: {
            files: updatedFiles,
          },
        },
      });

      toast({
        title: "File uploaded",
        description: `"${result.fileName}" has been uploaded successfully.`,
      });
    } catch (error) {
      throw error; // Re-throw to let RichTextEditor handle the error
    }
  }, [docId, files, updateDoc, toast, onFilesChange]);

  const handleRemoveFile = useCallback(async () => {
    if (!fileToDelete || !docId || docId === "new") {
      return;
    }

    try {
      // Remove file from local state
      const updatedFiles = files.filter(f => f.fileId !== fileToDelete.fileId);
      setFiles(updatedFiles);
      onFilesChange?.(updatedFiles);

      // Update doc metadata
      await updateDoc.mutateAsync({
        docId,
        updates: {
          metadata: {
            files: updatedFiles,
          },
        },
      });

      toast({
        title: "File removed",
        description: `"${fileToDelete.fileName}" has been removed from the document.`,
      });

      setFileToDelete(null);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to remove file",
        variant: "destructive",
      });
    }
  }, [fileToDelete, docId, files, updateDoc, toast, onFilesChange]);

  return {
    files,
    handleFileUpload,
    handleRemoveFile,
    fileToDelete,
    setFileToDelete,
  };
}
