/**
 * Mock demo AI agents for demo mode
 */

export interface AIAgent {
  id: string;
  name: string;
  description?: string;
  agent_type: 'webhook' | 'api' | 'mcp_server';
  status: 'active' | 'inactive' | 'error';
  config: Record<string, any>;
  auth_config?: Record<string, any>;
  capabilities: string[];
  avatar?: string;
  created_by: string;
  last_triggered_at?: string;
  total_tasks_completed: number;
  average_response_time_ms: number;
  created_at: string;
  updated_at: string;
}

export interface AIAgentTeam {
  id: string;
  name: string;
  description?: string;
  team_id?: string;
  project_id?: string;
  avatar?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AIAgentTeamMember {
  id: string;
  team_id: string;
  agent_id: string;
  role: string;
  priority: number;
  added_at: string;
}

export interface TaskAIAssignment {
  id: string;
  task_id: string;
  agent_id?: string;
  agent_team_id?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  assigned_at: string;
  started_at?: string;
  completed_at?: string;
  result?: Record<string, any>;
  error_message?: string;
  execution_logs?: string[];
  created_at: string;
  updated_at: string;
}

export interface AIAgentActivity {
  id: string;
  agent_id: string;
  task_id?: string;
  assignment_id?: string;
  activity_type: 'assigned' | 'started' | 'progress_update' | 'completed' | 'failed' | 'comment';
  title: string;
  description?: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export const DEMO_AI_AGENTS: AIAgent[] = [
  {
    id: 'ai-agent-001',
    name: 'ML Trainer Agent',
    description: 'Trains machine learning models for task classification and predictions',
    agent_type: 'api',
    status: 'active',
    config: {
      endpoint: 'http://localhost:8080/api/ml-trainer',
      timeout: 300000,
      retryCount: 3,
    },
    capabilities: [
      'model-training',
      'data-processing',
      'evaluation',
      'prediction',
      'performance-monitoring',
    ],
    avatar: 'https://api.dicebear.com/7.x/icons/svg?seed=ml-trainer',
    created_by: 'demo@example.com',
    last_triggered_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    total_tasks_completed: 24,
    average_response_time_ms: 18500,
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'ai-agent-002',
    name: 'Code Review Bot',
    description: 'Performs automated code reviews and quality checks',
    agent_type: 'webhook',
    status: 'active',
    config: {
      githubAppId: 'demo-app-123',
      webhookPath: '/api/webhooks/ai-agents/ai-agent-002/callback',
    },
    capabilities: ['code-review', 'quality-analysis', 'security-scanning', 'performance-review'],
    avatar: 'https://api.dicebear.com/7.x/icons/svg?seed=code-review',
    created_by: 'sarah@example.com',
    last_triggered_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    total_tasks_completed: 156,
    average_response_time_ms: 4200,
    created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'ai-agent-003',
    name: 'Documentation Generator',
    description: 'Auto-generates documentation from code and comments',
    agent_type: 'api',
    status: 'active',
    config: {
      endpoint: 'http://localhost:8080/api/doc-generator',
      formats: ['markdown', 'html', 'pdf'],
      templates: ['api-docs', 'user-guide', 'architecture'],
    },
    capabilities: ['documentation', 'code-analysis', 'formatting', 'publishing'],
    avatar: 'https://api.dicebear.com/7.x/icons/svg?seed=doc-gen',
    created_by: 'alex@example.com',
    last_triggered_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    total_tasks_completed: 42,
    average_response_time_ms: 8900,
    created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'ai-agent-004',
    name: 'Performance Optimizer',
    description: 'Analyzes and optimizes application performance',
    agent_type: 'api',
    status: 'active',
    config: {
      endpoint: 'http://localhost:8080/api/performance-optimizer',
      metricsCollector: 'prometheus',
      targets: ['backend', 'frontend', 'database'],
    },
    capabilities: ['performance-analysis', 'bottleneck-detection', 'optimization-suggestions', 'benchmarking'],
    avatar: 'https://api.dicebear.com/7.x/icons/svg?seed=perf-opt',
    created_by: 'marcus@example.com',
    last_triggered_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    total_tasks_completed: 18,
    average_response_time_ms: 12000,
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'ai-agent-005',
    name: 'Data Analyst',
    description: 'Analyzes project data and generates insights',
    agent_type: 'api',
    status: 'active',
    config: {
      endpoint: 'http://localhost:8080/api/data-analyst',
      dataSource: 'postgresql',
      analysisTypes: ['trend', 'anomaly', 'forecast', 'correlation'],
    },
    capabilities: ['data-analysis', 'visualization', 'forecasting', 'anomaly-detection'],
    avatar: 'https://api.dicebear.com/7.x/icons/svg?seed=data-analyst',
    created_by: 'demo@example.com',
    last_triggered_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    total_tasks_completed: 67,
    average_response_time_ms: 6800,
    created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEMO_AI_AGENT_TEAMS: AIAgentTeam[] = [
  {
    id: 'ai-team-001',
    name: 'Quality Assurance Team',
    description: 'AI agents focused on code quality and testing',
    team_id: undefined,
    project_id: 'proj-001',
    avatar: 'https://api.dicebear.com/7.x/icons/svg?seed=qa-team',
    created_by: 'sarah@example.com',
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'ai-team-002',
    name: 'Operations & Analytics',
    description: 'AI agents for system monitoring and data analysis',
    team_id: undefined,
    project_id: undefined,
    avatar: 'https://api.dicebear.com/7.x/icons/svg?seed=ops-team',
    created_by: 'demo@example.com',
    created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEMO_AI_AGENT_TEAM_MEMBERS: AIAgentTeamMember[] = [
  {
    id: 'agm-001',
    team_id: 'ai-team-001',
    agent_id: 'ai-agent-002',
    role: 'primary',
    priority: 1,
    added_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'agm-002',
    team_id: 'ai-team-001',
    agent_id: 'ai-agent-004',
    role: 'secondary',
    priority: 2,
    added_at: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'agm-003',
    team_id: 'ai-team-002',
    agent_id: 'ai-agent-004',
    role: 'primary',
    priority: 1,
    added_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'agm-004',
    team_id: 'ai-team-002',
    agent_id: 'ai-agent-005',
    role: 'primary',
    priority: 1,
    added_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export const DEMO_TASK_AI_ASSIGNMENTS: TaskAIAssignment[] = [
  {
    id: 'assignment-001',
    task_id: 'task-008',
    agent_id: 'ai-agent-001',
    agent_team_id: undefined,
    status: 'completed',
    assigned_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    started_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    result: {
      modelType: 'XGBoost',
      accuracy: 0.94,
      precision: 0.92,
      recall: 0.95,
      trainingTime: 18500,
      samplesProcessed: 15000,
    },
    execution_logs: [
      'Started model training with 15000 samples',
      'Feature engineering completed',
      'Model training phase 1 complete',
      'Model training phase 2 complete',
      'Validation in progress',
      'Training complete. Accuracy: 0.94',
    ],
    created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'assignment-002',
    task_id: 'task-010',
    agent_id: 'ai-agent-002',
    agent_team_id: 'ai-team-001',
    status: 'in_progress',
    assigned_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    started_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    result: undefined,
    execution_logs: [
      'Code review initiated',
      'Analyzing component structure',
      'Checking accessibility compliance',
      '78% complete - found 3 minor issues',
    ],
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'assignment-003',
    task_id: 'task-004',
    agent_id: 'ai-agent-003',
    agent_team_id: undefined,
    status: 'pending',
    assigned_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    execution_logs: [],
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEMO_AI_AGENT_ACTIVITIES: AIAgentActivity[] = [
  {
    id: 'activity-001',
    agent_id: 'ai-agent-001',
    task_id: 'task-008',
    assignment_id: 'assignment-001',
    activity_type: 'completed',
    title: 'Model Training Complete',
    description: 'Successfully trained ML model with 94% accuracy on validation set',
    metadata: {
      accuracy: 0.94,
      modelType: 'XGBoost',
      samplesUsed: 15000,
    },
    timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'activity-002',
    agent_id: 'ai-agent-002',
    task_id: 'task-010',
    assignment_id: 'assignment-002',
    activity_type: 'progress_update',
    title: 'Code Review In Progress',
    description: 'Analyzing component for accessibility and performance',
    metadata: {
      progress: 78,
      issuesFound: 3,
      category: 'accessibility',
    },
    timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'activity-003',
    agent_id: 'ai-agent-004',
    task_id: undefined,
    assignment_id: undefined,
    activity_type: 'comment',
    title: 'Performance Alert',
    description: 'API response time increased by 15% in the last hour',
    metadata: {
      alertLevel: 'warning',
      metric: 'response_time',
      threshold: 5000,
      current: 5750,
    },
    timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
];

export const getDemoAIAgents = (): AIAgent[] => {
  return [...DEMO_AI_AGENTS];
};

export const getDemoAIAgentTeams = (): AIAgentTeam[] => {
  return [...DEMO_AI_AGENT_TEAMS];
};

export const getDemoAIAgentTeamMembers = (): AIAgentTeamMember[] => {
  return [...DEMO_AI_AGENT_TEAM_MEMBERS];
};

export const getDemoTaskAIAssignments = (): TaskAIAssignment[] => {
  return [...DEMO_TASK_AI_ASSIGNMENTS];
};

export const getDemoAIAgentActivities = (): AIAgentActivity[] => {
  return [...DEMO_AI_AGENT_ACTIVITIES];
};

export const getAIAgentById = (agentId: string): AIAgent | undefined => {
  return DEMO_AI_AGENTS.find(a => a.id === agentId);
};

export const getAIAgentsByTeamId = (teamId: string): AIAgent[] => {
  const memberIds = DEMO_AI_AGENT_TEAM_MEMBERS.filter(m => m.team_id === teamId).map(m => m.agent_id);
  return DEMO_AI_AGENTS.filter(a => memberIds.includes(a.id));
};

export const getTaskAIAssignmentsByTaskId = (taskId: string): TaskAIAssignment[] => {
  return DEMO_TASK_AI_ASSIGNMENTS.filter(a => a.task_id === taskId);
};

export const getAIAgentActivitiesByAgentId = (agentId: string): AIAgentActivity[] => {
  return DEMO_AI_AGENT_ACTIVITIES.filter(a => a.agent_id === agentId);
};
