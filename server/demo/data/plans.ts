/**
 * Mock demo plans for demo mode
 */

export interface Plan {
  id: string;
  name: string;
  description?: string;
  status: 'planning' | 'active' | 'at-risk' | 'completed';
  start_date?: string;
  end_date?: string;
  total_budget: number;
  currency: string;
  spent_to_date: number;
  owner_email: string;
  owner_name?: string;
  team_size: number;
  health_score: number; // 0-100
  health_trend: 'up' | 'down' | 'stable';
  created_at: string;
  updated_at: string;
}

export interface PlanObjective {
  id: string;
  plan_id: string;
  text: string;
  target_value: number;
  current_value: number;
  unit: 'percentage' | 'count' | 'currency';
  due_date?: string;
  status: 'on-track' | 'at-risk' | 'completed';
  created_at: string;
  updated_at: string;
}

export interface PlanBudgetCategory {
  id: string;
  plan_id: string;
  name: string;
  allocated_amount: number;
  spent_amount: number;
  project_id?: string;
  created_at: string;
  updated_at: string;
}

export interface PlanResourceAllocation {
  id: string;
  plan_id: string;
  user_email: string;
  user_name: string;
  allocation_percentage: number;
  start_date?: string;
  end_date?: string;
  role?: string;
  hourly_rate?: number;
  normalized_hours?: number;
  project_id?: string;
  created_at: string;
  updated_at: string;
}

export interface PlanMilestone {
  id: string;
  plan_id: string;
  name: string;
  due_date: string;
  status: 'pending' | 'completed' | 'at-risk';
  description?: string;
  created_at: string;
  updated_at: string;
}

const getDueDateForDaysFromNow = (days: number): string => {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
};

const getDateForDaysFromNow = (days: number): string => {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
};

const getDateForDaysAgo = (days: number): string => {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
};

