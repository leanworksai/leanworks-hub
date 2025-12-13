import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { docsService } from '@/services/api';
import type { Doc } from '@/data/docsData';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';

export const useDocs = () => {
  const { user, loading } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['docs', currentOrg?.id],
    queryFn: () => docsService.getAll(),
    enabled: !loading && !orgLoading && !!user && !!currentOrg, // Only fetch when user is authenticated and org is selected
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

export const useDoc = (docId: string) => {
  const { user, loading } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['docs', docId, currentOrg?.id],
    queryFn: () => docsService.getById(docId),
    enabled: !loading && !orgLoading && !!user && !!currentOrg && !!docId && docId !== "new", // Only fetch when user is authenticated and docId is provided (not "new")
    staleTime: 0, // Always refetch to ensure fresh data
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnWindowFocus: false, // Don't refetch on window focus to avoid unnecessary requests
  });
};

export const useCreateDoc = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (doc: Doc) => docsService.create(doc),
    onSuccess: (createdDoc) => {
      // Invalidate and refetch to show the new doc immediately
      queryClient.invalidateQueries({ queryKey: ['docs'] });
      queryClient.refetchQueries({ queryKey: ['docs'] });
      // Set the created doc in cache so it's immediately available
      queryClient.setQueryData(['docs', createdDoc.id], createdDoc);
    },
  });
};

export const useUpdateDoc = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ docId, updates }: { docId: string; updates: Partial<Doc> }) =>
      docsService.update(docId, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['docs'] });
      queryClient.invalidateQueries({ queryKey: ['docs', variables.docId] });
      // Refetch the specific doc to ensure fresh data
      queryClient.refetchQueries({ queryKey: ['docs', variables.docId] });
    },
  });
};

export const useDeleteDoc = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (docId: string) => docsService.delete(docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docs'] });
    },
  });
};

