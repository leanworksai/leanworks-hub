import { useQuery } from '@tanstack/react-query';
import { updateSummariesService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';

export const useUpdateSummaries = () => {
  const { user, loading } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['updateSummaries', currentOrg?.id],
    queryFn: () => updateSummariesService.getAll(),
    enabled: !loading && !orgLoading && !!user && !!currentOrg, // Only fetch when user is authenticated and org is selected
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

export const useUpdateSummary = (projectId: string) => {
  const { user, loading } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['updateSummaries', projectId, currentOrg?.id],
    queryFn: () => updateSummariesService.getByProjectId(projectId),
    enabled: !loading && !orgLoading && !!user && !!currentOrg && !!projectId, // Only fetch when user is authenticated and projectId is provided
    staleTime: 1000 * 60 * 5,
  });
};

