import { authenticatedFetch } from '@/services/api';
import type {
  AIAgent,
  AIAgentTeam,
  TaskAIAssignment,
  AIAgentActivity,
  CreateAIAgentInput,
  UpdateAIAgentInput,
  CreateAIAgentTeamInput,
  AddAgentToTeamInput,
} from '@/types/ai-agents';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';
const buildUrl = (path: string) =>
  import.meta.env.DEV ? `${API_BASE}/api${path}` : `${API_BASE}${path}`;

async function requestJson(url: string, options: RequestInit = {}) {
  const response = await authenticatedFetch(url, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

// ============================================================================
// AI AGENT ENDPOINTS
// ============================================================================

export const aiAgentService = {
  // Create agent
  createAgent: async (input: CreateAIAgentInput): Promise<AIAgent> => {
    return requestJson(buildUrl('/ai-agents'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  // List agents
  listAgents: async (limit: number = 50): Promise<AIAgent[]> => {
    return requestJson(`${buildUrl('/ai-agents')}?limit=${limit}`);
  },

  // Get agent by ID
  getAgent: async (agentId: string): Promise<AIAgent> => {
    return requestJson(buildUrl(`/ai-agents/${agentId}`));
  },

  // Update agent
  updateAgent: async (agentId: string, input: UpdateAIAgentInput): Promise<AIAgent> => {
    return requestJson(buildUrl(`/ai-agents/${agentId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  // Delete agent
  deleteAgent: async (agentId: string): Promise<{ success: boolean }> => {
    return requestJson(buildUrl(`/ai-agents/${agentId}`), {
      method: 'DELETE',
    });
  },

  // Get agent assignments
  getAgentAssignments: async (agentId: string, limit: number = 20): Promise<TaskAIAssignment[]> => {
    return requestJson(`${buildUrl(`/ai-agents/${agentId}/assignments`)}?limit=${limit}`);
  },

  // Get agent activity
  getAgentActivity: async (agentId: string, limit: number = 50): Promise<AIAgentActivity[]> => {
    return requestJson(`${buildUrl(`/ai-agents/${agentId}/activity`)}?limit=${limit}`);
  },

  // ============================================================================
  // AI AGENT TEAM ENDPOINTS
  // ============================================================================

  // Create team
  createTeam: async (input: CreateAIAgentTeamInput): Promise<AIAgentTeam> => {
    return requestJson(buildUrl('/ai-agent-teams'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  // List teams
  listTeams: async (limit: number = 50): Promise<AIAgentTeam[]> => {
    return requestJson(`${buildUrl('/ai-agent-teams')}?limit=${limit}`);
  },

  // Get team by ID
  getTeam: async (teamId: string): Promise<AIAgentTeam> => {
    return requestJson(buildUrl(`/ai-agent-teams/${teamId}`));
  },

  // Update team
  updateTeam: async (teamId: string, input: Partial<CreateAIAgentTeamInput>): Promise<AIAgentTeam> => {
    return requestJson(buildUrl(`/ai-agent-teams/${teamId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  // Delete team
  deleteTeam: async (teamId: string): Promise<{ success: boolean }> => {
    return requestJson(buildUrl(`/ai-agent-teams/${teamId}`), {
      method: 'DELETE',
    });
  },

  // Add agent to team
  addAgentToTeam: async (teamId: string, input: AddAgentToTeamInput): Promise<{ success: boolean }> => {
    return requestJson(buildUrl(`/ai-agent-teams/${teamId}/members`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  // Remove agent from team
  removeAgentFromTeam: async (teamId: string, agentId: string): Promise<{ success: boolean }> => {
    return requestJson(buildUrl(`/ai-agent-teams/${teamId}/members/${agentId}`), {
      method: 'DELETE',
    });
  },

  // ============================================================================
  // AGENT TRIGGERS (Phase 4)
  // ============================================================================

  // Trigger agent on a task
  triggerOnTask: async (taskId: string, agentId: string, prompt?: string): Promise<{ triggerId: string }> => {
    return requestJson(buildUrl(`/tasks/${taskId}/trigger-agent`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, prompt }),
    });
  },

  // Trigger agent on a project
  triggerOnProject: async (projectId: string, agentId: string, prompt?: string): Promise<{ triggerId: string }> => {
    return requestJson(buildUrl(`/projects/${projectId}/trigger-agent`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, prompt }),
    });
  },

  // Trigger agent on a plan
  triggerOnPlan: async (planId: string, agentId: string, prompt?: string): Promise<{ triggerId: string }> => {
    return requestJson(buildUrl(`/plans/${planId}/trigger-agent`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, prompt }),
    });
  },

  // Find compatible agents for an entity type
  findCompatibleAgents: async (entityType?: string, action?: string): Promise<AIAgent[]> => {
    const params = new URLSearchParams();
    if (entityType) params.set('entityType', entityType);
    if (action) params.set('action', action);
    return requestJson(buildUrl(`/agents/compatible?${params.toString()}`));
  },

  // ============================================================================
  // API KEY MANAGEMENT (Phase 6)
  // ============================================================================

  // Generate API key for agent
  generateApiKey: async (agentId: string, label?: string): Promise<{ id: string; key: string; prefix: string }> => {
    return requestJson(buildUrl(`/ai-agents/${agentId}/api-keys`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
  },

  // List API keys for agent
  listApiKeys: async (agentId: string): Promise<{ id: string; prefix: string; label: string; lastUsedAt: string; isActive: boolean }[]> => {
    return requestJson(buildUrl(`/ai-agents/${agentId}/api-keys`));
  },

  // Revoke API key
  revokeApiKey: async (agentId: string, keyId: string): Promise<{ success: boolean }> => {
    return requestJson(buildUrl(`/ai-agents/${agentId}/api-keys/${keyId}`), {
      method: 'DELETE',
    });
  },

  // ============================================================================
  // LEAN ROUTING
  // ============================================================================

  // Get routing log for a specific agent
  getRoutingLog: async (agentId: string, limit = 20): Promise<any[]> => {
    return requestJson(buildUrl(`/lean/routing-log/${agentId}?limit=${limit}`));
  },

  // Get routing stats
  getRoutingStats: async (): Promise<any> => {
    return requestJson(buildUrl('/lean/stats'));
  },
};

// Export for convenient usage
export default aiAgentService;
