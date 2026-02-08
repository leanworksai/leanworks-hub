/**
 * Mock demo projects for demo mode
 */

export interface Project {
  id: string;
  name: string;
  description?: string;
  team_id?: string;
  status: 'planning' | 'active' | 'on-hold' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  start_date?: string;
  end_date?: string;
  due_date?: string;
  owner_email: string;
  visibility: 'all_members' | 'specific_members';
  visible_to_members?: string[];
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_email: string;
  role: string;
  avatar?: string;
  joined_at: string;
}

export interface ProjectComment {
  id: string;
  project_id: string;
  member_name: string;
  member_avatar?: string;
  date: string;
  comment: string;
  created_at: string;
}

const baseDate = new Date();

export const DEMO_PROJECTS: Project[] = [
  {
    id: 'proj-001',
    name: 'Platform Modernization',
    description: 'Migrate legacy monolith to microservices architecture',
    team_id: 'team-001',
    status: 'active',
    priority: 'high',
    start_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end_date: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    due_date: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    owner_email: 'sarah@example.com',
    visibility: 'all_members',
    created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'proj-002',
    name: 'Mobile App Launch',
    description: 'iOS and Android native apps for core features',
    team_id: 'team-002',
    status: 'planning',
    priority: 'high',
    start_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end_date: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    due_date: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    owner_email: 'demo@example.com',
    visibility: 'all_members',
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'proj-003',
    name: 'AI Features Integration',
    description: 'Integrate AI-powered features into platform',
    team_id: 'team-001',
    status: 'active',
    priority: 'medium',
    start_date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    due_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    owner_email: 'alex@example.com',
    visibility: 'all_members',
    created_at: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'proj-004',
    name: 'Design System Refresh',
    description: 'Update UI components and design tokens for consistency',
    team_id: 'team-002',
    status: 'active',
    priority: 'medium',
    start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    due_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    owner_email: 'jessica@example.com',
    visibility: 'all_members',
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'proj-005',
    name: 'Infrastructure Upgrade',
    description: 'Upgrade Kubernetes cluster and improve CI/CD pipeline',
    team_id: 'team-003',
    status: 'completed',
    priority: 'high',
    start_date: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    due_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    owner_email: 'marcus@example.com',
    visibility: 'all_members',
    created_at: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEMO_PROJECT_MEMBERS: ProjectMember[] = [
  // Platform Modernization
  {
    id: 'pm-001',
    project_id: 'proj-001',
    user_email: 'sarah@example.com',
    role: 'lead',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sarah',
    joined_at: DEMO_PROJECTS[0].created_at,
  },
  {
    id: 'pm-002',
    project_id: 'proj-001',
    user_email: 'alex@example.com',
    role: 'member',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
    joined_at: DEMO_PROJECTS[0].created_at,
  },
  {
    id: 'pm-003',
    project_id: 'proj-001',
    user_email: 'demo@example.com',
    role: 'member',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo',
    joined_at: DEMO_PROJECTS[0].created_at,
  },

  // Mobile App Launch
  {
    id: 'pm-004',
    project_id: 'proj-002',
    user_email: 'demo@example.com',
    role: 'lead',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo',
    joined_at: DEMO_PROJECTS[1].created_at,
  },
  {
    id: 'pm-005',
    project_id: 'proj-002',
    user_email: 'jessica@example.com',
    role: 'member',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jessica',
    joined_at: DEMO_PROJECTS[1].created_at,
  },
  {
    id: 'pm-006',
    project_id: 'proj-002',
    user_email: 'alex@example.com',
    role: 'member',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
    joined_at: DEMO_PROJECTS[1].created_at,
  },

  // AI Features
  {
    id: 'pm-007',
    project_id: 'proj-003',
    user_email: 'alex@example.com',
    role: 'lead',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
    joined_at: DEMO_PROJECTS[2].created_at,
  },
  {
    id: 'pm-008',
    project_id: 'proj-003',
    user_email: 'sarah@example.com',
    role: 'member',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sarah',
    joined_at: DEMO_PROJECTS[2].created_at,
  },

  // Design System
  {
    id: 'pm-009',
    project_id: 'proj-004',
    user_email: 'jessica@example.com',
    role: 'lead',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jessica',
    joined_at: DEMO_PROJECTS[3].created_at,
  },
  {
    id: 'pm-010',
    project_id: 'proj-004',
    user_email: 'demo@example.com',
    role: 'member',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo',
    joined_at: DEMO_PROJECTS[3].created_at,
  },

  // Infrastructure Upgrade
  {
    id: 'pm-011',
    project_id: 'proj-005',
    user_email: 'marcus@example.com',
    role: 'lead',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=marcus',
    joined_at: DEMO_PROJECTS[4].created_at,
  },
  {
    id: 'pm-012',
    project_id: 'proj-005',
    user_email: 'alex@example.com',
    role: 'member',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
    joined_at: DEMO_PROJECTS[4].created_at,
  },
];

export const DEMO_PROJECT_COMMENTS: ProjectComment[] = [
  {
    id: 'pc-001',
    project_id: 'proj-001',
    member_name: 'Sarah Chen',
    member_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sarah',
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    comment: 'Started migration of auth service to new microservice architecture',
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'pc-002',
    project_id: 'proj-001',
    member_name: 'Alex Rodriguez',
    member_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
    date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    comment: 'API gateway implementation complete. Moving to service discovery setup.',
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'pc-003',
    project_id: 'proj-003',
    member_name: 'Demo User',
    member_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo',
    date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    comment: 'Great progress on the AI model training. Ready for first round of testing.',
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'pc-004',
    project_id: 'proj-004',
    member_name: 'Jessica Murphy',
    member_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jessica',
    date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    comment: 'New component library shipped. All teams can start using the updated designs.',
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export const getDemoProjects = (): Project[] => {
  return [...DEMO_PROJECTS];
};

export const getDemoProjectMembers = (): ProjectMember[] => {
  return [...DEMO_PROJECT_MEMBERS];
};

export const getDemoProjectComments = (): ProjectComment[] => {
  return [...DEMO_PROJECT_COMMENTS];
};

export const getProjectById = (projectId: string): Project | undefined => {
  return DEMO_PROJECTS.find(p => p.id === projectId);
};

export const getProjectMembersByProjectId = (projectId: string): ProjectMember[] => {
  return DEMO_PROJECT_MEMBERS.filter(m => m.project_id === projectId);
};

export const getProjectCommentsByProjectId = (projectId: string): ProjectComment[] => {
  return DEMO_PROJECT_COMMENTS.filter(c => c.project_id === projectId);
};
