import express from 'express';
import crypto from 'crypto';
import { validateRequest } from '../middleware/validate-request.js';
import {
  agentCallbackSchema,
  agentActivitySchema,
} from '../validation/ai-agent-schemas.js';
import {
  handleAgentCallback,
  createAgentActivity,
  updateAgentStats,
} from '../services/ai-agent-service.js';
import { queryOrg, executeOrg, getSharedPool } from '../../database/multi-tenant-pool.js';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// ============================================================================
// AI AGENT WEBHOOK ENDPOINTS
// ============================================================================

export function setupAIAgentWebhookEndpoints(
  app: express.Application,
  secretManagerClient: SecretManagerServiceClient,
  serviceAccount: any
) {
  // Helper function to get agent secret from Secret Manager
  async function getAgentSecret(agentId: string): Promise<string> {
    try {
      const secretName = `ai-agent-${agentId}-secret`;
      const parent = `projects/${serviceAccount.project_id}/secrets/${secretName}/versions/latest`;

      const [version] = await secretManagerClient.accessSecretVersion({ name: parent });
      return version.payload?.data?.toString() || '';
    } catch (error: any) {
      console.error('[AI Agent Webhooks] Error retrieving secret:', error);
      throw new Error('Failed to retrieve agent secret');
    }
  }

  // Helper to find org from agent ID
  async function getOrgIdByAgentId(agentId: string): Promise<string> {
    try {
      // Query shared DB to find org containing this agent
      const sharedPool = await getSharedPool();
      
      // We need to search across all org databases
      // For now, we'll require x-org-id header
      return '';
    } catch (error) {
      return '';
    }
  }

  // Middleware to authenticate agent
  async function authenticateAgent(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { agentId } = req.params;
      const providedSecret = req.headers['x-agent-secret'] as string;

      if (!agentId || !providedSecret) {
        return res.status(401).json({ error: 'Missing agent ID or secret' });
      }

      try {
        const storedSecret = await getAgentSecret(agentId);

        if (providedSecret !== storedSecret) {
          return res.status(401).json({ error: 'Invalid agent credentials' });
        }

        (req as any).agentId = agentId;
        next();
      } catch (error) {
        return res.status(401).json({ error: 'Authentication failed' });
      }
    } catch (error: any) {
      console.error('[AI Agent Webhooks] Auth error:', error);
      res.status(500).json({ error: 'Authentication error' });
    }
  }

  // ============================================================================
  // POST /api/webhooks/ai-agents/:agentId/callback
  // ============================================================================
  app.post(
    '/api/webhooks/ai-agents/:agentId/callback',
    authenticateAgent,
    validateRequest(agentCallbackSchema),
    async (req: express.Request, res: express.Response) => {
      try {
        const agentId = (req as any).agentId;
        const orgId = req.headers['x-org-id'] as string;
        const assignmentId = req.headers['x-assignment-id'] as string;
        const { status, message, result, logs, metadata } = req.body;

        if (!orgId) {
          return res.status(400).json({ error: 'X-Org-Id header required' });
        }

        const triggerId = req.headers['x-trigger-id'] as string;

        if (!assignmentId && !triggerId) {
          return res.status(400).json({ error: 'X-Assignment-Id or X-Trigger-Id header required' });
        }

        const startTime = Date.now();

        if (triggerId) {
          // Handle generic trigger callback (Phase 4)
          const { handleTriggerCallback } = await import('../services/ai-agent-service.js');
          await handleTriggerCallback(orgId, agentId, triggerId, { status, result, message });
          console.log(`✅ [AI Agent Webhooks] Trigger callback processed for ${triggerId}`);
        } else if (assignmentId) {
          // Handle task assignment callback (existing flow)
          await handleAgentCallback(orgId, agentId, assignmentId, {
            status, message, result, logs, metadata,
          });
          console.log(`✅ [AI Agent Webhooks] Callback processed for assignment ${assignmentId}`);
        }

        const executionTime = Date.now() - startTime;
        
        // Update agent stats if completed
        if (status === 'completed' || status === 'failed') {
          await updateAgentStats(orgId, agentId, executionTime);
        }

        res.json({ success: true, message: 'Callback processed' });
      } catch (error: any) {
        console.error('[AI Agent Webhooks] Error processing callback:', error);
        res.status(500).json({ error: error.message || 'Failed to process callback' });
      }
    }
  );

  // ============================================================================
  // POST /api/webhooks/ai-agents/:agentId/activity
  // ============================================================================
  app.post(
    '/api/webhooks/ai-agents/:agentId/activity',
    authenticateAgent,
    validateRequest(agentActivitySchema),
    async (req: express.Request, res: express.Response) => {
      try {
        const agentId = (req as any).agentId;
        const orgId = req.headers['x-org-id'] as string;
        const { assignmentId, taskId, activityType, title, description, metadata } = req.body;

        if (!orgId) {
          return res.status(400).json({ error: 'X-Org-Id header required' });
        }

        // Create activity event
        await createAgentActivity(
          orgId,
          agentId,
          taskId || null,
          assignmentId || null,
          activityType,
          title,
          description
        );

        console.log(`✅ [AI Agent Webhooks] Activity created for agent ${agentId}`);

        res.json({ success: true, message: 'Activity created' });
      } catch (error: any) {
        console.error('[AI Agent Webhooks] Error creating activity:', error);
        res.status(500).json({ error: error.message || 'Failed to create activity' });
      }
    }
  );

  // ============================================================================
  // GET /api/webhooks/ai-agents/:agentId/health
  // ============================================================================
  app.get(
    '/api/webhooks/ai-agents/:agentId/health',
    authenticateAgent,
    async (req: express.Request, res: express.Response) => {
      try {
        const agentId = (req as any).agentId;
        const orgId = req.headers['x-org-id'] as string;

        if (!orgId) {
          return res.status(400).json({ error: 'X-Org-Id header required' });
        }

        // Get agent details
        const agents = await queryOrg(
          orgId,
          'SELECT id, name, status, last_triggered_at FROM ai_agents WHERE id = $1',
          [agentId]
        );

        if (agents.length === 0) {
          return res.status(404).json({ error: 'Agent not found' });
        }

        const agent = agents[0];

        res.json({
          agentId: agent.id,
          name: agent.name,
          status: agent.status,
          lastTriggeredAt: agent.last_triggered_at,
          timestamp: new Date().toISOString(),
          healthy: agent.status === 'active',
        });
      } catch (error: any) {
        console.error('[AI Agent Webhooks] Error in health check:', error);
        res.status(500).json({ error: error.message || 'Health check failed' });
      }
    }
  );
}
