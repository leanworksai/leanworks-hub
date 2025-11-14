import { useQuery } from '@tanstack/react-query';
import { updatesService } from '@/services/firestore';
import { useAuth } from '@/contexts/AuthContext';

export const useUpdatesByTaskId = (taskId: string | null) => {
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['updates', 'task', taskId],
    queryFn: () => updatesService.getByTaskId(taskId!),
    enabled: !loading && !!user && !!taskId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

