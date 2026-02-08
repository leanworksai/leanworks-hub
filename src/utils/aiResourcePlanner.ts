/**
 * AI Resource Planner - Call AI API to generate optimized resource allocation strategies
 */

import { plansAIApi, type ResourcePlanStrategy } from '@/services/plansAI';
import type { Plan, ResourceAllocation } from '@/types/plans';

export interface AIResourcePlan {
  strategy: 'cost' | 'time' | 'quality';
  strategyName: string;
  totalCost: number;
  estimatedDuration: number; // in weeks
  teamSize: number;
  riskLevel: 'low' | 'medium' | 'high';
  allocations: ResourceAllocation[];
  metrics: {
    avgAllocationPercentage: number;
    totalWeeklyHours: number;
    utilizationRate: number;
  };
  analysis: {
    rationale: string;
    tradeoffs: string[];
    expectedOutcomes: string[];
  };
}

/**
 * Generate 3 resource allocation strategies by calling AI API
 */
export const generateResourcePlans = async (
  userId: string,
  orgSlug: string,
  plan: Plan
): Promise<AIResourcePlan[]> => {
  try {
    const sessionId = `resource-plan-${plan.id}-${Date.now()}`;

    // Get team members from resource allocations if available
    const teamMembers = plan.resourceAllocations?.map(ra => ({
      email: ra.userEmail,
      name: ra.userName,
      role: ra.role,
      hourly_rate: ra.hourlyRate || 0,
    })) || [];

    const strategies = await plansAIApi.generateResourcePlans(
      userId,
      orgSlug,
      sessionId,
      {
        plan_name: plan.name,
        plan_objectives: plan.objectives || [],
        total_budget: plan.totalBudget,
        budget_categories: plan.budgetCategories || [],
        start_date: plan.startDate,
        end_date: plan.endDate,
        team_members: teamMembers,
      }
    );

    // Transform API response to AIResourcePlan format
    return strategies.map((strategy: ResourcePlanStrategy): AIResourcePlan => {
      const strategyMap = {
        'cost-optimized': 'cost',
        'time-optimized': 'time',
        'quality-optimized': 'quality',
      } as const;

      const allocations: ResourceAllocation[] = strategy.resource_allocations.map((alloc) => ({
        id: `alloc-${alloc.user_email}`,
        userId: alloc.user_email,
        userEmail: alloc.user_email,
        userName: alloc.user_name,
        planId: plan.id,
        allocationPercentage: alloc.allocation_percentage,
        startDate: plan.startDate,
        endDate: plan.endDate,
        role: alloc.role,
        hourlyRate: alloc.hourly_rate,
        normalizedHours: alloc.estimated_hours,
        projectId: undefined,
      }));

      const totalTeamMembers = allocations.length;
      const avgAllocationPercentage = totalTeamMembers > 0
        ? Math.round(allocations.reduce((sum, a) => sum + a.allocationPercentage, 0) / totalTeamMembers)
        : 0;
      const totalWeeklyHours = Math.round(
        allocations.reduce((sum, a) => sum + ((a.normalizedHours || 40) * (a.allocationPercentage / 100)), 0)
      );
      const utilizationRate = avgAllocationPercentage;

      return {
        strategy: strategyMap[strategy.strategy],
        strategyName: strategy.strategy === 'cost-optimized' ? 'Cost-Optimized' 
                    : strategy.strategy === 'time-optimized' ? 'Time-Optimized'
                    : 'Quality-Optimized',
        totalCost: strategy.total_cost,
        estimatedDuration: strategy.estimated_duration_weeks,
        teamSize: strategy.team_size,
        riskLevel: strategy.risk_level,
        allocations,
        metrics: {
          avgAllocationPercentage,
          totalWeeklyHours,
          utilizationRate,
        },
        analysis: {
          rationale: strategy.rationale,
          tradeoffs: strategy.trade_offs,
          expectedOutcomes: strategy.expected_outcomes,
        },
      };
    });
  } catch (error) {
    console.error('Error generating resource plans:', error);
    // Return empty array on error - UI should handle gracefully
    return [];
  }
};
