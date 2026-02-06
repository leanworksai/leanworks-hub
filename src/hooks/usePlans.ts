// Plans Hooks - Mock hooks for Plans CRUD operations

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mockPlans, getPlanById, getPlansByStatus, type Plan } from '@/data/plansData';
import { useToast } from '@/hooks/use-toast';

// Simulate API delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Get all plans
 */
export const usePlans = () => {
  return useQuery({
    queryKey: ['plans'],
    queryFn: async (): Promise<Plan[]> => {
      await delay(300); // Simulate network delay
      return mockPlans;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

/**
 * Get single plan by ID
 */
export const usePlanById = (planId: string) => {
  return useQuery({
    queryKey: ['plans', planId],
    queryFn: async (): Promise<Plan | undefined> => {
      await delay(200);
      return getPlanById(planId);
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
    queryFn: async (): Promise<Plan[]> => {
      await delay(300);
      return getPlansByStatus(status);
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
    mutationFn: async (newPlan: Partial<Plan>): Promise<Plan> => {
      await delay(500);
      
      // Generate ID
      const id = `plan-${Date.now()}`;
      
      const plan: Plan = {
        id,
        name: newPlan.name || 'Untitled Plan',
        description: newPlan.description || '',
        objectives: newPlan.objectives || [],
        totalBudget: newPlan.totalBudget || 0,
        currency: newPlan.currency || 'USD',
        budgetCategories: newPlan.budgetCategories || [],
        spentToDate: 0,
        startDate: newPlan.startDate || new Date().toISOString(),
        endDate: newPlan.endDate || new Date().toISOString(),
        projectIds: [],
        resourceAllocations: [],
        milestones: [],
        status: 'planning',
        healthScore: 100,
        healthTrend: 'stable',
        ownerEmail: newPlan.ownerEmail || '',
        ownerName: newPlan.ownerName || '',
        teamSize: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        recentActivity: [],
      };
      
      // In a real app, this would be sent to the server
      mockPlans.push(plan);
      
      return plan;
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
        description: 'Failed to create plan. Please try again.',
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
      updates: Partial<Plan> 
    }): Promise<Plan> => {
      await delay(500);
      
      const planIndex = mockPlans.findIndex(p => p.id === planId);
      if (planIndex === -1) {
        throw new Error('Plan not found');
      }
      
      const updatedPlan = {
        ...mockPlans[planIndex],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      
      mockPlans[planIndex] = updatedPlan;
      
      return updatedPlan;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      queryClient.invalidateQueries({ queryKey: ['plans', data.id] });
      toast({
        title: 'Plan Updated',
        description: `${data.name} has been updated successfully.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to update plan. Please try again.',
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
      await delay(500);
      
      const planIndex = mockPlans.findIndex(p => p.id === planId);
      if (planIndex === -1) {
        throw new Error('Plan not found');
      }
      
      mockPlans.splice(planIndex, 1);
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
        description: 'Failed to delete plan. Please try again.',
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
  const { data: plans = [], isLoading } = usePlans();
  
  const filteredAndSorted = useMemo(() => {
    let filtered = [...plans];
    
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(plan => 
        plan.name.toLowerCase().includes(query) ||
        plan.description.toLowerCase().includes(query)
      );
    }
    
    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(plan => plan.status === statusFilter);
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'health':
          return b.healthScore - a.healthScore;
        case 'budget':
          return b.totalBudget - a.totalBudget;
        case 'timeline':
          return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
        default:
          return 0;
      }
    });
    
    return filtered;
  }, [plans, searchQuery, statusFilter, sortBy]);
  
  return {
    plans: filteredAndSorted,
    isLoading,
  };
};
