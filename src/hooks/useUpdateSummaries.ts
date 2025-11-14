import { useQuery } from '@tanstack/react-query';
import { updateSummariesService } from '@/services/firestore';
import { useAuth } from '@/contexts/AuthContext';

export const useUpdateSummaries = () => {
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['updateSummaries'],
    queryFn: () => updateSummariesService.getAll(),
    enabled: !loading && !!user, // Only fetch when user is authenticated
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

export const useUpdateSummary = (projectId: string) => {
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['updateSummaries', projectId],
    queryFn: () => updateSummariesService.getByProjectId(projectId),
    enabled: !loading && !!user && !!projectId, // Only fetch when user is authenticated and projectId is provided
    staleTime: 1000 * 60 * 5,
  });
};

