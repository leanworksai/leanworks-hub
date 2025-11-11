import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { teamsService, teamJoinRequestsService, teamInvitationsService } from '@/services/firestore';
import type { Team, TeamDetailData, TeamJoinRequest, TeamInvitation } from '@/data/teamsData';
import { useAuth } from '@/contexts/AuthContext';

export const useTeams = () => {
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['teams'],
    queryFn: () => teamsService.getAll(),
    enabled: !loading && !!user, // Only fetch when user is authenticated
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

// Hook to get teams filtered by current user membership
export const useUserTeams = () => {
  const { user } = useAuth();
  const { data: allTeams = [], isLoading: isLoadingTeams } = useTeams();

  // Fetch team details for all teams in parallel (only if user and teams exist)
  const teamDetailsQueries = useQueries({
    queries: allTeams.length > 0 && user?.email
      ? allTeams.map((team) => ({
          queryKey: ['teams', team.name],
          queryFn: () => teamsService.getById(team.name),
          enabled: !!team.name && !!user?.email,
          staleTime: 1000 * 60 * 5,
        }))
      : [],
  });

  // If no user or no teams, return early
  if (!user?.email || allTeams.length === 0) {
    return {
      data: [],
      isLoading: isLoadingTeams,
    };
  }

  // Check if all team details are loaded
  const isLoadingDetails = teamDetailsQueries.some((query) => query.isLoading);
  
  // Check if all queries have completed (either success or error)
  const allQueriesCompleted = teamDetailsQueries.length > 0 && teamDetailsQueries.every(
    (query) => !query.isLoading && (query.data !== undefined || query.error !== undefined)
  );

  // Filter teams where the user is a member
  // Only filter after all queries have completed to avoid filtering out teams prematurely
  const userTeams = allQueriesCompleted && !isLoadingDetails
    ? allTeams.filter((team) => {
        const teamDetailQuery = teamDetailsQueries.find(
          (query) => query.data?.name === team.name
        );
        const teamDetail = teamDetailQuery?.data;
        
        if (!teamDetail) return false;
        
        // Check if user's email is in the team members list
        return teamDetail.members.some(
          (member) => member.email.toLowerCase() === user.email?.toLowerCase()
        );
      })
    : [];

  return {
    data: userTeams,
    isLoading: isLoadingTeams || isLoadingDetails || !allQueriesCompleted,
  };
};

export const useTeam = (teamName: string) => {
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['teams', teamName],
    queryFn: () => teamsService.getById(teamName),
    enabled: !loading && !!user && !!teamName, // Only fetch when user is authenticated and teamName is provided
    staleTime: 1000 * 60 * 5,
  });
};

export const useCreateTeam = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ team, teamDetail }: { team: Team; teamDetail: TeamDetailData }) =>
      teamsService.create(team, teamDetail),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });
};

export const useUpdateTeam = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ teamName, updates }: { teamName: string; updates: Partial<Team> }) =>
      teamsService.update(teamName, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['teams', variables.teamName] });
    },
  });
};

export const useUpdateTeamDetail = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ teamName, updates }: { teamName: string; updates: Partial<TeamDetailData> }) =>
      teamsService.updateDetail(teamName, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['teams', variables.teamName] });
    },
  });
};

export const useDeleteTeam = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (teamName: string) => teamsService.delete(teamName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });
};

// Team join request hooks
export const useJoinRequests = () => {
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['teamJoinRequests'],
    queryFn: () => teamJoinRequestsService.getPendingRequests(),
    enabled: !loading && !!user, // Only fetch when user is authenticated
    staleTime: 0, // Always consider data stale to allow immediate refetches
    refetchInterval: 1000 * 5, // Auto-refresh every 5 seconds for faster updates
    refetchOnWindowFocus: true, // Refetch when user returns to the tab
    refetchOnMount: true, // Always refetch when component mounts
  });
};

export const useRequestJoinTeam = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (teamName: string) => teamJoinRequestsService.requestJoin(teamName),
    onSuccess: () => {
      // Immediately refetch to show the new request
      queryClient.refetchQueries({ queryKey: ['teamJoinRequests'] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });
};

export const useApproveJoinRequest = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (requestId: string) => teamJoinRequestsService.approveRequest(requestId),
    onSuccess: () => {
      // Immediately refetch to remove the approved request from the list
      queryClient.refetchQueries({ queryKey: ['teamJoinRequests'] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });
};

export const useRejectJoinRequest = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (requestId: string) => teamJoinRequestsService.rejectRequest(requestId),
    onSuccess: () => {
      // Immediately refetch to remove the rejected request from the list
      queryClient.refetchQueries({ queryKey: ['teamJoinRequests'] });
    },
  });
};

export const useRemoveTeamMember = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ teamName, memberEmail }: { teamName: string; memberEmail: string }) =>
      teamsService.removeMember(teamName, memberEmail),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['teams', variables.teamName] });
    },
  });
};

export const useLeaveTeam = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (teamName: string) => teamsService.leaveTeam(teamName),
    onSuccess: (_, teamName) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['teams', teamName] });
    },
  });
};

// Team invitation hooks
export const useInvitations = () => {
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['teamInvitations'],
    queryFn: () => teamInvitationsService.getInvitations(),
    enabled: !loading && !!user, // Only fetch when user is authenticated
    staleTime: 0, // Always consider data stale to allow immediate refetches
    refetchInterval: 1000 * 5, // Auto-refresh every 5 seconds for faster updates
    refetchOnWindowFocus: true, // Refetch when user returns to the tab
    refetchOnMount: true, // Always refetch when component mounts
  });
};

export const useInviteTeamMember = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ teamName, inviteeEmail }: { teamName: string; inviteeEmail: string }) =>
      teamInvitationsService.inviteMember(teamName, inviteeEmail),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teamInvitations'] });
    },
  });
};

export const useAcceptInvitation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (invitationId: string) => teamInvitationsService.acceptInvitation(invitationId),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['teamInvitations'] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });
};

export const useDeclineInvitation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (invitationId: string) => teamInvitationsService.declineInvitation(invitationId),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['teamInvitations'] });
    },
  });
};

