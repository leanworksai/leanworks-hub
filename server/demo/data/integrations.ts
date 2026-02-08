/**
 * Mock demo integrations for demo mode
 */

export interface Integration {
  id: string;
  name: string;
  icon?: string;
  connected: boolean;
  connectedAt?: string;
  description?: string;
  features?: string[];
}

export const DEMO_INTEGRATIONS: Integration[] = [
  {
    id: 'slack',
    name: 'Slack',
    icon: 'https://api.dicebear.com/7.x/icons/svg?seed=slack',
    connected: true,
    connectedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    description: 'Connect to Slack for notifications and updates',
    features: ['notifications', 'messages', 'channel-integration'],
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: 'https://api.dicebear.com/7.x/icons/svg?seed=github',
    connected: false,
    description: 'Sync code repositories and pull requests',
    features: ['code-sync', 'pr-tracking', 'issue-management'],
  },
  {
    id: 'jira',
    name: 'Jira',
    icon: 'https://api.dicebear.com/7.x/icons/svg?seed=jira',
    connected: true,
    connectedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    description: 'Integrate with Jira for issue tracking',
    features: ['issue-sync', 'sprint-tracking', 'workflow-automation'],
  },
  {
    id: 'notion',
    name: 'Notion',
    icon: 'https://api.dicebear.com/7.x/icons/svg?seed=notion',
    connected: false,
    description: 'Sync with Notion databases and pages',
    features: ['database-sync', 'page-sharing', 'content-sync'],
  },
  {
    id: 'linear',
    name: 'Linear',
    icon: 'https://api.dicebear.com/7.x/icons/svg?seed=linear',
    connected: true,
    connectedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    description: 'Issue tracking and project management',
    features: ['issue-sync', 'project-tracking', 'team-sync'],
  },
  {
    id: 'outlook',
    name: 'Outlook',
    icon: 'https://api.dicebear.com/7.x/icons/svg?seed=outlook',
    connected: false,
    description: 'Calendar and email integration',
    features: ['calendar-sync', 'email-integration', 'scheduling'],
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    icon: 'https://api.dicebear.com/7.x/icons/svg?seed=clickup',
    connected: false,
    description: 'Project management and task tracking',
    features: ['task-sync', 'workspace-sync', 'automation'],
  },
  {
    id: 'workday',
    name: 'Workday',
    icon: 'https://api.dicebear.com/7.x/icons/svg?seed=workday',
    connected: false,
    description: 'HR and workforce management',
    features: ['employee-sync', 'payroll-tracking', 'hr-integration'],
  },
];

export const getDemoIntegrations = (): Integration[] => {
  return [...DEMO_INTEGRATIONS];
};

export const getIntegrationById = (id: string): Integration | undefined => {
  return DEMO_INTEGRATIONS.find(i => i.id === id);
};

export const getConnectedIntegrations = (): Integration[] => {
  return DEMO_INTEGRATIONS.filter(i => i.connected);
};

export const getAvailableIntegrations = (): Integration[] => {
  return DEMO_INTEGRATIONS.filter(i => !i.connected);
};
