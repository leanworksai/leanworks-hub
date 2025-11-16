import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { projectsService } from '@/services/firestore';
import type { Project } from '@/data/projectsData';
import { useUserTeams } from './useTeams';
import { useAuth } from '@/contexts/AuthContext';
import { teamsService } from '@/services/firestore';

export const useProjects = () => {
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsService.getAll(),
    enabled: !loading && !!user, // Only fetch when user is authenticated
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

// Hook to get projects filtered by current user's team membership
export const useUserProjects = () => {
  const { user } = useAuth();
  const { data: allProjects = [], isLoading: isLoadingProjects } = useProjects();
  const { data: userTeams = [], isLoading: isLoadingTeams } = useUserTeams();

  // Fetch team details for all user teams to get member names
  const teamDetailsQueries = useQueries({
    queries: userTeams.map((team) => ({
      queryKey: ['teams', team.id],
      queryFn: () => teamsService.getById(team.id),
      enabled: !!team.id && !!user?.email,
      staleTime: 1000 * 60 * 5,
    })),
  });

  // Check if all team details are loaded
  const isLoadingDetails = teamDetailsQueries.some((query) => query.isLoading);
  
  // Check if all queries have completed
  const allQueriesCompleted = teamDetailsQueries.length === 0 || teamDetailsQueries.every(
    (query) => !query.isLoading && (query.data !== undefined || query.error !== undefined)
  );

  // Get all team member names from user's teams
  const userTeamMemberNames = new Set<string>();
  if (allQueriesCompleted && !isLoadingDetails) {
    teamDetailsQueries.forEach((query) => {
      if (query.data?.members) {
        query.data.members.forEach((member) => {
          userTeamMemberNames.add(member.name.toLowerCase());
        });
      }
    });
  }

  // Get user's email for owner check
  const userEmail = user?.email?.toLowerCase();

  // Filter projects where:
  // 1. User is the owner, OR
  // 2. At least one project member is from user's teams (by name match), OR
  // 3. User is a project member (by email match)
  const userProjects = allQueriesCompleted && !isLoadingDetails
    ? allProjects.filter((project) => {
        // Always show projects where user is the owner
        if (userEmail && project.ownerEmail?.toLowerCase() === userEmail) {
          return true;
        }
        
        // Check if user is a project member by email
        if (userEmail && project.members.some((member) => 
          member.email?.toLowerCase() === userEmail
        )) {
          return true;
        }
        
        // Check if any project member is from user's teams (by name match)
        if (userTeamMemberNames.size > 0) {
          return project.members.some((member) =>
            userTeamMemberNames.has(member.name.toLowerCase())
          );
        }
        
        return false;
      })
    : [];

  return {
    data: userProjects,
    isLoading: isLoadingProjects || isLoadingTeams || isLoadingDetails || !allQueriesCompleted,
  };
};

export const useProject = (projectId: string) => {
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => projectsService.getById(projectId),
    enabled: !loading && !!user && !!projectId, // Only fetch when user is authenticated and projectId is provided
    staleTime: 1000 * 60 * 5,
  });
};

export const useCreateProject = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (project: Project) => projectsService.create(project),
    onSuccess: () => {
      // Invalidate and refetch to show the new project immediately
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.refetchQueries({ queryKey: ['projects'] });
    },
  });
};

export const useUpdateProject = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ projectId, updates }: { projectId: string; updates: Partial<Project> }) =>
      projectsService.update(projectId, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] });
    },
  });
};

export const useDeleteProject = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (projectId: string) => projectsService.delete(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
};

