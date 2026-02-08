import express from 'express';
import crypto from 'crypto';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { validateRequest } from '../middleware/validate-request.js';
import {
  createAgentSchema,
  updateAgentSchema,
  createAgentTeamSchema,
  updateAgentTeamSchema,
  addAgentToTeamSchema,
} from '../validation/ai-agent-schemas.js';
import {
  notifyAgentOfAssignment,
  getAgentAssignments,
  getAgentActivity,
  updateAgentStats,
} from '../services/ai-agent-service.js';
import { queryOrg, executeOrg } from '../../database/multi-tenant-pool.js';

// ============================================================================
// AI AGENTS ENDPOINTS
// ============================================================================

export function setupAIAgentEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  requireOrgMembership: express.RequestHandler,
  secretManagerClient: SecretManagerServiceClient,
  serviceAccount: any
) {
  // Helper middleware to check for admin role
  async function requireAdminRole(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const orgRole = (req as any).orgRole;
      if (orgRole !== 'admin' && orgRole !== 'owner') {
        return res.status(403).json({ error: 'Admin or owner role required' });
      }
      next();
    } catch (error: any) {
      console.error('Admin role check failed:', error);
      res.status(500).json({ error: 'Authorization check failed' });
    }
  }

  // Helper function to generate secret for agent
  async function generateAgentSecret(): Promise<string> {
    return crypto.randomBytes(32).toString('hex');
  }

  // Helper function to save agent secret
  async function saveAgentSecret(
    agentId: string,
    orgId: string,
    secret: string
  ): Promise<void> {
    const secretName = `ai-agent-${agentId}-secret`;
    const parent = `projects/${serviceAccount.project_id}`;
    const fullSecretName = `${parent}/secrets/${secretName}`;

    try {
      // Try to create the secret
      try {
        await secretManagerClient.createSecret({
          parent,
          secretId: secretName,
          secret: {
            replication: {
              automatic: {},
            },
          },
        });
      } catch (error: any) {
        // If secret already exists (error code 6), that's fine
        if (error.code !== 6) {
          throw error;
        }
      }

      // Add a new version with the secret value
      await secretManagerClient.addSecretVersion({
        parent: fullSecretName,
        payload: {
          data: Buffer.from(secret, 'utf8'),
        },
      });
    } catch (error: any) {
      console.error('[AI Agent Endpoints] Error saving agent secret:', error);
      throw new Error(`Failed to save agent secret: ${error.message}`);
    }
  }

  // ============================================================================
  // CREATE AGENT
  // ============================================================================
  app.post(
    '/api/ai-agents',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    validateRequest(createAgentSchema),
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const userEmail = (req as any).userEmail;
        const { name, description, agentType, config, authConfig, capabilities, avatar } = req.body;

        const agentId = `agent_${crypto.randomBytes(8).toString('hex')}`;
        const now = new Date();

        // Generate and save agent secret
        const agentSecret = await generateAgentSecret();
        await saveAgentSecret(agentId, orgId, agentSecret);

        // Save agent to database
        await executeOrg(
          orgId,
          `INSERT INTO ai_agents 
           (id, name, description, agent_type, config, auth_config, capabilities, avatar, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            agentId,
            name,
            description || null,
            agentType,
            JSON.stringify(config || {}),
            JSON.stringify(authConfig || {}),
            JSON.stringify(capabilities || []),
            avatar || null,
            userEmail,
            now,
            now,
          ]
        );

        console.log(`✅ [AI Agent] Created agent: ${agentId}`);

        res.status(201).json({
          id: agentId,
          name,
          description,
          agentType,
          config,
          capabilities,
          status: 'active',
          createdAt: now.toISOString(),
          secret: agentSecret, // Return secret only on creation
        });
      } catch (error: any) {
        console.error('[AI Agent Endpoints] Error creating agent:', error);
        res.status(500).json({ error: error.message || 'Failed to create agent' });
      }
    }
  );

  // ============================================================================
  // LIST AGENTS
  // ============================================================================
  app.get(
    '/api/ai-agents',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

        const agents = await queryOrg(
          orgId,
          `SELECT id, name, description, agent_type as agentType, status, capabilities, avatar, 
                  total_tasks_completed as totalTasksCompleted, average_response_time_ms as averageResponseTimeMs,
                  created_at as createdAt, updated_at as updatedAt
           FROM ai_agents
           ORDER BY created_at DESC
           LIMIT $1`,
          [limit]
        );

        res.json(agents);
      } catch (error: any) {
        const msg = error?.message || 'Failed to list agents';
        const code = error?.code;
        console.error('[AI Agent Endpoints] Error listing agents:', { message: msg, code, stack: error?.stack });
        // Hint for missing table (e.g. migration not run on this org DB)
        const hint = code === '42P01' || /relation "ai_agents" does not exist/i.test(msg)
          ? ' AI agents tables may be missing for this org — run db:migrate for all orgs.'
          : '';
        res.status(500).json({ error: msg + hint });
      }
    }
  );

  // ============================================================================
  // GET AGENT
  // ============================================================================
  app.get(
    '/api/ai-agents/:agentId',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const { agentId } = req.params;

        const agents = await queryOrg(
          orgId,
          `SELECT id, name, description, agent_type as agentType, status, config, auth_config as authConfig, 
                  capabilities, avatar, total_tasks_completed as totalTasksCompleted, 
                  average_response_time_ms as averageResponseTimeMs, last_triggered_at as lastTriggeredAt,
                  created_at as createdAt, updated_at as updatedAt
           FROM ai_agents
           WHERE id = $1`,
          [agentId]
        );

        if (agents.length === 0) {
          return res.status(404).json({ error: 'Agent not found' });
        }

        res.json(agents[0]);
      } catch (error: any) {
        console.error('[AI Agent Endpoints] Error getting agent:', error);
        res.status(500).json({ error: error.message || 'Failed to get agent' });
      }
    }
  );

  // ============================================================================
  // UPDATE AGENT
  // ============================================================================
  app.patch(
    '/api/ai-agents/:agentId',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    validateRequest(updateAgentSchema),
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const { agentId } = req.params;
        const { name, description, config, authConfig, capabilities, status, avatar } = req.body;

        // Build update query dynamically
        const updates: string[] = [];
        const values: any[] = [];
        let paramCount = 1;

        if (name !== undefined) {
          updates.push(`name = $${paramCount++}`);
          values.push(name);
        }
        if (description !== undefined) {
          updates.push(`description = $${paramCount++}`);
          values.push(description);
        }
        if (config !== undefined) {
          updates.push(`config = $${paramCount++}`);
          values.push(JSON.stringify(config));
        }
        if (authConfig !== undefined) {
          updates.push(`auth_config = $${paramCount++}`);
          values.push(JSON.stringify(authConfig));
        }
        if (capabilities !== undefined) {
          updates.push(`capabilities = $${paramCount++}`);
          values.push(JSON.stringify(capabilities));
        }
        if (status !== undefined) {
          updates.push(`status = $${paramCount++}`);
          values.push(status);
        }
        if (avatar !== undefined) {
          updates.push(`avatar = $${paramCount++}`);
          values.push(avatar);
        }

        if (updates.length === 0) {
          return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push(`updated_at = NOW()`);
        values.push(agentId);

        await executeOrg(
          orgId,
          `UPDATE ai_agents SET ${updates.join(', ')} WHERE id = $${paramCount}`,
          values
        );

        console.log(`✅ [AI Agent] Updated agent: ${agentId}`);

        // Return updated agent
        const agents = await queryOrg(
          orgId,
          `SELECT id, name, description, agent_type as agentType, status, config, auth_config as authConfig,
                  capabilities, avatar, total_tasks_completed as totalTasksCompleted,
                  average_response_time_ms as averageResponseTimeMs,
                  created_at as createdAt, updated_at as updatedAt
           FROM ai_agents WHERE id = $1`,
          [agentId]
        );

        res.json(agents[0]);
      } catch (error: any) {
        console.error('[AI Agent Endpoints] Error updating agent:', error);
        res.status(500).json({ error: error.message || 'Failed to update agent' });
      }
    }
  );

  // ============================================================================
  // DELETE AGENT
  // ============================================================================
  app.delete(
    '/api/ai-agents/:agentId',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const { agentId } = req.params;

        await executeOrg(
          orgId,
          'DELETE FROM ai_agents WHERE id = $1',
          [agentId]
        );

        console.log(`✅ [AI Agent] Deleted agent: ${agentId}`);

        res.json({ success: true, message: 'Agent deleted' });
      } catch (error: any) {
        console.error('[AI Agent Endpoints] Error deleting agent:', error);
        res.status(500).json({ error: error.message || 'Failed to delete agent' });
      }
    }
  );

  // ============================================================================
  // TEST AGENT
  // ============================================================================
  app.post(
    '/api/ai-agents/:agentId/test',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const { agentId } = req.params;

        // Get agent details
        const agents = await queryOrg(
          orgId,
          'SELECT * FROM ai_agents WHERE id = $1',
          [agentId]
        );

        if (agents.length === 0) {
          return res.status(404).json({ error: 'Agent not found' });
        }

        const agent = agents[0];
        const config = agent.config as Record<string, any>;

        // Validate agent configuration
        const validationResult = {
          agentId: agent.id,
          name: agent.name,
          agentType: agent.agent_type,
          status: agent.status,
          validationPassed: true,
          errors: [] as string[],
          warnings: [] as string[],
          configCheck: {} as Record<string, any>,
          notificationTest: null as any,
        };

        // Validate config based on agent type
        if (agent.agent_type === 'webhook') {
          if (!config.webhookUrl) {
            validationResult.errors.push('Webhook URL is required');
            validationResult.validationPassed = false;
          } else {
            validationResult.configCheck.webhookUrl = config.webhookUrl;
            validationResult.configCheck.method = config.method || 'POST';
            validationResult.configCheck.timeout = config.timeout || 300000;
          }

          if (!config.callbackUrl) {
            validationResult.warnings.push('Callback URL not configured');
          } else {
            validationResult.configCheck.callbackUrl = config.callbackUrl;
          }
        } else if (agent.agent_type === 'api') {
          if (!config.baseUrl) {
            validationResult.errors.push('Base URL is required');
            validationResult.validationPassed = false;
          } else {
            validationResult.configCheck.baseUrl = config.baseUrl;
          }

          if (!config.endpoints?.submit) {
            validationResult.errors.push('Submit endpoint is required');
            validationResult.validationPassed = false;
          } else {
            validationResult.configCheck.submitEndpoint = config.endpoints.submit;
          }
        } else if (agent.agent_type === 'mcp_server') {
          if (!config.serverUrl) {
            validationResult.errors.push('Server URL is required');
            validationResult.validationPassed = false;
          } else {
            validationResult.configCheck.serverUrl = config.serverUrl;
            validationResult.configCheck.protocol = config.protocol || 'sse';
          }
        }

        // Check agent status
        if (agent.status !== 'active') {
          validationResult.warnings.push(`Agent status is ${agent.status}, not active`);
        }

        // If validation passed, attempt a test notification for webhook agents
        if (validationResult.validationPassed && agent.agent_type === 'webhook') {
          try {
            console.log(`[Test Agent] Sending test webhook to ${config.webhookUrl}`);

            const testPayload = {
              assignmentId: 'test_' + crypto.randomBytes(8).toString('hex'),
              taskId: 'test_' + crypto.randomBytes(8).toString('hex'),
              agentId: agent.id,
              task: {
                id: 'test_task_123',
                title: 'Test Task',
                description: 'This is a test notification',
                priority: 'medium',
                dueDate: new Date().toISOString().split('T')[0],
              },
              callbackUrl: config.callbackUrl,
              timestamp: new Date().toISOString(),
              test: true,
            };

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(config.webhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(config.headers || {}),
              },
              body: JSON.stringify(testPayload),
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            validationResult.notificationTest = {
              sent: true,
              statusCode: response.status,
              success: response.ok,
              timestamp: new Date().toISOString(),
            };

            if (!response.ok) {
              validationResult.warnings.push(`Webhook returned status ${response.status}`);
            }
          } catch (error: any) {
            validationResult.notificationTest = {
              sent: false,
              error: error.message,
              timestamp: new Date().toISOString(),
            };
            validationResult.warnings.push(`Failed to send test webhook: ${error.message}`);
          }
        }

        console.log(`✅ [AI Agent] Test completed for agent: ${agentId}`, validationResult);

        res.json(validationResult);
      } catch (error: any) {
        console.error('[AI Agent Endpoints] Error testing agent:', error);
        res.status(500).json({ error: error.message || 'Failed to test agent' });
      }
    }
  );

  // ============================================================================
  // GET AGENT ASSIGNMENTS
  // ============================================================================
  app.get(
    '/api/ai-agents/:agentId/assignments',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const { agentId } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

        const assignments = await getAgentAssignments(orgId, agentId, limit);
        res.json(assignments);
      } catch (error: any) {
        console.error('[AI Agent Endpoints] Error getting agent assignments:', error);
        res.status(500).json({ error: error.message || 'Failed to get assignments' });
      }
    }
  );

  // ============================================================================
  // GET AGENT ACTIVITY
  // ============================================================================
  app.get(
    '/api/ai-agents/:agentId/activity',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const { agentId } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

        const activity = await getAgentActivity(orgId, agentId, limit);
        res.json(activity);
      } catch (error: any) {
        console.error('[AI Agent Endpoints] Error getting agent activity:', error);
        res.status(500).json({ error: error.message || 'Failed to get activity' });
      }
    }
  );

  // ============================================================================
  // AI AGENT TEAMS ENDPOINTS
  // ============================================================================

  // ============================================================================
  // CREATE TEAM
  // ============================================================================
  app.post(
    '/api/ai-agent-teams',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    validateRequest(createAgentTeamSchema),
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const userEmail = (req as any).userEmail;
        const { name, description, teamId, projectId, avatar } = req.body;

        const teamId_ = `aiteam_${crypto.randomBytes(8).toString('hex')}`;
        const now = new Date();

        await executeOrg(
          orgId,
          `INSERT INTO ai_agent_teams 
           (id, name, description, team_id, project_id, avatar, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [teamId_, name, description || null, teamId || null, projectId || null, avatar || null, userEmail, now, now]
        );

        console.log(`✅ [AI Agent Team] Created team: ${teamId_}`);

        res.status(201).json({
          id: teamId_,
          name,
          description,
          teamId,
          projectId,
          avatar,
          members: [],
          createdAt: now.toISOString(),
        });
      } catch (error: any) {
        console.error('[AI Agent Endpoints] Error creating team:', error);
        res.status(500).json({ error: error.message || 'Failed to create team' });
      }
    }
  );

  // ============================================================================
  // LIST TEAMS
  // ============================================================================
  app.get(
    '/api/ai-agent-teams',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

        const teams = await queryOrg(
          orgId,
          `SELECT id, name, description, team_id as teamId, project_id as projectId, avatar,
                  created_at as createdAt, updated_at as updatedAt
           FROM ai_agent_teams
           ORDER BY created_at DESC
           LIMIT $1`,
          [limit]
        );

        // Fetch members for each team
        const teamsWithMembers = await Promise.all(
          teams.map(async (team) => {
            const members = await queryOrg(
              orgId,
              `SELECT aa.id, aa.name, aa.agent_type as agentType, aa.status,
                      aatm.role, aatm.priority
               FROM ai_agent_team_members aatm
               JOIN ai_agents aa ON aatm.agent_id = aa.id
               WHERE aatm.team_id = $1
               ORDER BY aatm.priority DESC`,
              [team.id]
            );
            return { ...team, members };
          })
        );

        res.json(teamsWithMembers);
      } catch (error: any) {
        const msg = error?.message || 'Failed to list teams';
        const code = error?.code;
        console.error('[AI Agent Endpoints] Error listing teams:', { message: msg, code, stack: error?.stack });
        const hint = code === '42P01' || /relation "ai_agent/.test(msg)
          ? ' AI agents tables may be missing for this org — run db:migrate for all orgs.'
          : '';
        res.status(500).json({ error: msg + hint });
      }
    }
  );

  // ============================================================================
  // GET TEAM
  // ============================================================================
  app.get(
    '/api/ai-agent-teams/:teamId',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const { teamId } = req.params;

        const teams = await queryOrg(
          orgId,
          `SELECT id, name, description, team_id as teamId, project_id as projectId, avatar,
                  created_at as createdAt, updated_at as updatedAt
           FROM ai_agent_teams WHERE id = $1`,
          [teamId]
        );

        if (teams.length === 0) {
          return res.status(404).json({ error: 'Team not found' });
        }

        const team = teams[0];

        const members = await queryOrg(
          orgId,
          `SELECT aa.id, aa.name, aa.agent_type as agentType, aa.status,
                  aatm.role, aatm.priority
           FROM ai_agent_team_members aatm
           JOIN ai_agents aa ON aatm.agent_id = aa.id
           WHERE aatm.team_id = $1
           ORDER BY aatm.priority DESC`,
          [teamId]
        );

        res.json({ ...team, members });
      } catch (error: any) {
        console.error('[AI Agent Endpoints] Error getting team:', error);
        res.status(500).json({ error: error.message || 'Failed to get team' });
      }
    }
  );

  // ============================================================================
  // UPDATE TEAM
  // ============================================================================
  app.patch(
    '/api/ai-agent-teams/:teamId',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    validateRequest(updateAgentTeamSchema),
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const { teamId } = req.params;
        const { name, description, teamId: linkedTeamId, projectId, avatar } = req.body;

        const updates: string[] = [];
        const values: any[] = [];
        let paramCount = 1;

        if (name !== undefined) {
          updates.push(`name = $${paramCount++}`);
          values.push(name);
        }
        if (description !== undefined) {
          updates.push(`description = $${paramCount++}`);
          values.push(description);
        }
        if (linkedTeamId !== undefined) {
          updates.push(`team_id = $${paramCount++}`);
          values.push(linkedTeamId);
        }
        if (projectId !== undefined) {
          updates.push(`project_id = $${paramCount++}`);
          values.push(projectId);
        }
        if (avatar !== undefined) {
          updates.push(`avatar = $${paramCount++}`);
          values.push(avatar);
        }

        if (updates.length === 0) {
          return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push(`updated_at = NOW()`);
        values.push(teamId);

        await executeOrg(
          orgId,
          `UPDATE ai_agent_teams SET ${updates.join(', ')} WHERE id = $${paramCount}`,
          values
        );

        console.log(`✅ [AI Agent Team] Updated team: ${teamId}`);

        // Return updated team
        const teams = await queryOrg(
          orgId,
          `SELECT id, name, description, team_id as teamId, project_id as projectId, avatar,
                  created_at as createdAt, updated_at as updatedAt
           FROM ai_agent_teams WHERE id = $1`,
          [teamId]
        );

        res.json(teams[0]);
      } catch (error: any) {
        console.error('[AI Agent Endpoints] Error updating team:', error);
        res.status(500).json({ error: error.message || 'Failed to update team' });
      }
    }
  );

  // ============================================================================
  // DELETE TEAM
  // ============================================================================
  app.delete(
    '/api/ai-agent-teams/:teamId',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const { teamId } = req.params;

        await executeOrg(
          orgId,
          'DELETE FROM ai_agent_teams WHERE id = $1',
          [teamId]
        );

        console.log(`✅ [AI Agent Team] Deleted team: ${teamId}`);

        res.json({ success: true, message: 'Team deleted' });
      } catch (error: any) {
        console.error('[AI Agent Endpoints] Error deleting team:', error);
        res.status(500).json({ error: error.message || 'Failed to delete team' });
      }
    }
  );

  // ============================================================================
  // ADD AGENT TO TEAM
  // ============================================================================
  app.post(
    '/api/ai-agent-teams/:teamId/members',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    validateRequest(addAgentToTeamSchema),
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const { teamId } = req.params;
        const { agentId, role, priority } = req.body;

        await executeOrg(
          orgId,
          `INSERT INTO ai_agent_team_members (team_id, agent_id, role, priority, added_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (team_id, agent_id) DO UPDATE SET role = $3, priority = $4`,
          [teamId, agentId, role || null, priority || 0]
        );

        console.log(`✅ [AI Agent Team] Added agent ${agentId} to team ${teamId}`);

        res.json({ success: true, message: 'Agent added to team' });
      } catch (error: any) {
        console.error('[AI Agent Endpoints] Error adding agent to team:', error);
        res.status(500).json({ error: error.message || 'Failed to add agent' });
      }
    }
  );

  // ============================================================================
  // REMOVE AGENT FROM TEAM
  // ============================================================================
  app.delete(
    '/api/ai-agent-teams/:teamId/members/:agentId',
    authenticateUser,
    requireOrgMembership,
    requireAdminRole,
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const { teamId, agentId } = req.params;

        await executeOrg(
          orgId,
          'DELETE FROM ai_agent_team_members WHERE team_id = $1 AND agent_id = $2',
          [teamId, agentId]
        );

        console.log(`✅ [AI Agent Team] Removed agent ${agentId} from team ${teamId}`);

        res.json({ success: true, message: 'Agent removed from team' });
      } catch (error: any) {
        console.error('[AI Agent Endpoints] Error removing agent from team:', error);
        res.status(500).json({ error: error.message || 'Failed to remove agent' });
      }
    }
  );
}
