import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsService } from '@/services/api';
import type { Project } from '@/data/projectsData';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';

export const useProjects = () => {
  const { user, loading } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['projects', currentOrg?.id],
    queryFn: () => projectsService.getAll(),
    enabled: !loading && !orgLoading && !!user && !!currentOrg, // Only fetch when user is authenticated and org is selected
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

// Hook to get projects accessible to the current user
// Backend already filters projects based on visibility rules only
export const useUserProjects = () => {
  // Backend already handles access control - it only returns projects where:
  // 1. User is the project owner, OR
  // 2. Project visibility is 'all_members' (default - visible to all org members), OR
  // 3. Project visibility is 'specific_members' and user is in visible_to_members
  // Note: project_members table is NOT used for access control - only visibility rules apply
  // So we can just return the projects directly without additional filtering
  return useProjects();
};

export const useProject = (projectId: string) => {
  const { user, loading } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['projects', projectId, currentOrg?.id],
    queryFn: () => projectsService.getById(projectId),
    enabled: !loading && !orgLoading && !!user && !!currentOrg && !!projectId, // Only fetch when user is authenticated and projectId is provided
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

export const useAddProjectMember = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ projectId, memberEmail, role, avatar }: { 
      projectId: string; 
      memberEmail: string; 
      role?: string; 
      avatar?: string;
    }) => projectsService.addMember(projectId, memberEmail, role, avatar),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] });
    },
  });
};

export const useRemoveProjectMember = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ projectId, memberEmail }: { projectId: string; memberEmail: string }) =>
      projectsService.removeMember(projectId, memberEmail),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] });
    },
  });
};

