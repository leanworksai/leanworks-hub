/**
 * Mock demo users for demo mode
 */

export interface User {
  email: string;
  first_name: string;
  last_name: string;
  job_title: string;
  timezone: string;
  responsibilities: string;
  email_verified: boolean;
  subscription_plan: 'free' | 'standard' | 'pro';
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  ai_daily_usage: number;
  ai_usage_reset_date: string;
  trial_ends_at?: string;
  created_at: string;
  last_login: string;
  updated_at: string;
  avatar?: string;
}

export const DEMO_USERS: User[] = [
  {
    email: 'demo@example.com',
    first_name: 'Demo',
    last_name: 'User',
    job_title: 'Product Manager',
    timezone: 'America/Los_Angeles',
    responsibilities: 'Product strategy, planning, roadmap',
    email_verified: true,
    subscription_plan: 'pro',
    ai_daily_usage: 45,
    ai_usage_reset_date: new Date().toISOString().split('T')[0],
    created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    last_login: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo',
  },
  {
    email: 'sarah@example.com',
    first_name: 'Sarah',
    last_name: 'Chen',
    job_title: 'Engineering Lead',
    timezone: 'America/New_York',
    responsibilities: 'Engineering management, architecture, team leadership',
    email_verified: true,
    subscription_plan: 'pro',
    ai_daily_usage: 120,
    ai_usage_reset_date: new Date().toISOString().split('T')[0],
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    last_login: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sarah',
  },
  {
    email: 'alex@example.com',
    first_name: 'Alex',
    last_name: 'Rodriguez',
    job_title: 'Senior Developer',
    timezone: 'America/Chicago',
    responsibilities: 'Backend development, API design, database architecture',
    email_verified: true,
    subscription_plan: 'standard',
    ai_daily_usage: 85,
    ai_usage_reset_date: new Date().toISOString().split('T')[0],
    created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    last_login: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
  },
  {
    email: 'jessica@example.com',
    first_name: 'Jessica',
    last_name: 'Murphy',
    job_title: 'UI/UX Designer',
    timezone: 'Europe/London',
    responsibilities: 'UI design, user experience, design systems',
    email_verified: true,
    subscription_plan: 'standard',
    ai_daily_usage: 60,
    ai_usage_reset_date: new Date().toISOString().split('T')[0],
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    last_login: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jessica',
  },
  {
    email: 'marcus@example.com',
    first_name: 'Marcus',
    last_name: 'Thompson',
    job_title: 'DevOps Engineer',
    timezone: 'America/Denver',
    responsibilities: 'Infrastructure, CI/CD, deployment',
    email_verified: true,
    subscription_plan: 'standard',
    ai_daily_usage: 30,
    ai_usage_reset_date: new Date().toISOString().split('T')[0],
    created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    last_login: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=marcus',
  },
];

export const getDemoUserByEmail = (email: string): User | undefined => {
  return DEMO_USERS.find(u => u.email === email);
};

export const getDemoUsers = (): User[] => {
  return [...DEMO_USERS];
};
