/**
 * Mock demo teams for demo mode
 */

import { DEMO_ORG_ID } from './organizations.js';

export interface Team {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  owner_email: string;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_email: string;
  role: string;
  avatar?: string;
  joined_at: string;
}

export const DEMO_TEAMS: Team[] = [
  {
    id: 'team-001',
    name: 'Engineering',
    description: 'Backend and frontend development team',
    avatar: 'https://api.dicebear.com/7.x/icons/svg?seed=engineering',
    owner_email: 'sarah@example.com',
    created_at: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'team-002',
    name: 'Product & Design',
    description: 'Product management and UX/UI design',
    avatar: 'https://api.dicebear.com/7.x/icons/svg?seed=product',
    owner_email: 'demo@example.com',
    created_at: new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'team-003',
    name: 'Infrastructure & DevOps',
    description: 'DevOps, cloud infrastructure, and deployment',
    avatar: 'https://api.dicebear.com/7.x/icons/svg?seed=devops',
    owner_email: 'marcus@example.com',
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEMO_TEAM_MEMBERS: TeamMember[] = [
  // Engineering team
  {
    id: 'tm-001',
    team_id: 'team-001',
    user_email: 'sarah@example.com',
    role: 'lead',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sarah',
    joined_at: DEMO_TEAMS[0].created_at,
  },
  {
    id: 'tm-002',
    team_id: 'team-001',
    user_email: 'alex@example.com',
    role: 'member',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
    joined_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'tm-003',
    team_id: 'team-001',
    user_email: 'demo@example.com',
    role: 'member',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo',
    joined_at: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
  },

  // Product & Design team
  {
    id: 'tm-004',
    team_id: 'team-002',
    user_email: 'demo@example.com',
    role: 'lead',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo',
    joined_at: DEMO_TEAMS[1].created_at,
  },
  {
    id: 'tm-005',
    team_id: 'team-002',
    user_email: 'jessica@example.com',
    role: 'member',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jessica',
    joined_at: new Date(Date.now() - 75 * 24 * 60 * 60 * 1000).toISOString(),
  },

  // Infrastructure team
  {
    id: 'tm-006',
    team_id: 'team-003',
    user_email: 'marcus@example.com',
    role: 'lead',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=marcus',
    joined_at: DEMO_TEAMS[2].created_at,
  },
  {
    id: 'tm-007',
    team_id: 'team-003',
    user_email: 'alex@example.com',
    role: 'member',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
    joined_at: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export const getDemoTeams = (): Team[] => {
  return [...DEMO_TEAMS];
};

export const getDemoTeamMembers = (): TeamMember[] => {
  return [...DEMO_TEAM_MEMBERS];
};

export const getTeamById = (teamId: string): Team | undefined => {
  return DEMO_TEAMS.find(t => t.id === teamId);
};

export const getTeamMembersByTeamId = (teamId: string): TeamMember[] => {
  return DEMO_TEAM_MEMBERS.filter(m => m.team_id === teamId);
};
