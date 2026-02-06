// Plans Data - Mock data for UI/UX iteration

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
  projectId?: string; // If allocated to specific project
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
  normalizedHours?: number; // Calculated from past contribution
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
}

// Mock Plans Data
export const mockPlans: Plan[] = [
  {
    id: 'plan-1',
    name: 'Q1 2026 Product Launch',
    description: 'Launch our new AI-powered analytics dashboard with mobile apps, targeting 10K users in first quarter.',
    objectives: [
      {
        id: 'obj-1',
        text: 'Acquire 10,000 active users',
        targetValue: 10000,
        currentValue: 6800,
        unit: 'count',
        dueDate: '2026-03-31',
        status: 'on-track',
      },
      {
        id: 'obj-2',
        text: 'Achieve 95% uptime SLA',
        targetValue: 95,
        currentValue: 97.2,
        unit: 'percentage',
        status: 'on-track',
      },
      {
        id: 'obj-3',
        text: 'Mobile app completion',
        targetValue: 100,
        currentValue: 78,
        unit: 'percentage',
        dueDate: '2026-03-15',
        status: 'at-risk',
      },
    ],
    totalBudget: 250000,
    currency: 'USD',
    budgetCategories: [
      {
        id: 'budget-1',
        name: 'Engineering',
        allocatedAmount: 120000,
        spentAmount: 82000,
        projectId: 'proj-1',
      },
      {
        id: 'budget-2',
        name: 'Design & UX',
        allocatedAmount: 45000,
        spentAmount: 38000,
        projectId: 'proj-2',
      },
      {
        id: 'budget-3',
        name: 'Marketing',
        allocatedAmount: 60000,
        spentAmount: 22000,
      },
      {
        id: 'budget-4',
        name: 'Infrastructure',
        allocatedAmount: 25000,
        spentAmount: 18000,
      },
    ],
    spentToDate: 160000,
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    projectIds: ['proj-1', 'proj-2', 'proj-3'],
    resourceAllocations: [
      {
        id: 'res-1',
        userId: 'user-1',
        userEmail: 'sarah@example.com',
        userName: 'Sarah Chen',
        planId: 'plan-1',
        projectId: 'proj-1',
        allocationPercentage: 80,
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        role: 'Lead Engineer',
        hourlyRate: 85,
        normalizedHours: 32,
      },
      {
        id: 'res-2',
        userId: 'user-2',
        userEmail: 'mike@example.com',
        userName: 'Mike Johnson',
        planId: 'plan-1',
        projectId: 'proj-2',
        allocationPercentage: 60,
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        role: 'Product Designer',
        hourlyRate: 75,
        normalizedHours: 28,
      },
      {
        id: 'res-3',
        userId: 'user-3',
        userEmail: 'emma@example.com',
        userName: 'Emma Wilson',
        planId: 'plan-1',
        projectId: 'proj-1',
        allocationPercentage: 100,
        startDate: '2026-01-15',
        endDate: '2026-03-31',
        role: 'Backend Developer',
        hourlyRate: 80,
        normalizedHours: 38,
      },
      {
        id: 'res-4',
        userId: 'user-4',
        userEmail: 'alex@example.com',
        userName: 'Alex Rodriguez',
        planId: 'plan-1',
        projectId: 'proj-2',
        allocationPercentage: 50,
        startDate: '2026-02-01',
        endDate: '2026-03-31',
        role: 'Frontend Developer',
        hourlyRate: 78,
        normalizedHours: 30,
      },
    ],
    milestones: [
      {
        id: 'mile-1',
        name: 'MVP Release',
        dueDate: '2026-02-15',
        status: 'completed',
        description: 'Core features deployed to production',
      },
      {
        id: 'mile-2',
        name: 'Mobile App Beta',
        dueDate: '2026-03-01',
        status: 'at-risk',
        description: 'iOS and Android beta versions',
      },
      {
        id: 'mile-3',
        name: 'Public Launch',
        dueDate: '2026-03-31',
        status: 'pending',
        description: 'Full public launch with marketing campaign',
      },
    ],
    status: 'active',
    healthScore: 68,
    healthTrend: 'down',
    ownerEmail: 'sarah@example.com',
    ownerName: 'Sarah Chen',
    teamSize: 12,
    createdAt: '2025-12-15T10:00:00Z',
    updatedAt: '2026-02-03T14:30:00Z',
    recentActivity: [
      {
        id: 'activity-1',
        type: 'milestone',
        title: 'Mobile App Beta delayed',
        description: 'Milestone pushed from Feb 25 to Mar 1 due to API integration issues',
        timestamp: '2026-02-03T14:30:00Z',
        userId: 'user-1',
        userName: 'Sarah Chen',
      },
      {
        id: 'activity-2',
        type: 'project_update',
        title: 'Backend API completed',
        description: 'All core API endpoints are now live and tested',
        timestamp: '2026-02-02T09:15:00Z',
        userId: 'user-3',
        userName: 'Emma Wilson',
      },
      {
        id: 'activity-3',
        type: 'budget_change',
        title: 'Infrastructure budget increased',
        description: 'Added $5K for additional server capacity',
        timestamp: '2026-02-01T16:45:00Z',
        userId: 'user-1',
        userName: 'Sarah Chen',
      },
    ],
  },
  {
    id: 'plan-2',
    name: 'Infrastructure Modernization',
    description: 'Migrate legacy systems to cloud infrastructure, improve scalability and reduce operational costs by 40%.',
    objectives: [
      {
        id: 'obj-4',
        text: 'Migrate 80% of services to cloud',
        targetValue: 80,
        currentValue: 35,
        unit: 'percentage',
        dueDate: '2026-06-30',
        status: 'at-risk',
      },
      {
        id: 'obj-5',
        text: 'Reduce infrastructure costs',
        targetValue: 40,
        currentValue: 12,
        unit: 'percentage',
        status: 'at-risk',
      },
      {
        id: 'obj-6',
        text: 'Zero-downtime migrations',
        targetValue: 100,
        currentValue: 67,
        unit: 'percentage',
        status: 'on-track',
      },
    ],
    totalBudget: 180000,
    currency: 'USD',
    budgetCategories: [
      {
        id: 'budget-5',
        name: 'Cloud Infrastructure',
        allocatedAmount: 80000,
        spentAmount: 62000,
      },
      {
        id: 'budget-6',
        name: 'DevOps Engineering',
        allocatedAmount: 70000,
        spentAmount: 58000,
      },
      {
        id: 'budget-7',
        name: 'Security & Compliance',
        allocatedAmount: 30000,
        spentAmount: 18000,
      },
    ],
    spentToDate: 138000,
    startDate: '2026-01-15',
    endDate: '2026-06-30',
    projectIds: ['proj-4', 'proj-5'],
    resourceAllocations: [
      {
        id: 'res-5',
        userId: 'user-5',
        userEmail: 'james@example.com',
        userName: 'James Liu',
        planId: 'plan-2',
        projectId: 'proj-4',
        allocationPercentage: 90,
        startDate: '2026-01-15',
        endDate: '2026-06-30',
        role: 'DevOps Lead',
        hourlyRate: 95,
        normalizedHours: 36,
      },
      {
        id: 'res-6',
        userId: 'user-6',
        userEmail: 'lisa@example.com',
        userName: 'Lisa Park',
        planId: 'plan-2',
        projectId: 'proj-5',
        allocationPercentage: 70,
        startDate: '2026-02-01',
        endDate: '2026-06-30',
        role: 'Cloud Architect',
        hourlyRate: 100,
        normalizedHours: 34,
      },
      {
        id: 'res-7',
        userId: 'user-3',
        userEmail: 'emma@example.com',
        userName: 'Emma Wilson',
        planId: 'plan-2',
        allocationPercentage: 40,
        startDate: '2026-03-01',
        endDate: '2026-06-30',
        role: 'Backend Migration',
        hourlyRate: 80,
        normalizedHours: 38,
      },
    ],
    milestones: [
      {
        id: 'mile-4',
        name: 'Database Migration',
        dueDate: '2026-03-31',
        status: 'at-risk',
        description: 'Migrate all databases to managed cloud services',
      },
      {
        id: 'mile-5',
        name: 'Container Orchestration',
        dueDate: '2026-05-15',
        status: 'pending',
        description: 'Kubernetes deployment complete',
      },
      {
        id: 'mile-6',
        name: 'Legacy System Decommission',
        dueDate: '2026-06-30',
        status: 'pending',
        description: 'Turn off all legacy servers',
      },
    ],
    status: 'at-risk',
    healthScore: 45,
    healthTrend: 'down',
    ownerEmail: 'james@example.com',
    ownerName: 'James Liu',
    teamSize: 8,
    createdAt: '2025-12-20T11:00:00Z',
    updatedAt: '2026-02-03T10:20:00Z',
    recentActivity: [
      {
        id: 'activity-4',
        type: 'project_update',
        title: 'Database migration blocked',
        description: 'Waiting on vendor approval for data transfer',
        timestamp: '2026-02-03T10:20:00Z',
        userId: 'user-5',
        userName: 'James Liu',
      },
      {
        id: 'activity-5',
        type: 'resource_change',
        title: 'Emma Wilson added to team',
        description: 'Additional backend support for migration',
        timestamp: '2026-02-01T14:00:00Z',
        userId: 'user-5',
        userName: 'James Liu',
      },
    ],
  },
  {
    id: 'plan-3',
    name: 'Customer Success Initiative',
    description: 'Build comprehensive customer success program to improve retention by 25% and NPS score to 50+.',
    objectives: [
      {
        id: 'obj-7',
        text: 'Increase customer retention rate',
        targetValue: 25,
        currentValue: 8,
        unit: 'percentage',
        dueDate: '2026-12-31',
        status: 'on-track',
      },
      {
        id: 'obj-8',
        text: 'Achieve NPS score of 50+',
        targetValue: 50,
        currentValue: 42,
        unit: 'count',
        status: 'on-track',
      },
      {
        id: 'obj-9',
        text: 'Build knowledge base',
        targetValue: 100,
        currentValue: 15,
        unit: 'percentage',
        dueDate: '2026-04-30',
        status: 'on-track',
      },
    ],
    totalBudget: 120000,
    currency: 'USD',
    budgetCategories: [
      {
        id: 'budget-8',
        name: 'Support Team',
        allocatedAmount: 60000,
        spentAmount: 8000,
      },
      {
        id: 'budget-9',
        name: 'Tools & Software',
        allocatedAmount: 30000,
        spentAmount: 12000,
      },
      {
        id: 'budget-10',
        name: 'Content Creation',
        allocatedAmount: 30000,
        spentAmount: 4000,
      },
    ],
    spentToDate: 24000,
    startDate: '2026-02-01',
    endDate: '2026-12-31',
    projectIds: ['proj-6'],
    resourceAllocations: [
      {
        id: 'res-8',
        userId: 'user-7',
        userEmail: 'rachel@example.com',
        userName: 'Rachel Kim',
        planId: 'plan-3',
        projectId: 'proj-6',
        allocationPercentage: 100,
        startDate: '2026-02-01',
        endDate: '2026-12-31',
        role: 'Customer Success Manager',
        hourlyRate: 70,
        normalizedHours: 40,
      },
      {
        id: 'res-9',
        userId: 'user-8',
        userEmail: 'david@example.com',
        userName: 'David Brown',
        planId: 'plan-3',
        projectId: 'proj-6',
        allocationPercentage: 50,
        startDate: '2026-02-15',
        endDate: '2026-12-31',
        role: 'Content Writer',
        hourlyRate: 65,
        normalizedHours: 25,
      },
    ],
    milestones: [
      {
        id: 'mile-7',
        name: 'Support Portal Launch',
        dueDate: '2026-03-15',
        status: 'pending',
        description: 'Self-service support portal goes live',
      },
      {
        id: 'mile-8',
        name: 'Knowledge Base Complete',
        dueDate: '2026-04-30',
        status: 'pending',
        description: '100+ articles published',
      },
      {
        id: 'mile-9',
        name: 'Customer Health Dashboard',
        dueDate: '2026-06-30',
        status: 'pending',
        description: 'Automated customer health monitoring',
      },
    ],
    status: 'planning',
    healthScore: 85,
    healthTrend: 'stable',
    ownerEmail: 'rachel@example.com',
    ownerName: 'Rachel Kim',
    teamSize: 5,
    createdAt: '2026-01-25T09:00:00Z',
    updatedAt: '2026-02-02T16:00:00Z',
    recentActivity: [
      {
        id: 'activity-6',
        type: 'project_update',
        title: 'Support tools selected',
        description: 'Zendesk and Intercom licenses purchased',
        timestamp: '2026-02-02T16:00:00Z',
        userId: 'user-7',
        userName: 'Rachel Kim',
      },
      {
        id: 'activity-7',
        type: 'resource_change',
        title: 'David Brown joined team',
        description: 'Content writer onboarded for knowledge base',
        timestamp: '2026-02-01T10:00:00Z',
        userId: 'user-7',
        userName: 'Rachel Kim',
      },
    ],
  },
  {
    id: 'plan-4',
    name: 'Mobile Platform Expansion',
    description: 'Develop native iOS and Android applications with offline support and push notifications.',
    objectives: [
      {
        id: 'obj-10',
        text: 'iOS App Store launch',
        targetValue: 100,
        currentValue: 92,
        unit: 'percentage',
        dueDate: '2026-03-15',
        status: 'on-track',
      },
      {
        id: 'obj-11',
        text: 'Android Play Store launch',
        targetValue: 100,
        currentValue: 88,
        unit: 'percentage',
        dueDate: '2026-03-20',
        status: 'on-track',
      },
      {
        id: 'obj-12',
        text: 'Feature parity with web',
        targetValue: 95,
        currentValue: 85,
        unit: 'percentage',
        status: 'on-track',
      },
    ],
    totalBudget: 200000,
    currency: 'USD',
    budgetCategories: [
      {
        id: 'budget-11',
        name: 'Mobile Development',
        allocatedAmount: 140000,
        spentAmount: 125000,
      },
      {
        id: 'budget-12',
        name: 'Testing & QA',
        allocatedAmount: 40000,
        spentAmount: 32000,
      },
      {
        id: 'budget-13',
        name: 'App Store Fees',
        allocatedAmount: 20000,
        spentAmount: 5000,
      },
    ],
    spentToDate: 162000,
    startDate: '2025-11-01',
    endDate: '2026-03-31',
    projectIds: ['proj-7', 'proj-8'],
    resourceAllocations: [
      {
        id: 'res-10',
        userId: 'user-9',
        userEmail: 'sophia@example.com',
        userName: 'Sophia Martinez',
        planId: 'plan-4',
        projectId: 'proj-7',
        allocationPercentage: 100,
        startDate: '2025-11-01',
        endDate: '2026-03-31',
        role: 'iOS Lead',
        hourlyRate: 90,
        normalizedHours: 38,
      },
      {
        id: 'res-11',
        userId: 'user-10',
        userEmail: 'tom@example.com',
        userName: 'Tom Anderson',
        planId: 'plan-4',
        projectId: 'proj-8',
        allocationPercentage: 100,
        startDate: '2025-11-01',
        endDate: '2026-03-31',
        role: 'Android Lead',
        hourlyRate: 88,
        normalizedHours: 36,
      },
      {
        id: 'res-12',
        userId: 'user-11',
        userEmail: 'nina@example.com',
        userName: 'Nina Patel',
        planId: 'plan-4',
        allocationPercentage: 80,
        startDate: '2026-01-15',
        endDate: '2026-03-31',
        role: 'QA Engineer',
        hourlyRate: 72,
        normalizedHours: 32,
      },
    ],
    milestones: [
      {
        id: 'mile-10',
        name: 'iOS TestFlight',
        dueDate: '2026-02-15',
        status: 'completed',
        description: 'Beta testing via TestFlight',
      },
      {
        id: 'mile-11',
        name: 'Android Internal Testing',
        dueDate: '2026-02-20',
        status: 'completed',
        description: 'Google Play internal track testing',
      },
      {
        id: 'mile-12',
        name: 'Public App Store Launch',
        dueDate: '2026-03-20',
        status: 'pending',
        description: 'Both apps live on public stores',
      },
    ],
    status: 'active',
    healthScore: 78,
    healthTrend: 'up',
    ownerEmail: 'sophia@example.com',
    ownerName: 'Sophia Martinez',
    teamSize: 6,
    createdAt: '2025-10-20T08:00:00Z',
    updatedAt: '2026-02-03T11:45:00Z',
    recentActivity: [
      {
        id: 'activity-8',
        type: 'milestone',
        title: 'Android internal testing completed',
        description: 'All major bugs fixed, ready for beta',
        timestamp: '2026-02-03T11:45:00Z',
        userId: 'user-10',
        userName: 'Tom Anderson',
      },
      {
        id: 'activity-9',
        type: 'project_update',
        title: 'Push notifications implemented',
        description: 'Both iOS and Android now support push',
        timestamp: '2026-02-02T15:30:00Z',
        userId: 'user-9',
        userName: 'Sophia Martinez',
      },
    ],
  },
  {
    id: 'plan-5',
    name: 'Enterprise Security Compliance',
    description: 'Achieve SOC 2 Type II certification and implement enterprise-grade security features.',
    objectives: [
      {
        id: 'obj-13',
        text: 'SOC 2 Type II certification',
        targetValue: 100,
        currentValue: 45,
        unit: 'percentage',
        dueDate: '2026-08-31',
        status: 'on-track',
      },
      {
        id: 'obj-14',
        text: 'Security controls implemented',
        targetValue: 100,
        currentValue: 52,
        unit: 'percentage',
        status: 'on-track',
      },
      {
        id: 'obj-15',
        text: 'Penetration testing passed',
        targetValue: 100,
        currentValue: 0,
        unit: 'percentage',
        dueDate: '2026-07-31',
        status: 'on-track',
      },
    ],
    totalBudget: 150000,
    currency: 'USD',
    budgetCategories: [
      {
        id: 'budget-14',
        name: 'Compliance Consulting',
        allocatedAmount: 60000,
        spentAmount: 18000,
      },
      {
        id: 'budget-15',
        name: 'Security Engineering',
        allocatedAmount: 70000,
        spentAmount: 22000,
      },
      {
        id: 'budget-16',
        name: 'Audit & Testing',
        allocatedAmount: 20000,
        spentAmount: 3000,
      },
    ],
    spentToDate: 43000,
    startDate: '2026-01-20',
    endDate: '2026-08-31',
    projectIds: ['proj-9'],
    resourceAllocations: [
      {
        id: 'res-13',
        userId: 'user-12',
        userEmail: 'marcus@example.com',
        userName: 'Marcus Johnson',
        planId: 'plan-5',
        projectId: 'proj-9',
        allocationPercentage: 100,
        startDate: '2026-01-20',
        endDate: '2026-08-31',
        role: 'Security Lead',
        hourlyRate: 110,
        normalizedHours: 40,
      },
      {
        id: 'res-14',
        userId: 'user-13',
        userEmail: 'olivia@example.com',
        userName: 'Olivia Chen',
        planId: 'plan-5',
        allocationPercentage: 60,
        startDate: '2026-02-01',
        endDate: '2026-08-31',
        role: 'Compliance Officer',
        hourlyRate: 95,
        normalizedHours: 35,
      },
    ],
    milestones: [
      {
        id: 'mile-13',
        name: 'Gap Analysis Complete',
        dueDate: '2026-03-31',
        status: 'pending',
        description: 'Identify all compliance gaps',
      },
      {
        id: 'mile-14',
        name: 'Security Controls Deployed',
        dueDate: '2026-06-30',
        status: 'pending',
        description: 'All required controls in production',
      },
      {
        id: 'mile-15',
        name: 'SOC 2 Audit',
        dueDate: '2026-08-31',
        status: 'pending',
        description: 'Complete external audit',
      },
    ],
    status: 'active',
    healthScore: 72,
    healthTrend: 'stable',
    ownerEmail: 'marcus@example.com',
    ownerName: 'Marcus Johnson',
    teamSize: 4,
    createdAt: '2026-01-10T13:00:00Z',
    updatedAt: '2026-02-03T09:30:00Z',
    recentActivity: [
      {
        id: 'activity-10',
        type: 'project_update',
        title: 'Encryption at rest implemented',
        description: 'All databases now encrypted',
        timestamp: '2026-02-03T09:30:00Z',
        userId: 'user-12',
        userName: 'Marcus Johnson',
      },
      {
        id: 'activity-11',
        type: 'budget_change',
        title: 'Additional audit budget approved',
        description: 'Added $5K for penetration testing',
        timestamp: '2026-02-01T11:00:00Z',
        userId: 'user-12',
        userName: 'Marcus Johnson',
      },
    ],
  },
];

// Helper function to get plan by ID
export const getPlanById = (id: string): Plan | undefined => {
  return mockPlans.find(plan => plan.id === id);
};

// Helper function to get plans by status
export const getPlansByStatus = (status: Plan['status']): Plan[] => {
  return mockPlans.filter(plan => plan.status === status);
};

// Helper function to get projects for a plan
export const getProjectsForPlan = (planId: string): string[] => {
  const plan = getPlanById(planId);
  return plan?.projectIds || [];
};
