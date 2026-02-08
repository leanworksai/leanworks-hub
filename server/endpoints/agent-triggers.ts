/**
 * Agent Trigger Endpoints
 *
 * Human-facing endpoints to trigger AI agents on any entity type.
 * Supports tasks, projects, and plans.
 */

import express from 'express';
import crypto from 'crypto';
import { queryOrg, executeOrg } from '../../database/multi-tenant-pool.js';
import { emitEvent, EventTypes } from '../services/event-bus.js';
import { triggerAgent } from '../services/ai-agent-service.js';
import { findCompatibleAgents } from '../services/capability-matcher.js';

export function setupAgentTriggerEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  requireOrgMembership: express.RequestHandler
): void {
  /**
   * POST /api/tasks/:taskId/trigger-agent — Trigger agent on a task
   */
  app.post('/api/tasks/:taskId/trigger-agent', authenticateUser, requireOrgMembership, async (req: any, res) => {
    try {
      const { agentId, prompt } = req.body;
      if (!agentId) return res.status(400).json({ error: 'agentId is required' });

      // Load full task context
      const tasks = await queryOrg(req.orgId,
        `SELECT t.*, json_agg(json_build_object('id', tc.id, 'comment', tc.comment, 'memberName', tc.member_name))
           FILTER (WHERE tc.id IS NOT NULL) as comments
         FROM tasks t
         LEFT JOIN task_comments tc ON t.id = tc.task_id
         WHERE t.id = $1
         GROUP BY t.id`, [req.params.taskId]);

      if (tasks.length === 0) return res.status(404).json({ error: 'Task not found' });

      const triggerId = await triggerAgent(req.orgId, agentId, {
        type: 'direct_invocation',
        entityType: 'task',
        entityId: req.params.taskId,
        context: { ...tasks[0], prompt },
        triggeredBy: req.userEmail,
      });

      res.json({ triggerId });
    } catch (error) {
      console.error('Trigger agent on task error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/projects/:projectId/trigger-agent — Trigger agent on a project
   */
  app.post('/api/projects/:projectId/trigger-agent', authenticateUser, requireOrgMembership, async (req: any, res) => {
    try {
      const { agentId, prompt } = req.body;
      if (!agentId) return res.status(400).json({ error: 'agentId is required' });

      const projects = await queryOrg(req.orgId,
        `SELECT * FROM projects WHERE id = $1`, [req.params.projectId]);
      if (projects.length === 0) return res.status(404).json({ error: 'Project not found' });

      const members = await queryOrg(req.orgId,
        `SELECT user_email, role FROM project_members WHERE project_id = $1`, [req.params.projectId]);

      const projectTasks = await queryOrg(req.orgId,
        `SELECT id, title, status, priority FROM tasks WHERE project_id = $1`, [req.params.projectId]);

      const triggerId = await triggerAgent(req.orgId, agentId, {
        type: 'direct_invocation',
        entityType: 'project',
        entityId: req.params.projectId,
        context: { ...projects[0], members, tasks: projectTasks, prompt },
        triggeredBy: req.userEmail,
      });

      res.json({ triggerId });
    } catch (error) {
      console.error('Trigger agent on project error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/plans/:planId/trigger-agent — Trigger agent on a plan
   */
  app.post('/api/plans/:planId/trigger-agent', authenticateUser, requireOrgMembership, async (req: any, res) => {
    try {
      const { agentId, prompt } = req.body;
      if (!agentId) return res.status(400).json({ error: 'agentId is required' });

      const plans = await queryOrg(req.orgId,
        `SELECT * FROM plans WHERE id = $1`, [req.params.planId]);
      if (plans.length === 0) return res.status(404).json({ error: 'Plan not found' });

      const objectives = await queryOrg(req.orgId,
        `SELECT * FROM plan_objectives WHERE plan_id = $1`, [req.params.planId]);
      const milestones = await queryOrg(req.orgId,
        `SELECT * FROM plan_milestones WHERE plan_id = $1`, [req.params.planId]);

      const triggerId = await triggerAgent(req.orgId, agentId, {
        type: 'direct_invocation',
        entityType: 'plan',
        entityId: req.params.planId,
        context: { ...plans[0], objectives, milestones, prompt },
        triggeredBy: req.userEmail,
      });

      res.json({ triggerId });
    } catch (error) {
      console.error('Trigger agent on plan error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /api/agents/compatible — Find compatible agents for an entity type
   */
  app.get('/api/agents/compatible', authenticateUser, requireOrgMembership, async (req: any, res) => {
    try {
      const { entityType, action, domain } = req.query;
      const agents = await findCompatibleAgents(
        req.orgId,
        entityType as string,
        action as string,
        domain as string
      );
      res.json(agents);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });
}
