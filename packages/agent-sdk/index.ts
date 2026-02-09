/**
 * Leanworks Agent SDK - TypeScript/JavaScript SDK for AI Agents
 * 
 * Usage:
 * const agent = new LeanworksAgentSDK({
 *   agentId: 'agent_123',
 *   agentSecret: process.env.LEANWORKS_AGENT_SECRET,
 *   apiUrl: 'https://leanworks.com/api'
 * });
 * 
 * await agent.startWebhookServer(3000);
 */

import express from 'express';
import fetch from 'node-fetch';

export interface LeanworksAgentConfig {
  agentId: string;
  agentSecret: string;
  apiUrl: string;
  mode?: 'webhook' | 'api';
}

export interface TaskAssignment {
  assignmentId: string;
  taskId: string;
  agentId: string;
  task: {
    id: string;
    title: string;
    description?: string;
    priority?: string;
    dueDate?: string;
  };
  callbackUrl: string;
}

export class LeanworksAgentSDK {
  private config: LeanworksAgentConfig;
  private webhookServer?: express.Express;
  private onTaskAssignedHandlers: ((task: TaskAssignment) => Promise<void>)[] = [];

  constructor(config: LeanworksAgentConfig) {
    this.config = {
      mode: 'webhook',
      ...config,
    };
  }

  /**
   * Register a handler for when tasks are assigned to this agent
   */
  onTaskAssigned(handler: (task: TaskAssignment) => Promise<void>) {
    this.onTaskAssignedHandlers.push(handler);
  }

  /**
   * Start webhook server to receive task assignments
   */
  async startWebhookServer(port: number = 3000) {
    this.webhookServer = express();
    this.webhookServer.use(express.json());

    // Webhook endpoint for task assignments
    this.webhookServer.post('/webhook', async (req, res) => {
      try {
        const secret = req.headers['x-agent-secret'];
        if (secret !== this.config.agentSecret) {
          return res.status(401).json({ error: 'Invalid secret' });
        }

        const taskAssignment: TaskAssignment = req.body;

        // Call all registered handlers
        for (const handler of this.onTaskAssignedHandlers) {
          await handler(taskAssignment);
        }

        res.json({ success: true });
      } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Health check endpoint
    this.webhookServer.get('/health', (req, res) => {
      res.json({
        agentId: this.config.agentId,
        status: 'healthy',
        timestamp: new Date().toISOString(),
      });
    });

    return new Promise((resolve) => {
      this.webhookServer!.listen(port, () => {
        console.log(`🚀 Agent webhook server listening on port ${port}`);
        resolve(port);
      });
    });
  }

  /**
   * Update task assignment status
   */
  async updateStatus(
    assignmentId: string,
    status: 'in_progress' | 'completed' | 'failed',
    message: string,
    options?: { orgId?: string }
  ): Promise<void> {
    try {
      const callbackUrl = `${this.config.apiUrl}/webhooks/ai-agents/${this.config.agentId}/callback`;

      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Secret': this.config.agentSecret,
          'X-Assignment-Id': assignmentId,
          'X-Org-Id': options?.orgId || '',
        },
        body: JSON.stringify({
          status,
          message,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Error updating status:', error);
      throw error;
    }
  }

  /**
   * Post activity/comment on task
   */
  async postComment(
    assignmentId: string,
    message: string,
    options?: { orgId?: string; taskId?: string; title?: string }
  ): Promise<void> {
    try {
      const activityUrl = `${this.config.apiUrl}/webhooks/ai-agents/${this.config.agentId}/activity`;

      const response = await fetch(activityUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Secret': this.config.agentSecret,
          'X-Org-Id': options?.orgId || '',
        },
        body: JSON.stringify({
          assignmentId,
          taskId: options?.taskId,
          activityType: 'comment',
          title: options?.title || 'Comment from agent',
          description: message,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Error posting comment:', error);
      throw error;
    }
  }

  /**
   * Mark task as completed
   */
  async complete(
    assignmentId: string,
    result: any,
    options?: { orgId?: string; message?: string }
  ): Promise<void> {
    await this.updateStatus(
      assignmentId,
      'completed',
      options?.message || 'Task completed successfully',
      { orgId: options?.orgId }
    );

    // Optionally post completion activity
    if (options?.message) {
      await this.postComment(assignmentId, options.message, {
        orgId: options.orgId,
        title: 'Task completed',
      });
    }
  }

  /**
   * Mark task as failed
   */
  async fail(assignmentId: string, error: string, options?: { orgId?: string }): Promise<void> {
    await this.updateStatus(assignmentId, 'failed', error, { orgId: options?.orgId });

    await this.postComment(assignmentId, `Error: ${error}`, {
      orgId: options?.orgId,
      title: 'Task failed',
    });
  }

  /**
   * Send progress update
   */
  async postProgress(
    assignmentId: string,
    message: string,
    options?: { orgId?: string; taskId?: string }
  ): Promise<void> {
    try {
      const activityUrl = `${this.config.apiUrl}/webhooks/ai-agents/${this.config.agentId}/activity`;

      const response = await fetch(activityUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Secret': this.config.agentSecret,
          'X-Org-Id': options?.orgId || '',
        },
        body: JSON.stringify({
          assignmentId,
          taskId: options?.taskId,
          activityType: 'progress_update',
          title: 'Progress update',
          description: message,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Error posting progress:', error);
      throw error;
    }
  }
}

// Export for use
export default LeanworksAgentSDK;
