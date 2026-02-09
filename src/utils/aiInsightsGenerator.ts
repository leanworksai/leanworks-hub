/**
 * AI Insights Generator - Call AI API to generate insights
 */

import { plansAIApi, type PlanInsights } from '@/services/plansAI';
import type { Plan } from '@/types/plans';

export interface AIInsights extends PlanInsights {}

/**
 * Generate AI insights for a plan by calling API
 */
export const generatePlanInsights = async (
  userId: string,
  orgSlug: string,
  plan: Plan
): Promise<AIInsights> => {
  try {
    const sessionId = `insights-${plan.id}-${Date.now()}`;

    const insights = await plansAIApi.generateInsights(
      userId,
      orgSlug,
      sessionId,
      {
        plan_id: plan.id,
        plan_name: plan.name,
        plan_status: plan.status,
        health_score: plan.healthScore,
        total_budget: plan.totalBudget,
        spent_to_date: plan.spentToDate,
        objectives: plan.objectives || [],
        resource_allocations: plan.resourceAllocations || [],
        milestones: plan.milestones || [],
        team_size: plan.teamSize,
      }
    );

    return insights;
  } catch (error) {
    console.error('Error generating insights:', error);
    // Return default insights on error
    return {
      summary: 'Unable to generate insights at this time',
      risks: [],
      recommendations: [],
      predictions: {
        budget_trend: 'on_track',
        timeline_trend: 'on_track',
        estimated_completion_date: plan.endDate,
        confidence_level: 'low',
      },
      quick_insight: 'Plan status unavailable',
    };
  }
};

/**
 * Generate quick insight (summary for list view)
 */
export const generateQuickInsight = async (
  userId: string,
  orgSlug: string,
  plan: Plan
): Promise<string> => {
  try {
    const insights = await generatePlanInsights(userId, orgSlug, plan);
    return insights.quick_insight || 'No insights available';
  } catch (error) {
    console.error('Error generating quick insight:', error);
    return 'Unable to generate insight';
  }
};
