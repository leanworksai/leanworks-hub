import { useQuery } from '@tanstack/react-query';
import { updatesService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';

export const useUpdatesByTaskId = (taskId: string | null) => {
  const { user, loading, authReady } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['updates', 'task', taskId, currentOrg?.id],
    queryFn: () => updatesService.getByTaskId(taskId!),
    enabled: authReady && !orgLoading && !!currentOrg && !!taskId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

