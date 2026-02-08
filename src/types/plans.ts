/**
 * Plans TypeScript Interfaces and Types
 */

export interface Objective {
  id: string;
  text: string;
  targetValue: number;
  currentValue: number;
  unit: 'percentage' | 'count' | 'currency';
  dueDate?: string;
  status: 'on-track' | 'at-risk' | 'completed';
}

export interface BudgetCategory {
  id: string;
  name: string;
  allocatedAmount: number;
  spentAmount: number;
  projectId?: string;
}

export interface ResourceAllocation {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  planId: string;
  projectId?: string;
  allocationPercentage: number; // 0-100
  startDate: string;
  endDate: string;
  role: string;
  hourlyRate?: number;
  normalizedHours?: number;
}

export interface Milestone {
  id: string;
  name: string;
  dueDate: string;
  status: 'pending' | 'completed' | 'at-risk';
  description?: string;
}

export interface PlanActivityEvent {
  id: string;
  type: 'project_update' | 'budget_change' | 'milestone' | 'resource_change';
  title: string;
  description: string;
  timestamp: string;
  userId?: string;
  userName?: string;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  objectives: Objective[];
  totalBudget: number;
  currency: string;
  budgetCategories: BudgetCategory[];
  spentToDate: number;
  startDate: string;
  endDate: string;
  projectIds: string[];
  resourceAllocations: ResourceAllocation[];
  milestones: Milestone[];
  status: 'planning' | 'active' | 'at-risk' | 'completed';
  healthScore: number; // 0-100
  healthTrend: 'up' | 'down' | 'stable';
  ownerEmail: string;
  ownerName: string;
  teamSize: number;
  createdAt: string;
  updatedAt: string;
  recentActivity: PlanActivityEvent[];
  /** AI one-line summary from backend DB (list view) */
  aiQuickInsight?: string | null;
  /** Full AI insights from backend DB (detail view) */
  aiInsights?: PlanStoredInsights | null;
}

/** AI insights as stored in DB (matches PlanInsights from plansAI) */
export interface PlanStoredInsights {
  summary: string;
  risks: Array<{ title: string; severity: string; description: string; impact: string }>;
  recommendations: Array<{ title: string; priority: string; description: string; expected_impact: string }>;
  predictions: {
    budget_trend: string;
    timeline_trend: string;
    estimated_completion_date: string;
    confidence_level: string;
  };
  quick_insight: string;
}

// API Input Types for Validation

export interface CreateObjectiveInput {
  text: string;
  targetValue: number;
  currentValue?: number;
  unit: 'percentage' | 'count' | 'currency';
  dueDate?: string;
  status?: 'on-track' | 'at-risk' | 'completed';
}

export interface UpdateObjectiveInput extends Partial<CreateObjectiveInput> {}

export interface CreateBudgetCategoryInput {
  name: string;
  allocatedAmount: number;
  spentAmount?: number;
  projectId?: string | null;
}

export interface UpdateBudgetCategoryInput extends Partial<CreateBudgetCategoryInput> {}

export interface CreateResourceAllocationInput {
  userEmail: string;
  userName?: string;
  allocationPercentage: number;
  startDate: string;
  endDate: string;
  role?: string;
  hourlyRate?: number;
  normalizedHours?: number;
  projectId?: string | null;
}

export interface UpdateResourceAllocationInput extends Partial<CreateResourceAllocationInput> {}

export interface CreateMilestoneInput {
  name: string;
  dueDate: string;
  status?: 'pending' | 'completed' | 'at-risk';
  description?: string;
}

export interface UpdateMilestoneInput extends Partial<CreateMilestoneInput> {}

export interface CreatePlanInput {
  name: string;
  description?: string;
  status?: 'planning' | 'active' | 'at-risk' | 'completed';
  startDate: string;
  endDate: string;
  totalBudget: number;
  currency?: string;
  spentToDate?: number;
  ownerEmail: string;
  ownerName?: string;
  teamSize?: number;
  objectives?: CreateObjectiveInput[];
  budgetCategories?: CreateBudgetCategoryInput[];
  resourceAllocations?: CreateResourceAllocationInput[];
  milestones?: CreateMilestoneInput[];
  projectIds?: string[];
}

export interface UpdatePlanInput extends Partial<Omit<CreatePlanInput, 'ownerEmail'>> {}

export interface LinkProjectInput {
  projectId: string;
}
