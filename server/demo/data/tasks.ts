/**
 * Mock demo tasks for demo mode
 */

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'review' | 'completed' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee_id?: string;
  assignee_name?: string;
  assignee_avatar?: string;
  assignee_type?: 'human' | 'ai_agent' | 'ai_team';
  project_id: string;
  project_name: string;
  created_by: string;
  visibility: 'all_members' | 'specific_members';
  visible_to_members?: string[];
  due_date?: string;
  created_date?: string;
  created_at: string;
  estimated_hours?: number;
  actual_hours?: number;
  tags?: string[];
  reason?: string;
  updated_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  member_name: string;
  member_avatar?: string;
  date: string;
  comment: string;
  created_at: string;
}

const getDueDateForDaysFromNow = (days: number): string => {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
};

const getCreatedDate = (daysAgo: number): string => {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
};

export const DEMO_TASKS: Task[] = [
  // Platform Modernization - proj-001
  {
    id: 'task-001',
    title: 'Setup API Gateway Service',
    description: 'Design and implement the API gateway that will route traffic across microservices',
    status: 'completed',
    priority: 'high',
    assignee_id: 'alex@example.com',
    assignee_name: 'Alex Rodriguez',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
    assignee_type: 'human',
    project_id: 'proj-001',
    project_name: 'Platform Modernization',
    created_by: 'sarah@example.com',
    visibility: 'all_members',
    due_date: getCreatedDate(-5),
    created_date: getCreatedDate(30),
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 16,
    actual_hours: 14,
    tags: ['backend', 'architecture'],
    updated_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'task-002',
    title: 'Migrate Authentication Service',
    description: 'Move auth logic from monolith to dedicated microservice',
    status: 'in-progress',
    priority: 'high',
    assignee_id: 'sarah@example.com',
    assignee_name: 'Sarah Chen',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sarah',
    assignee_type: 'human',
    project_id: 'proj-001',
    project_name: 'Platform Modernization',
    created_by: 'sarah@example.com',
    visibility: 'all_members',
    due_date: getDueDateForDaysFromNow(7),
    created_date: getCreatedDate(10),
    created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 24,
    actual_hours: 12,
    tags: ['backend', 'security'],
    updated_at: new Date().toISOString(),
  },
  {
    id: 'task-003',
    title: 'Setup Service Discovery',
    description: 'Implement Consul/Eureka for service discovery and health checks',
    status: 'todo',
    priority: 'high',
    assignee_id: 'alex@example.com',
    assignee_name: 'Alex Rodriguez',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
    assignee_type: 'human',
    project_id: 'proj-001',
    project_name: 'Platform Modernization',
    created_by: 'sarah@example.com',
    visibility: 'all_members',
    due_date: getDueDateForDaysFromNow(14),
    created_date: getCreatedDate(5),
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 20,
    tags: ['infrastructure', 'devops'],
    updated_at: new Date().toISOString(),
  },
  {
    id: 'task-004',
    title: 'Write Migration Documentation',
    description: 'Document all migration steps for future reference and team knowledge',
    status: 'in-progress',
    priority: 'medium',
    assignee_id: 'demo@example.com',
    assignee_name: 'Demo User',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo',
    assignee_type: 'human',
    project_id: 'proj-001',
    project_name: 'Platform Modernization',
    created_by: 'sarah@example.com',
    visibility: 'all_members',
    due_date: getDueDateForDaysFromNow(7),
    created_date: getCreatedDate(8),
    created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 8,
    actual_hours: 3,
    tags: ['documentation'],
    updated_at: new Date().toISOString(),
  },

  // Mobile App Launch - proj-002
  {
    id: 'task-005',
    title: 'Finalize App Design Mockups',
    description: 'Complete UI/UX designs for iOS and Android interfaces',
    status: 'in-progress',
    priority: 'high',
    assignee_id: 'jessica@example.com',
    assignee_name: 'Jessica Murphy',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jessica',
    assignee_type: 'human',
    project_id: 'proj-002',
    project_name: 'Mobile App Launch',
    created_by: 'demo@example.com',
    visibility: 'all_members',
    due_date: getDueDateForDaysFromNow(10),
    created_date: getCreatedDate(5),
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 32,
    actual_hours: 20,
    tags: ['design', 'mobile'],
    updated_at: new Date().toISOString(),
  },
  {
    id: 'task-006',
    title: 'Setup iOS Development Environment',
    description: 'Configure Xcode, cocoapods, and CI/CD for iOS builds',
    status: 'todo',
    priority: 'high',
    assignee_id: 'alex@example.com',
    assignee_name: 'Alex Rodriguez',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
    assignee_type: 'human',
    project_id: 'proj-002',
    project_name: 'Mobile App Launch',
    created_by: 'demo@example.com',
    visibility: 'all_members',
    due_date: getDueDateForDaysFromNow(15),
    created_date: getCreatedDate(3),
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 12,
    tags: ['mobile', 'ios', 'devops'],
    updated_at: new Date().toISOString(),
  },
  {
    id: 'task-007',
    title: 'Create Authentication Module',
    description: 'Build shared auth library for iOS and Android',
    status: 'todo',
    priority: 'high',
    assignee_id: 'alex@example.com',
    assignee_name: 'Alex Rodriguez',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
    assignee_type: 'human',
    project_id: 'proj-002',
    project_name: 'Mobile App Launch',
    created_by: 'demo@example.com',
    visibility: 'all_members',
    due_date: getDueDateForDaysFromNow(45),
    created_date: getCreatedDate(2),
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 20,
    tags: ['mobile', 'authentication', 'shared'],
    updated_at: new Date().toISOString(),
  },

  // AI Features - proj-003
  {
    id: 'task-008',
    title: 'Train ML Model for Task Classification',
    description: 'Develop and train machine learning model to auto-classify tasks',
    status: 'in-progress',
    priority: 'high',
    assignee_id: 'ai-agent-001',
    assignee_name: 'ML Trainer Agent',
    assignee_avatar: 'https://api.dicebear.com/7.x/icons/svg?seed=ml',
    assignee_type: 'ai_agent',
    project_id: 'proj-003',
    project_name: 'AI Features Integration',
    created_by: 'alex@example.com',
    visibility: 'all_members',
    due_date: getDueDateForDaysFromNow(21),
    created_date: getCreatedDate(15),
    created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 40,
    actual_hours: 25,
    tags: ['ai', 'ml', 'classification'],
    updated_at: new Date().toISOString(),
  },
  {
    id: 'task-009',
    title: 'Implement Intelligent Task Suggestions',
    description: 'API endpoint to provide AI-powered task suggestions based on context',
    status: 'todo',
    priority: 'high',
    assignee_id: 'alex@example.com',
    assignee_name: 'Alex Rodriguez',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
    assignee_type: 'human',
    project_id: 'proj-003',
    project_name: 'AI Features Integration',
    created_by: 'alex@example.com',
    visibility: 'all_members',
    due_date: getDueDateForDaysFromNow(30),
    created_date: getCreatedDate(10),
    created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 16,
    tags: ['ai', 'backend', 'api'],
    updated_at: new Date().toISOString(),
  },
  {
    id: 'task-010',
    title: 'Create AI Assistant UI Components',
    description: 'Build React components for AI assistant interface',
    status: 'review',
    priority: 'medium',
    assignee_id: 'jessica@example.com',
    assignee_name: 'Jessica Murphy',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jessica',
    assignee_type: 'human',
    project_id: 'proj-003',
    project_name: 'AI Features Integration',
    created_by: 'alex@example.com',
    visibility: 'all_members',
    due_date: getDueDateForDaysFromNow(5),
    created_date: getCreatedDate(12),
    created_at: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 12,
    actual_hours: 11,
    tags: ['ai', 'frontend', 'ui'],
    updated_at: new Date().toISOString(),
  },

  // Design System - proj-004
  {
    id: 'task-011',
    title: 'Audit Current Component Library',
    description: 'Catalog and review all existing UI components',
    status: 'completed',
    priority: 'medium',
    assignee_id: 'jessica@example.com',
    assignee_name: 'Jessica Murphy',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jessica',
    assignee_type: 'human',
    project_id: 'proj-004',
    project_name: 'Design System Refresh',
    created_by: 'jessica@example.com',
    visibility: 'all_members',
    due_date: getCreatedDate(-10),
    created_date: getCreatedDate(25),
    created_at: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 8,
    actual_hours: 7,
    tags: ['design', 'audit'],
    updated_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'task-012',
    title: 'Update Typography System',
    description: 'Create new typography scale and variants using updated font families',
    status: 'completed',
    priority: 'high',
    assignee_id: 'jessica@example.com',
    assignee_name: 'Jessica Murphy',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jessica',
    assignee_type: 'human',
    project_id: 'proj-004',
    project_name: 'Design System Refresh',
    created_by: 'jessica@example.com',
    visibility: 'all_members',
    due_date: getCreatedDate(-3),
    created_date: getCreatedDate(18),
    created_at: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 12,
    actual_hours: 11,
    tags: ['design', 'typography'],
    updated_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'task-013',
    title: 'Build Component Storybook',
    description: 'Set up Storybook for component documentation and showcase',
    status: 'completed',
    priority: 'high',
    assignee_id: 'demo@example.com',
    assignee_name: 'Demo User',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo',
    assignee_type: 'human',
    project_id: 'proj-004',
    project_name: 'Design System Refresh',
    created_by: 'jessica@example.com',
    visibility: 'all_members',
    due_date: getCreatedDate(-1),
    created_date: getCreatedDate(15),
    created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 16,
    actual_hours: 14,
    tags: ['design', 'frontend', 'documentation'],
    updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'task-014',
    title: 'Migration Guide for Teams',
    description: 'Create comprehensive guide for teams to migrate to new design system',
    status: 'in-progress',
    priority: 'medium',
    assignee_id: 'jessica@example.com',
    assignee_name: 'Jessica Murphy',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jessica',
    assignee_type: 'human',
    project_id: 'proj-004',
    project_name: 'Design System Refresh',
    created_by: 'jessica@example.com',
    visibility: 'all_members',
    due_date: getDueDateForDaysFromNow(5),
    created_date: getCreatedDate(3),
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 8,
    actual_hours: 2,
    tags: ['design', 'documentation'],
    updated_at: new Date().toISOString(),
  },

  // Infrastructure Upgrade - proj-005 (completed)
  {
    id: 'task-015',
    title: 'Upgrade Kubernetes Cluster to 1.28',
    description: 'Update all control plane and worker nodes to latest version',
    status: 'completed',
    priority: 'high',
    assignee_id: 'marcus@example.com',
    assignee_name: 'Marcus Thompson',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=marcus',
    assignee_type: 'human',
    project_id: 'proj-005',
    project_name: 'Infrastructure Upgrade',
    created_by: 'marcus@example.com',
    visibility: 'all_members',
    due_date: getCreatedDate(-20),
    created_date: getCreatedDate(80),
    created_at: new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 24,
    actual_hours: 22,
    tags: ['infrastructure', 'kubernetes'],
    updated_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'task-016',
    title: 'Implement GitOps Pipeline',
    description: 'Setup ArgoCD for continuous deployment from Git',
    status: 'completed',
    priority: 'high',
    assignee_id: 'alex@example.com',
    assignee_name: 'Alex Rodriguez',
    assignee_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
    assignee_type: 'human',
    project_id: 'proj-005',
    project_name: 'Infrastructure Upgrade',
    created_by: 'marcus@example.com',
    visibility: 'all_members',
    due_date: getCreatedDate(-15),
    created_date: getCreatedDate(60),
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    estimated_hours: 20,
    actual_hours: 18,
    tags: ['devops', 'cicd', 'gitops'],
    updated_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export const DEMO_TASK_COMMENTS: TaskComment[] = [
  {
    id: 'tc-001',
    task_id: 'task-002',
    member_name: 'Sarah Chen',
    member_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sarah',
    date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    comment: 'Almost done with the database schema migration. Should have this wrapped up by end of week.',
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'tc-002',
    task_id: 'task-008',
    member_name: 'ML Trainer Agent',
    member_avatar: 'https://api.dicebear.com/7.x/icons/svg?seed=ml',
    date: new Date().toISOString().split('T')[0],
    comment: 'Training complete! Achieved 94% accuracy on validation set. Ready for integration testing.',
    created_at: new Date().toISOString(),
  },
  {
    id: 'tc-003',
    task_id: 'task-010',
    member_name: 'Jessica Murphy',
    member_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jessica',
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    comment: 'Submitted for code review. Please check for accessibility compliance.',
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'tc-004',
    task_id: 'task-014',
    member_name: 'Demo User',
    member_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo',
    date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    comment: 'Started with a comprehensive migration checklist and code examples.',
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export const getDemoTasks = (): Task[] => {
  return [...DEMO_TASKS];
};

export const getDemoTaskComments = (): TaskComment[] => {
  return [...DEMO_TASK_COMMENTS];
};

export const getTaskById = (taskId: string): Task | undefined => {
  return DEMO_TASKS.find(t => t.id === taskId);
};

export const getTasksByProjectId = (projectId: string): Task[] => {
  return DEMO_TASKS.filter(t => t.project_id === projectId);
};

export const getTaskCommentsByTaskId = (taskId: string): TaskComment[] => {
  return DEMO_TASK_COMMENTS.filter(c => c.task_id === taskId);
};
