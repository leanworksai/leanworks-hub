import { useQuery } from '@tanstack/react-query';
import { updateSummariesService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';

export const useUpdateSummaries = () => {
  const { user, loading, authReady } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['updateSummaries', currentOrg?.id],
    queryFn: () => updateSummariesService.getAll(),
    enabled: authReady && !orgLoading && !!currentOrg, // Only fetch when auth is ready and org is selected
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

export const useUpdateSummary = (projectId: string) => {
  const { user, loading, authReady } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['updateSummaries', projectId, currentOrg?.id],
    queryFn: () => updateSummariesService.getByProjectId(projectId),
    enabled: authReady && !orgLoading && !!currentOrg && !!projectId, // Only fetch when auth is ready and projectId is provided
    staleTime: 1000 * 60 * 5,
  });
};

export const useAllUpdateSummaries = (projectId: string) => {
  const { user, loading, authReady } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['allUpdateSummaries', projectId, currentOrg?.id],
    queryFn: () => updateSummariesService.getAllByProjectId(projectId),
    enabled: authReady && !orgLoading && !!currentOrg && !!projectId,
    staleTime: 1000 * 60 * 5,
  });
};

