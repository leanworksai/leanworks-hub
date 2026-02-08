/**
 * Plans AI API Service Layer
 * Handles communication with Python backend for AI features
 */

import type { Plan } from '@/types/plans';
import { API_CONFIG } from '@/config/api';

interface AIHeaders {
  'Content-Type': 'application/json';
  'x-api-key'?: string;
}

async function callAIApi(endpoint: string, method: string, body?: any): Promise<any> {
  const headers: AIHeaders = {
    'Content-Type': 'application/json',
  };

  if (API_CONFIG.aiApiKey) {
    headers['x-api-key'] = API_CONFIG.aiApiKey;
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_CONFIG.ai}${endpoint}`, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `API error: ${response.statusText}`);
  }

  return response.json();
}

export interface ResourcePlanStrategy {
  strategy: 'cost-optimized' | 'time-optimized' | 'quality-optimized';
  rationale: string;
  total_cost: number;
  estimated_duration_weeks: number;
  team_size: number;
  risk_level: 'low' | 'medium' | 'high';
  resource_allocations: Array<{
    user_email: string;
    user_name: string;
    role: string;
    allocation_percentage: number;
    hourly_rate: number;
    estimated_hours: number;
  }>;
  expected_outcomes: string[];
  trade_offs: string[];
}

export interface PlanInsights {
  summary: string;
  risks: Array<{
    title: string;
    severity: 'low' | 'medium' | 'high';
    description: string;
    impact: string;
  }>;
  recommendations: Array<{
    title: string;
    priority: 'low' | 'medium' | 'high';
    description: string;
    expected_impact: string;
  }>;
  predictions: {
    budget_trend: 'on_track' | 'at_risk' | 'over_budget';
    timeline_trend: 'on_track' | 'at_risk' | 'delayed';
    estimated_completion_date: string;
    confidence_level: 'low' | 'medium' | 'high';
  };
  quick_insight: string;
}

export const plansAIApi = {
  /**
   * Generate AI resource allocation plans
   */
  async generateResourcePlans(
    userId: string,
    orgSlug: string,
    sessionId: string,
    planData: {
      plan_name: string;
      plan_objectives: any[];
      total_budget: number;
      budget_categories: any[];
      start_date: string;
      end_date: string;
      team_members: any[];
    }
  ): Promise<ResourcePlanStrategy[]> {
    const response = await callAIApi('/plans/generate-resource-plan', 'POST', {
      user_id: userId,
      org_slug: orgSlug,
      session_id: sessionId,
      stream: false,
      ...planData,
    });

    return response.strategies || [];
  },

  /**
   * Generate AI insights for a plan
   */
  async generateInsights(
    userId: string,
    orgSlug: string,
    sessionId: string,
    planData: {
      plan_id: string;
      plan_name: string;
      plan_status: string;
      health_score: number;
      total_budget: number;
      spent_to_date: number;
      objectives: any[];
      resource_allocations: any[];
      milestones: any[];
      team_size: number;
    }
  ): Promise<PlanInsights> {
    const response = await callAIApi('/plans/generate-insights', 'POST', {
      user_id: userId,
      org_slug: orgSlug,
      session_id: sessionId,
      stream: false,
      ...planData,
    });

    return response;
  },

  /**
   * Generate AI quick insight (summary for list view)
   */
  async generateQuickInsight(
    userId: string,
    orgSlug: string,
    plan: Plan
  ): Promise<string> {
    try {
      const insights = await this.generateInsights(
        userId,
        orgSlug,
        `quick-insight-${plan.id}`,
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
      return insights.quick_insight || 'No insights available';
    } catch (error) {
      console.error('Error generating quick insight:', error);
      return 'Unable to generate insights';
    }
  },
};