export const DEMO_PLANS: Plan[] = [
  {
    id: 'plan-001',
    name: 'Q1 2026 Product Initiative',
    description: 'Major product features and platform improvements for Q1',
    status: 'active',
    start_date: getDateForDaysAgo(30),
    end_date: getDateForDaysFromNow(60),
    total_budget: 250000,
    currency: 'USD',
    spent_to_date: 120000,
    owner_email: 'demo@example.com',
    owner_name: 'Demo User',
    team_size: 12,
    health_score: 82,
    health_trend: 'up',
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'plan-002',
    name: 'Platform Modernization & Scaling',
    description: 'Microservices migration and infrastructure improvements',
    status: 'active',
    start_date: getDateForDaysAgo(60),
    end_date: getDateForDaysFromNow(150),
    total_budget: 400000,
    currency: 'USD',
    spent_to_date: 180000,
    owner_email: 'sarah@example.com',
    owner_name: 'Sarah Chen',
    team_size: 8,
    health_score: 75,
    health_trend: 'stable',
    created_at: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'plan-003',
    name: 'AI & Automation Features',
    description: 'Implement AI-powered automation across the platform',
    status: 'planning',
    start_date: getDateForDaysFromNow(14),
    end_date: getDateForDaysFromNow(180),
    total_budget: 350000,
    currency: 'USD',
    spent_to_date: 45000,
    owner_email: 'alex@example.com',
    owner_name: 'Alex Rodriguez',
    team_size: 6,
    health_score: 88,
    health_trend: 'up',
    created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEMO_PLAN_OBJECTIVES: PlanObjective[] = [
  {
    id: 'obj-001',
    plan_id: 'plan-001',
    text: 'Increase user engagement by 25%',
    target_value: 25,
    current_value: 18,
    unit: 'percentage',
    due_date: getDueDateForDaysFromNow(60),
    status: 'on_track' as any,
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'obj-002',
    plan_id: 'plan-001',
    text: 'Launch 3 new product features',
    target_value: 3,
    current_value: 1,
    unit: 'count',
    due_date: getDueDateForDaysFromNow(60),
    status: 'on_track' as any,
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'obj-003',
    plan_id: 'plan-001',
    text: 'Reduce system latency by 40%',
    target_value: 40,
    current_value: 15,
    unit: 'percentage',
    due_date: getDueDateForDaysFromNow(60),
    status: 'on_track' as any,
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'obj-004',
    plan_id: 'plan-002',
    text: 'Complete microservices migration for auth and payments',
    target_value: 2,
    current_value: 1,
    unit: 'count',
    due_date: getDueDateForDaysFromNow(150),
    status: 'on_track' as any,
    created_at: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'obj-005',
    plan_id: 'plan-002',
    text: 'Improve deployment frequency to daily releases',
    target_value: 1,
    current_value: 0.5,
    unit: 'count',
    due_date: getDueDateForDaysFromNow(120),
    status: 'on_track' as any,
    created_at: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEMO_PLAN_BUDGET_CATEGORIES: PlanBudgetCategory[] = [
  {
    id: 'budget-001',
    plan_id: 'plan-001',
    name: 'Engineering Resources',
    allocated_amount: 120000,
    spent_amount: 65000,
    project_id: 'proj-001',
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'budget-002',
    plan_id: 'plan-001',
    name: 'Design & UX',
    allocated_amount: 60000,
    spent_amount: 35000,
    project_id: 'proj-004',
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'budget-003',
    plan_id: 'plan-001',
    name: 'Infrastructure & DevOps',
    allocated_amount: 50000,
    spent_amount: 20000,
    project_id: 'proj-005',
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'budget-004',
    plan_id: 'plan-002',
    name: 'Platform Modernization',
    allocated_amount: 250000,
    spent_amount: 120000,
    project_id: 'proj-001',
    created_at: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'budget-005',
    plan_id: 'plan-002',
    name: 'DevOps & Infrastructure',
    allocated_amount: 150000,
    spent_amount: 60000,
    project_id: 'proj-005',
    created_at: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'budget-006',
    plan_id: 'plan-003',
    name: 'AI Model Development',
    allocated_amount: 200000,
    spent_amount: 30000,
    project_id: 'proj-003',
    created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'budget-007',
    plan_id: 'plan-003',
    name: 'Integration & Deployment',
    allocated_amount: 150000,
    spent_amount: 15000,
    project_id: 'proj-003',
    created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEMO_PLAN_RESOURCE_ALLOCATIONS: PlanResourceAllocation[] = [
  {
    id: 'resource-001',
    plan_id: 'plan-001',
    user_email: 'demo@example.com',
    user_name: 'Demo User',
    allocation_percentage: 100,
    start_date: getDateForDaysAgo(30),
    end_date: getDateForDaysFromNow(60),
    role: 'Product Manager',
    hourly_rate: 85,
    normalized_hours: 160,
    project_id: 'proj-001',
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'resource-002',
    plan_id: 'plan-001',
    user_email: 'alex@example.com',
    user_name: 'Alex Rodriguez',
    allocation_percentage: 80,
    start_date: getDateForDaysAgo(30),
    end_date: getDateForDaysFromNow(60),
    role: 'Senior Developer',
    hourly_rate: 95,
    normalized_hours: 128,
    project_id: 'proj-001',
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'resource-003',
    plan_id: 'plan-001',
    user_email: 'jessica@example.com',
    user_name: 'Jessica Murphy',
    allocation_percentage: 60,
    start_date: getDateForDaysAgo(30),
    end_date: getDateForDaysFromNow(60),
    role: 'UI/UX Designer',
    hourly_rate: 75,
    normalized_hours: 96,
    project_id: 'proj-004',
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'resource-004',
    plan_id: 'plan-002',
    user_email: 'sarah@example.com',
    user_name: 'Sarah Chen',
    allocation_percentage: 100,
    start_date: getDateForDaysAgo(60),
    end_date: getDateForDaysFromNow(150),
    role: 'Engineering Lead',
    hourly_rate: 105,
    normalized_hours: 400,
    project_id: 'proj-001',
    created_at: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'resource-005',
    plan_id: 'plan-002',
    user_email: 'marcus@example.com',
    user_name: 'Marcus Thompson',
    allocation_percentage: 70,
    start_date: getDateForDaysAgo(60),
    end_date: getDateForDaysFromNow(150),
    role: 'DevOps Engineer',
    hourly_rate: 90,
    normalized_hours: 280,
    project_id: 'proj-005',
    created_at: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEMO_PLAN_MILESTONES: PlanMilestone[] = [
  {
    id: 'milestone-001',
    plan_id: 'plan-001',
    name: 'Complete Feature A MVP',
    due_date: getDueDateForDaysFromNow(20),
    status: 'pending' as any,
    description: 'First feature shipped to users',
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'milestone-002',
    plan_id: 'plan-001',
    name: 'Begin Beta Testing',
    due_date: getDueDateForDaysFromNow(35),
    status: 'pending',
    description: 'Launch beta program with 100 users',
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'milestone-003',
    plan_id: 'plan-001',
    name: 'Public Release',
    due_date: getDueDateForDaysFromNow(60),
    status: 'pending',
    description: 'Full production launch',
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'milestone-004',
    plan_id: 'plan-002',
    name: 'Auth Service Migration Complete',
    due_date: getDueDateForDaysFromNow(60),
    status: 'pending' as any,
    description: 'Move authentication to dedicated microservice',
    created_at: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'milestone-005',
    plan_id: 'plan-002',
    name: 'API Gateway Implementation',
    due_date: getDueDateForDaysFromNow(45),
    status: 'at-risk',
    description: 'Implement unified API gateway for all services',
    created_at: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'milestone-006',
    plan_id: 'plan-003',
    name: 'ML Model Training Complete',
    due_date: getDueDateForDaysFromNow(90),
    status: 'pending',
    description: 'Finish training all AI models',
    created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const getDemoPlans = (): Plan[] => {
  return [...DEMO_PLANS];
};

export const getDemoPlanObjectives = (): PlanObjective[] => {
  return [...DEMO_PLAN_OBJECTIVES];
};

export const getDemoPlanBudgetCategories = (): PlanBudgetCategory[] => {
  return [...DEMO_PLAN_BUDGET_CATEGORIES];
};

export const getDemoPlanResourceAllocations = (): PlanResourceAllocation[] => {
  return [...DEMO_PLAN_RESOURCE_ALLOCATIONS];
};

export const getDemoPlanMilestones = (): PlanMilestone[] => {
  return [...DEMO_PLAN_MILESTONES];
};

export const getPlanById = (planId: string): Plan | undefined => {
  return DEMO_PLANS.find(p => p.id === planId);
};

export const getPlanObjectivesByPlanId = (planId: string): PlanObjective[] => {
  return DEMO_PLAN_OBJECTIVES.filter(o => o.plan_id === planId);
};

export const getPlanBudgetCategoriesByPlanId = (planId: string): PlanBudgetCategory[] => {
  return DEMO_PLAN_BUDGET_CATEGORIES.filter(b => b.plan_id === planId);
};

export const getPlanResourceAllocationsByPlanId = (planId: string): PlanResourceAllocation[] => {
  return DEMO_PLAN_RESOURCE_ALLOCATIONS.filter(r => r.plan_id === planId);
};

export const getPlanMilestonesByPlanId = (planId: string): PlanMilestone[] => {
  return DEMO_PLAN_MILESTONES.filter(m => m.plan_id === planId);
};
