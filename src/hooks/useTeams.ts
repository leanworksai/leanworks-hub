import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teamsService } from '@/services/firestore';
import type { Team, TeamDetailData } from '@/data/teamsData';

export const useTeams = () => {
  return useQuery({
    queryKey: ['teams'],
    queryFn: () => teamsService.getAll(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

export const useTeam = (teamName: string) => {
  return useQuery({
    queryKey: ['teams', teamName],
    queryFn: () => teamsService.getById(teamName),
    enabled: !!teamName,
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

