import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { docsService } from '@/services/api';
import type { Doc } from '@/data/docsData';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';

export const useDocs = () => {
  const { user, loading, authReady } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['docs', currentOrg?.id],
    queryFn: () => docsService.getAll(),
    enabled: authReady && !orgLoading && !!currentOrg, // Only fetch when auth is ready and org is selected
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

export const useDoc = (docId: string) => {
  const { user, loading, authReady } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['docs', docId, currentOrg?.id],
    queryFn: () => docsService.getById(docId),
    enabled: authReady && !orgLoading && !!currentOrg && !!docId && docId !== "new", // Only fetch when auth is ready and docId is provided (not "new")
    staleTime: 0, // Always refetch to ensure fresh data
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnWindowFocus: false, // Don't refetch on window focus to avoid unnecessary requests
  });
};

export const useCreateDoc = () => {
  const queryClient = useQueryClient();
  const { currentOrg } = useOrg();
  
  return useMutation({
    mutationFn: (doc: Doc) => docsService.create(doc),
    onMutate: async (newDoc) => {
      // Cancel any outgoing refetches for all orgs
      await queryClient.cancelQueries({ queryKey: ['docs'] });
      
      // Get all docs queries (for all orgs) and snapshot them
      const queryCache = queryClient.getQueryCache();
      const docsQueries = queryCache.findAll({ queryKey: ['docs'] });
      const previousDocsMap = new Map<string, Doc[]>();
      
      docsQueries.forEach(query => {
        const orgId = query.queryKey[1] as string | undefined;
        if (orgId) {
          const docs = queryClient.getQueryData<Doc[]>(['docs', orgId]);
          if (docs) {
            previousDocsMap.set(orgId, docs);
          }
        }
      });
      
      // Ensure new doc has "Untitled" as title if content is empty
      // This ensures it shows "Untitled" in the menu immediately
      const docToAdd = {
        ...newDoc,
        title: newDoc.title || "Untitled",
      };
      
      // Update cache for current org (if available)
      if (currentOrg?.id) {
        const previousDocs = previousDocsMap.get(currentOrg.id) || queryClient.getQueryData<Doc[]>(['docs', currentOrg.id]);
        if (previousDocs) {
          // Remove any optimistic temp doc entries (starting with "new-temp-")
          const filteredDocs = previousDocs.filter(d => !d.id.startsWith('new-temp-'));
          queryClient.setQueryData<Doc[]>(['docs', currentOrg.id], [docToAdd, ...filteredDocs]);
        } else {
          queryClient.setQueryData<Doc[]>(['docs', currentOrg.id], [docToAdd]);
        }
      }
      
      // Set the created doc in cache so it's immediately available
      queryClient.setQueryData(['docs', newDoc.id, currentOrg?.id], docToAdd);
      
      return { previousDocsMap };
    },
    onError: (err, newDoc, context) => {
      // Rollback on error - restore all org caches
      if (context?.previousDocsMap) {
        context.previousDocsMap.forEach((docs, orgId) => {
          queryClient.setQueryData(['docs', orgId], docs);
        });
      }
    },
    onSuccess: (createdDoc) => {
      // Ensure created doc has "Untitled" as title if content is empty
      // This ensures it shows "Untitled" in the menu
      const docWithTitle = {
        ...createdDoc,
        title: createdDoc.title || "Untitled",
      };
      
      // Update cache for current org
      if (currentOrg?.id) {
        const docs = queryClient.getQueryData<Doc[]>(['docs', currentOrg.id]);
        if (docs) {
          // Remove any optimistic temp doc entries and replace with real doc
          const filteredDocs = docs.filter(d => !d.id.startsWith('new-temp-') && d.id !== createdDoc.id);
          queryClient.setQueryData<Doc[]>(['docs', currentOrg.id], [docWithTitle, ...filteredDocs]);
        }
      }
      
      // Invalidate and refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['docs'] });
      queryClient.setQueryData(['docs', createdDoc.id, currentOrg?.id], docWithTitle);
    },
  });
};

export const useUpdateDoc = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ docId, updates }: { docId: string; updates: Partial<Doc> }) =>
      docsService.update(docId, updates),
    onMutate: async ({ docId, updates }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['docs', docId] });
      await queryClient.cancelQueries({ queryKey: ['docs'] });
      
      // Snapshot the previous values
      const previousDoc = queryClient.getQueryData<Doc>(['docs', docId]);
      const previousDocs = queryClient.getQueryData<Doc[]>(['docs']);
      
      // Optimistically update the cache
      if (previousDoc) {
        const optimisticDoc = { ...previousDoc, ...updates, updatedAt: new Date().toISOString() };
        queryClient.setQueryData<Doc>(['docs', docId], optimisticDoc);
        
        // Also update in the docs list
        if (previousDocs) {
          const updatedDocs = previousDocs.map(doc => 
            doc.id === docId ? optimisticDoc : doc
          );
          queryClient.setQueryData<Doc[]>(['docs'], updatedDocs);
        }
      }
      
      return { previousDoc, previousDocs };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousDoc) {
        queryClient.setQueryData(['docs', variables.docId], context.previousDoc);
      }
      if (context?.previousDocs) {
        queryClient.setQueryData(['docs'], context.previousDocs);
      }
    },
    onSuccess: (_, variables) => {
      // Update cache directly with the data we just saved - no refetch needed
      // This prevents cursor reset in the editor
      const currentDoc = queryClient.getQueryData<Doc>(['docs', variables.docId]);
      if (currentDoc) {
        queryClient.setQueryData(['docs', variables.docId], {
          ...currentDoc,
          ...variables.updates,
          updatedAt: new Date().toISOString(),
        });
      }
      
      // Only invalidate the docs list query, not the current document query
      // Invalidating the current doc causes refetch which resets cursor position
      queryClient.invalidateQueries({ 
        queryKey: ['docs'],
        predicate: (query) => {
          // Only invalidate list queries (['docs']), not individual doc queries (['docs', docId])
          return query.queryKey[0] === 'docs' && query.queryKey.length === 1;
        }
      });
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

