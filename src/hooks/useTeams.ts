import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { systemNotificationsService } from '@/services/api';
import type { Team, TeamDetailData, TeamJoinRequest, TeamInvitation } from '@/data/teamsData';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';

// Teams functionality has been removed - return empty data
export const useTeams = () => {
  return {
    data: [] as Team[],
    isLoading: false,
    error: null,
  };
};

// Hook to get teams filtered by current user membership
export const useUserTeams = () => {
  return {
    data: [] as Team[],
    isLoading: false,
  };
};

export const useTeam = (teamId: string) => {
  return {
    data: null as TeamDetailData | null,
    isLoading: false,
    error: null,
  };
};

// Teams functionality has been removed - return no-op mutations
export const useCreateTeam = () => {
  return {
    mutate: () => {},
    mutateAsync: async () => {},
    isLoading: false,
    error: null,
  };
};

export const useUpdateTeam = () => {
  return {
    mutate: () => {},
    mutateAsync: async () => {},
    isLoading: false,
    error: null,
  };
};

export const useUpdateTeamDetail = () => {
  return {
    mutate: () => {},
    mutateAsync: async () => {},
    isLoading: false,
    error: null,
  };
};

export const useDeleteTeam = () => {
  return {
    mutate: () => {},
    mutateAsync: async () => {},
    isLoading: false,
    error: null,
  };
};

// Team join request hooks - return empty data
export const useJoinRequests = () => {
  return {
    data: [] as TeamJoinRequest[],
    isLoading: false,
    error: null,
  };
};

export const useRequestJoinTeam = () => {
  return {
    mutate: () => {},
    mutateAsync: async () => {},
    isLoading: false,
    error: null,
  };
};

export const useApproveJoinRequest = () => {
  return {
    mutate: () => {},
    mutateAsync: async () => {},
    isLoading: false,
    error: null,
  };
};

export const useRejectJoinRequest = () => {
  return {
    mutate: () => {},
    mutateAsync: async () => {},
    isLoading: false,
    error: null,
  };
};

export const useRemoveTeamMember = () => {
  return {
    mutate: () => {},
    mutateAsync: async () => {},
    isLoading: false,
    error: null,
  };
};

export const useLeaveTeam = () => {
  return {
    mutate: () => {},
    mutateAsync: async () => {},
    isLoading: false,
    error: null,
  };
};

// Team invitation hooks - return empty data
export const useInvitations = () => {
  return {
    data: [] as TeamInvitation[],
    isLoading: false,
    error: null,
  };
};

export const useInviteTeamMember = () => {
  return {
    mutate: () => {},
    mutateAsync: async () => {},
    isLoading: false,
    error: null,
  };
};

export const useAcceptInvitation = () => {
  return {
    mutate: () => {},
    mutateAsync: async () => {},
    isLoading: false,
    error: null,
  };
};

// System notifications hooks
export const useSystemNotifications = () => {
  const { user, loading, authReady } = useAuth();
  
  return useQuery({
    queryKey: ['systemNotifications'],
    queryFn: () => systemNotificationsService.getNotifications(),
    enabled: authReady, // Only fetch when auth is ready
    staleTime: 0, // Always consider data stale to allow immediate refetches
    refetchInterval: 1000 * 5, // Auto-refresh every 5 seconds for faster updates
    refetchOnWindowFocus: true, // Refetch when user returns to the tab
    refetchOnMount: true, // Always refetch when component mounts
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

export const useDeclineInvitation = () => {
  return {
    mutate: () => {},
    mutateAsync: async () => {},
    isLoading: false,
    error: null,
  };
};

