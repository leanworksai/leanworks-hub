import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksService } from '@/services/api';
import type { Task } from '@/data/tasksData';
import { useUserProjects } from './useProjects';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';

export const useTasks = () => {
  const { user, loading } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['tasks', currentOrg?.id],
    queryFn: () => tasksService.getAll(),
    enabled: !loading && !orgLoading && !!user && !!currentOrg, // Only fetch when user is authenticated and org is selected
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

// Hook to get tasks filtered by current user's project membership
// Tasks without projects are only visible to creator and assignee
export const useUserTasks = () => {
  const { data: allTasks = [], isLoading: isLoadingTasks } = useTasks();
  const { data: userProjects = [], isLoading: isLoadingProjects } = useUserProjects();
  const { user } = useAuth();

  // Create a set of project IDs from user's projects
  const userProjectIds = new Set(
    userProjects.map((project) => project.id)
  );

  // Create a set of project names from user's projects (for backward compatibility with legacy tasks)
  const userProjectNames = new Set(
    userProjects.map((project) => project.name.toLowerCase())
  );

  // Get current user email for filtering tasks without projects
  const userEmail = user?.email?.toLowerCase();

  // Filter tasks to show:
  // 1. Tasks whose project is in user's projects (matched by ID or name)
  // 2. Tasks without a project - only visible to creator or assignee
  const userTasks = allTasks.filter((task) => {
    // If task has a project, check if it's in user's projects
    if (task.projectId) {
      // Match by project ID (UUID format)
      if (userProjectIds.has(task.projectId)) {
        return true;
      }
      // Fallback: if projectId is actually a name (legacy data), try matching by name
      if (userProjectNames.has(task.projectId.toLowerCase())) {
        return true;
      }
      // Task has a project but user doesn't have access - don't show it
      return false;
    }
    
    // If task has project name but no ID (legacy format)
    if (task.project) {
      if (userProjectNames.has(task.project.toLowerCase())) {
        return true;
      }
      // Task has a project but user doesn't have access - don't show it
      return false;
    }
    
    // If task has no project, check task visibility
    if (!userEmail) {
      return false;
    }
    const isCreator = task.createdBy?.toLowerCase() === userEmail;
    const isAssignee = task.assigneeId?.toLowerCase() === userEmail;
    
    // Creator or assignee always has access
    if (isCreator || isAssignee) {
      return true;
    }
    
    // Check task visibility
    const taskVisibility = task.visibility || 'all_members';
    
    // If visibility is 'all_members', all org members can see it
    if (taskVisibility === 'all_members') {
      return true;
    }
    
    // If visibility is 'specific_members', check if user is in visibleToMembers
    if (taskVisibility === 'specific_members') {
      const visibleToMembers = task.visibleToMembers || [];
      return visibleToMembers.some((email: string) => email.toLowerCase() === userEmail);
    }
    
    // Default: only creator and assignee (shouldn't reach here with current logic)
    return false;
  });

  return {
    data: userTasks,
    isLoading: isLoadingTasks || isLoadingProjects,
  };
};

export const useTask = (taskId: string) => {
  const { user, loading } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['tasks', taskId, currentOrg?.id],
    queryFn: () => tasksService.getById(taskId),
    enabled: !loading && !orgLoading && !!user && !!currentOrg && !!taskId, // Only fetch when user is authenticated and taskId is provided
    staleTime: 1000 * 60 * 5,
  });
};

export const useTasksByProject = (projectId: string) => {
  const { user, loading } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['tasks', 'project', projectId, currentOrg?.id],
    queryFn: () => tasksService.getByProject(projectId),
    enabled: !loading && !orgLoading && !!user && !!currentOrg && !!projectId, // Only fetch when user is authenticated and projectId is provided
    staleTime: 1000 * 60 * 5,
  });
};

export const useCreateTask = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (task: Task) => {
      try {
        return await tasksService.create(task);
      } catch (error: any) {
        // Enhance error messages for validation failures
        if (error.message === 'Failed to create task' && error instanceof Error) {
          // Try to extract validation details if available
          console.error('Task creation error details:', error);
        }
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
};

export const useUpdateTask = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ taskId, updates }: { taskId: string; updates: Partial<Task> }) =>
      tasksService.update(taskId, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.taskId] });
    },
  });
};

export const useDeleteTask = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (taskId: string) => tasksService.delete(taskId),
    onSuccess: (_, taskId) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', taskId] });
      // Also invalidate all project-specific task queries
      queryClient.invalidateQueries({ queryKey: ['tasks', 'project'] });
    },
  });
};

