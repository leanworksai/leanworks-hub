/**
 * LeanWorks Agent SDK — Client
 */

import type {
  ClientConfig, Task, Project, Plan, Agent, Subscription,
  TeamMember, PlatformEvent,
} from './types.js';

export class LeanWorksAgentClient {
  private config: Required<ClientConfig>;

  constructor(config: ClientConfig) {
    this.config = {
      ...config,
      timeout: config.timeout || 30000,
      baseUrl: config.baseUrl.replace(/\/$/, ''),
    };
  }

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const url = `${this.config.baseUrl}/api/agent/v1${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-Org-Id': this.config.orgId,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(error.error || `Request failed: ${response.status}`);
      }

      return response.json();
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') throw new Error('Request timeout');
      throw err;
    }
  }

  // ==================== SELF ====================

  /** Get own agent profile */
  async getMe(): Promise<Agent> {
    return this.request('GET', '/me');
  }

  /** Update own status */
  async updateStatus(status: 'active' | 'inactive' | 'error'): Promise<void> {
    await this.request('PATCH', '/me/status', { status });
  }

  // ==================== TASKS ====================

  readonly tasks = {
    /** List tasks */
    list: (params?: { status?: string; projectId?: string; limit?: number }): Promise<Task[]> => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      if (params?.projectId) qs.set('projectId', params.projectId);
      if (params?.limit) qs.set('limit', String(params.limit));
      const query = qs.toString();
      return this.request('GET', `/tasks${query ? '?' + query : ''}`);
    },

    /** Get task by ID */
    get: (taskId: string): Promise<Task> => {
      return this.request('GET', `/tasks/${taskId}`);
    },

    /** Create a task */
    create: (task: { title: string; description?: string; projectId?: string; status?: string; priority?: string }): Promise<{ id: string }> => {
      return this.request('POST', '/tasks', task);
    },

    /** Update a task */
    update: (taskId: string, updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority'>>): Promise<void> => {
      return this.request('PATCH', `/tasks/${taskId}`, updates);
    },

    /** Post comment on a task */
    comment: (taskId: string, comment: string): Promise<{ id: string }> => {
      return this.request('POST', `/tasks/${taskId}/comments`, { comment });
    },

    /** Delegate task to another agent */
    delegate: (taskId: string, targetAgentId: string, context?: string): Promise<{ assignmentId: string }> => {
      return this.request('POST', `/tasks/${taskId}/delegate`, { targetAgentId, context });
    },
  };

  // ==================== PROJECTS ====================

  readonly projects = {
    list: (params?: { status?: string }): Promise<Project[]> => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      const query = qs.toString();
      return this.request('GET', `/projects${query ? '?' + query : ''}`);
    },

    get: (projectId: string): Promise<Project> => {
      return this.request('GET', `/projects/${projectId}`);
    },

    comment: (projectId: string, comment: string): Promise<{ id: string }> => {
      return this.request('POST', `/projects/${projectId}/comments`, { comment });
    },
  };

  // ==================== PLANS ====================

  readonly plans = {
    list: (): Promise<Plan[]> => {
      return this.request('GET', '/plans');
    },

    get: (planId: string): Promise<Plan> => {
      return this.request('GET', `/plans/${planId}`);
    },

    updateMilestone: (planId: string, milestoneId: string, status: string): Promise<void> => {
      return this.request('PATCH', `/plans/${planId}/milestones/${milestoneId}`, { status });
    },
  };

  // ==================== TEAM ====================

  readonly team = {
    listMembers: (): Promise<TeamMember[]> => {
      return this.request('GET', '/team/members');
    },
  };

  // ==================== AGENTS (DISCOVERY) ====================

  readonly agents = {
    list: (params?: { capability?: string }): Promise<Agent[]> => {
      const qs = new URLSearchParams();
      if (params?.capability) qs.set('capability', params.capability);
      const query = qs.toString();
      return this.request('GET', `/agents${query ? '?' + query : ''}`);
    },

    get: (agentId: string): Promise<Agent> => {
      return this.request('GET', `/agents/${agentId}`);
    },
  };

  // ==================== SUBSCRIPTIONS ====================

  readonly subscriptions = {
    create: (sub: { eventPattern: string; deliveryMethod: 'webhook' | 'sse'; filterCriteria?: Record<string, any>; webhookUrl?: string }): Promise<Subscription> => {
      return this.request('POST', '/subscriptions', sub);
    },

    list: (): Promise<Subscription[]> => {
      return this.request('GET', '/subscriptions');
    },

    update: (subscriptionId: string, updates: { isActive?: boolean; webhookUrl?: string }): Promise<void> => {
      return this.request('PATCH', `/subscriptions/${subscriptionId}`, updates);
    },

    delete: (subscriptionId: string): Promise<void> => {
      return this.request('DELETE', `/subscriptions/${subscriptionId}`);
    },
  };
}
