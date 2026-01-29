import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authenticatedFetch } from '@/services/api';
import type { PresentationJSON } from '@/types/presentation';

// API response types
interface PresentationResponse {
  presentation: PresentationJSON;
}

interface SaveResponse {
  success: boolean;
  message: string;
}

interface ExportResponse {
  success: boolean;
  downloadUrl: string;
  fileName: string;
  message: string;
}

/**
 * Hook for managing presentation data and API interactions
 */
export function usePresentation(docId: string | undefined) {
  const queryClient = useQueryClient();

  // Fetch presentation data
  const {
    data: presentationData,
    isLoading: isLoadingPresentation,
    error: presentationError,
    refetch: refetchPresentation,
  } = useQuery({
    queryKey: ['presentation', docId],
    queryFn: async (): Promise<PresentationJSON> => {
      if (!docId) throw new Error('Document ID is required');

      const response = await authenticatedFetch(`/api/docs/${docId}/presentation`);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to load presentation');
      }

      const data: PresentationResponse = await response.json();
      return data.presentation;
    },
    enabled: !!docId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: (failureCount, error) => {
      // Don't retry on 404 (presentation not found)
      if (error instanceof Error && error.message.includes('not found')) {
        return false;
      }
      return failureCount < 3;
    },
  });

  // Save presentation mutation
  const saveMutation = useMutation({
    mutationFn: async (presentation: PresentationJSON): Promise<SaveResponse> => {
      if (!docId) throw new Error('Document ID is required');

      const response = await authenticatedFetch(`/api/docs/${docId}/presentation`, {
        method: 'PUT',
        body: JSON.stringify({ presentation }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save presentation');
      }

      return await response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch presentation data
      queryClient.invalidateQueries({ queryKey: ['presentation', docId] });
    },
  });

  // Export to PPTX mutation
  const exportMutation = useMutation({
    mutationFn: async (): Promise<ExportResponse> => {
      if (!docId) throw new Error('Document ID is required');

      const response = await authenticatedFetch(`/api/docs/${docId}/export-pptx`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to export presentation');
      }

      return await response.json();
    },
  });

  // Wrapper functions with better error handling
  const savePresentation = useCallback(async (presentation: PresentationJSON) => {
    try {
      const result = await saveMutation.mutateAsync(presentation);
      return result;
    } catch (error) {
      console.error('Failed to save presentation:', error);
      throw error;
    }
  }, [saveMutation]);

  const exportToPPTX = useCallback(async () => {
    try {
      const result = await exportMutation.mutateAsync();

      // If successful, open download in new tab
      if (result.success && result.downloadUrl) {
        window.open(result.downloadUrl, '_blank');
      }

      return result;
    } catch (error) {
      console.error('Failed to export presentation:', error);
      throw error;
    }
  }, [exportMutation]);

  // Computed states
  const hasPresentationData = !!presentationData;
  const isLoading = isLoadingPresentation;
  const error = presentationError || saveMutation.error || exportMutation.error;

  return {
    // Data
    presentationData,
    hasPresentationData,

    // States
    isLoading,
    isSaving: saveMutation.isPending,
    isExporting: exportMutation.isPending,
    error,

    // Actions
    savePresentation,
    exportToPPTX,
    refetchPresentation,

    // Raw mutations (for advanced usage)
    saveMutation,
    exportMutation,
  };
}

/**
 * Hook for saving presentation data (when you don't need to fetch it)
 */
export function useSavePresentation() {
  const saveMutation = useMutation({
    mutationFn: async ({
      docId,
      presentation
    }: {
      docId: string;
      presentation: PresentationJSON;
    }): Promise<SaveResponse> => {
      const response = await authenticatedFetch(`/api/docs/${docId}/presentation`, {
        method: 'PUT',
        body: JSON.stringify({ presentation }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save presentation');
      }

      return await response.json();
    },
  });

  return {
    savePresentation: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    error: saveMutation.error,
  };
}

/**
 * Hook for exporting presentation to PPTX
 */
export function useExportPPTX() {
  const exportMutation = useMutation({
    mutationFn: async (docId: string): Promise<ExportResponse> => {
      const response = await authenticatedFetch(`/api/docs/${docId}/export-pptx`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to export presentation');
      }

      return await response.json();
    },
  });

  const exportToPPTX = useCallback(async (docId: string) => {
    try {
      const result = await exportMutation.mutateAsync(docId);

      // If successful, open download in new tab
      if (result.success && result.downloadUrl) {
        window.open(result.downloadUrl, '_blank');
      }

      return result;
    } catch (error) {
      console.error('Failed to export presentation:', error);
      throw error;
    }
  }, [exportMutation]);

  return {
    exportToPPTX,
    isExporting: exportMutation.isPending,
    error: exportMutation.error,
  };
}