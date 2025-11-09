import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksService } from '@/services/firestore';
import type { Task } from '@/data/tasksData';
import { useUserProjects } from './useProjects';
import { useUserTeams } from './useTeams';
import { useAuth } from '@/contexts/AuthContext';

export const useTasks = () => {
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksService.getAll(),
    enabled: !loading && !!user, // Only fetch when user is authenticated
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

// Hook to get tasks filtered by current user's team membership (via projects or teams)
export const useUserTasks = () => {
  const { data: allTasks = [], isLoading: isLoadingTasks } = useTasks();
  const { data: userProjects = [], isLoading: isLoadingProjects } = useUserProjects();
  const { data: userTeams = [], isLoading: isLoadingTeams } = useUserTeams();

  // Create a set of project names from user's projects
  const userProjectNames = new Set(
    userProjects.map((project) => project.name.toLowerCase())
  );

  // Create a set of team names from user's teams
  const userTeamNames = new Set(
    userTeams.map((team) => team.name.toLowerCase())
  );

  // Filter tasks to show:
  // 1. Tasks whose project is in user's projects
  // 2. Tasks without a project but associated with user's teams
  const userTasks = allTasks.filter((task) => {
    // If task has a project, check if it's in user's projects
    if (task.project || task.projectId) {
      const projectName = (task.project?.toLowerCase() || task.projectId?.toLowerCase());
      return projectName && userProjectNames.has(projectName);
    }
    
    // If task has no project, check if it's associated with user's teams
    if (task.teams && task.teams.length > 0) {
      return task.teams.some(teamName => 
        userTeamNames.has(teamName.toLowerCase())
      );
    }
    
    return false;
  });

  return {
    data: userTasks,
    isLoading: isLoadingTasks || isLoadingProjects || isLoadingTeams,
  };
};

export const useTask = (taskId: string) => {
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['tasks', taskId],
    queryFn: () => tasksService.getById(taskId),
    enabled: !loading && !!user && !!taskId, // Only fetch when user is authenticated and taskId is provided
    staleTime: 1000 * 60 * 5,
  });
};

export const useTasksByProject = (projectId: string) => {
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['tasks', 'project', projectId],
    queryFn: () => tasksService.getByProject(projectId),
    enabled: !loading && !!user && !!projectId, // Only fetch when user is authenticated and projectId is provided
    staleTime: 1000 * 60 * 5,
  });
};

export const useCreateTask = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (task: Task) => tasksService.create(task),
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

