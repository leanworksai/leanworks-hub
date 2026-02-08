import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { systemNotificationsService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';

export const useSystemNotifications = () => {
  const { authReady } = useAuth();

  return useQuery({
    queryKey: ['systemNotifications'],
    queryFn: () => systemNotificationsService.getNotifications(),
    enabled: authReady,
    staleTime: 0,
    refetchInterval: 1000 * 5,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
};

export const useMarkNotificationRead = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) => systemNotificationsService.markAsRead(notificationId),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['systemNotifications'] });
    },
  });
};

export const useDismissNotification = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) => systemNotificationsService.dismiss(notificationId),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['systemNotifications'] });
    },
  });
};
