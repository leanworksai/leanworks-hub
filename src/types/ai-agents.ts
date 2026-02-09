// AI Agents Types

export interface AIAgent {
  id: string;
  name: string;
  description?: string;
  agentType: 'webhook' | 'api' | 'mcp_server';
  status: 'active' | 'inactive' | 'error';
  config: Record<string, any>;
  authConfig?: Record<string, any>;
  capabilities: string[];
  avatar?: string;
  totalTasksCompleted: number;
  averageResponseTimeMs?: number;
  lastTriggeredAt?: string;
  skillMd?: string;
  skillSummary?: string;
  skillVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIAgentTeam {
  id: string;
  name: string;
  description?: string;
  teamId?: string;
  projectId?: string;
  avatar?: string;
  members: AIAgent[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskAIAssignment {
  id: string;
  taskId: string;
  agentId?: string;
  agentTeamId?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  result?: Record<string, any>;
  errorMessage?: string;
  executionLogs?: string[];
  assignedAt: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIAgentActivity {
  id: string;
  agentId: string;
  taskId?: string;
  assignmentId?: string;
  activityType: 'assigned' | 'started' | 'progress_update' | 'completed' | 'failed' | 'comment';
  title: string;
  description?: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface CreateAIAgentInput {
  name: string;
  description?: string;
  agentType: 'webhook' | 'api' | 'mcp_server';
  config: Record<string, any>;
  authConfig?: Record<string, any>;
  capabilities?: string[];
  avatar?: string;
  skillMd: string;
}

export interface UpdateAIAgentInput {
  name?: string;
  description?: string;
  config?: Record<string, any>;
  authConfig?: Record<string, any>;
  capabilities?: string[];
  status?: 'active' | 'inactive' | 'error';
  avatar?: string;
  skillMd?: string;
}

export interface CreateAIAgentTeamInput {
  name: string;
  description?: string;
  teamId?: string;
  projectId?: string;
  avatar?: string;
}

export interface AddAgentToTeamInput {
  agentId: string;
  role?: string;
  priority?: number;
}
