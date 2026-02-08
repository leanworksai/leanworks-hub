/**
 * Mock demo organizations for demo mode
 */

export interface Organization {
  id: string;
  name: string;
  slug: string;
  type: 'personal' | 'team';
  owner_email: string;
  description?: string;
  avatar?: string;
  created_at: string;
  updated_at: string;
}

export const DEMO_ORG_ID = 'org-demo-001';

export const DEMO_ORGANIZATION: Organization = {
  id: DEMO_ORG_ID,
  name: 'Acme Corporation',
  slug: 'acme-corp',
  type: 'team',
  owner_email: 'demo@example.com',
  description: 'Leading innovation in digital transformation and software solutions',
  avatar: 'https://api.dicebear.com/7.x/icons/svg?seed=acme',
  created_at: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
  updated_at: new Date().toISOString(),
};

export interface OrgMember {
  id: string;
  org_id: string;
  user_email: string;
  role: 'owner' | 'member';
  joined_at: string;
  updated_at: string;
}

export const DEMO_ORG_MEMBERS: OrgMember[] = [
  {
    id: 'member-1',
    org_id: DEMO_ORG_ID,
    user_email: 'demo@example.com',
    role: 'owner',
    joined_at: DEMO_ORGANIZATION.created_at,
    updated_at: new Date().toISOString(),
  },
  {
    id: 'member-2',
    org_id: DEMO_ORG_ID,
    user_email: 'sarah@example.com',
    role: 'member',
    joined_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'member-3',
    org_id: DEMO_ORG_ID,
    user_email: 'alex@example.com',
    role: 'member',
    joined_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'member-4',
    org_id: DEMO_ORG_ID,
    user_email: 'jessica@example.com',
    role: 'member',
    joined_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'member-5',
    org_id: DEMO_ORG_ID,
    user_email: 'marcus@example.com',
    role: 'member',
    joined_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const getDemoOrganization = (): Organization => {
  return { ...DEMO_ORGANIZATION };
};

export const getDemoOrgMembers = (): OrgMember[] => {
  return [...DEMO_ORG_MEMBERS];
};
