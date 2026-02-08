// Plans Hooks - Real API integration with React Query

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { plansApi } from '@/services/plans';
import { useToast } from '@/hooks/use-toast';
import type { Plan, CreatePlanInput, UpdatePlanInput } from '@/types/plans';

/**
 * Get all plans with optional filters
 */
export const usePlans = (filters?: {
  status?: string;
  search?: string;
  sortBy?: 'name' | 'health' | 'budget' | 'timeline';
}) => {
  return useQuery({
    queryKey: ['plans', filters],
    queryFn: async () => {
      const data = await plansApi.getAll(filters);
      return data as Plan[];
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

/**
 * Get single plan by ID with all nested data
 */
export const usePlanById = (planId: string) => {
  return useQuery({
    queryKey: ['plans', planId],
    queryFn: async () => {
      const data = await plansApi.getById(planId);
      return data as Plan;
    },
    enabled: !!planId,
    staleTime: 1000 * 60 * 5,
  });
};

/**
 * Get plans by status
 */
export const usePlansByStatus = (status: Plan['status']) => {
  return useQuery({
    queryKey: ['plans', 'status', status],
    queryFn: async () => {
      const data = await plansApi.getAll({ status });
      return data as Plan[];
    },
    staleTime: 1000 * 60 * 5,
  });
};

/**
 * Get projects for a plan
 */
export const usePlanProjects = (planId: string) => {
  const { data: plan } = usePlanById(planId);
  
  return useMemo(() => {
    return plan?.projectIds || [];
  }, [plan]);
};

/**
 * Create new plan
 */
export const useCreatePlan = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (newPlan: CreatePlanInput): Promise<Plan> => {
      const result = await plansApi.create(newPlan);
      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast({
        title: 'Plan Created',
        description: `${data.name} has been created successfully.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create plan. Please try again.',
        variant: 'destructive',
      });
    },
  });
};

/**
 * Update existing plan
 */
export const useUpdatePlan = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ 
      planId, 
      updates 
    }: { 
      planId: string; 
      updates: UpdatePlanInput 
    }): Promise<{ success: boolean }> => {
      return plansApi.update(planId, updates);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      queryClient.invalidateQueries({ queryKey: ['plans', variables.planId] });
      toast({
        title: 'Plan Updated',
        description: 'Plan has been updated successfully.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update plan. Please try again.',
        variant: 'destructive',
      });
    },
  });
};

/**
 * Delete plan
 */
export const useDeletePlan = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (planId: string): Promise<void> => {
      await plansApi.delete(planId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast({
        title: 'Plan Deleted',
        description: 'Plan has been deleted successfully.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete plan. Please try again.',
        variant: 'destructive',
      });
    },
  });
};

/**
 * Hook for filtering and sorting plans
 */
export const useFilteredPlans = (
  searchQuery: string = '',
  statusFilter: Plan['status'] | 'all' = 'all',
  sortBy: 'name' | 'health' | 'budget' | 'timeline' = 'name'
) => {
  const filters = {
    search: searchQuery || undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
    sortBy: sortBy !== 'name' ? sortBy : undefined,
  };

  const { data: plans = [], isLoading, error } = usePlans(filters);
  
  return {
    plans,
    isLoading,
    error,
  };
};
