/**
 * Agent API v1 Endpoints
 *
 * Provides authenticated API access for AI agents to interact with
 * the entire platform: tasks, projects, plans, team, subscriptions.
 *
 * All endpoints require agent API key authentication via the
 * authenticateAgent middleware.
 */

import express from 'express';
import crypto from 'crypto';
import { queryOrg, executeOrg } from '../../database/multi-tenant-pool.js';
import { authenticateAgent } from '../middleware/agent-auth.js';
import { emitEvent, EventTypes } from '../services/event-bus.js';
import { extractMentions } from '../services/mention-service.js';
import { createAgentActivity } from '../services/ai-agent-service.js';
import { activeSSEConnections } from '../workers/event-consumer-worker.js';
import { parseSkillMd } from '../services/skill-parser.js';

export function setupAgentAPIv1Endpoints(app: express.Application): void {
  const router = express.Router();

  // All routes require agent authentication
  router.use(authenticateAgent);

  // ============================================================================
  // SELF / IDENTITY
  // ============================================================================

  /**
   * GET /me — Get own agent profile and stats
   */
  router.get('/me', async (req: any, res) => {
    try {
      const agents = await queryOrg(req.orgId, 'SELECT * FROM ai_agents WHERE id = $1', [req.agentId]);
      if (agents.length === 0) return res.status(404).json({ error: 'Agent not found' });

      const a = agents[0];
      res.json({
        id: a.id,
        name: a.name,
        description: a.description,
        agentType: a.agent_type,
        status: a.status,
        capabilities: a.capabilities,
        totalTasksCompleted: a.total_tasks_completed,
        averageResponseTimeMs: a.average_response_time_ms,
        lastTriggeredAt: a.last_triggered_at,
        createdAt: a.created_at,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * PATCH /me/status — Update own status
   */
  router.patch('/me/status', async (req: any, res) => {
    try {
      const { status } = req.body;
      if (!['active', 'inactive', 'error'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be: active, inactive, error' });
      }

      await executeOrg(req.orgId, 'UPDATE ai_agents SET status = $1 WHERE id = $2', [status, req.agentId]);
      res.json({ success: true, status });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // TASKS
  // ============================================================================

  /**
   * GET /tasks — List tasks
   */
  router.get('/tasks', async (req: any, res) => {
    try {
      const { status, projectId, assigneeId, limit = '50' } = req.query;
      const conditions: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (status) { conditions.push(`t.status = $${idx++}`); params.push(status); }
      if (projectId) { conditions.push(`t.project_id = $${idx++}`); params.push(projectId); }
      if (assigneeId) { conditions.push(`t.assignee_id = $${idx++}`); params.push(assigneeId); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(Math.min(parseInt(limit as string) || 50, 100));

      const tasks = await queryOrg(req.orgId,
        `SELECT t.id, t.title, t.description, t.status, t.priority,
                t.assignee_id, t.assignee_name, t.assignee_type,
                t.project_id, t.project_name, t.due_date, t.tags,
                t.created_at, t.updated_at
         FROM tasks t ${where}
         ORDER BY t.created_at DESC LIMIT $${idx}`, params);

      res.json(tasks.map(mapTask));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /tasks/:taskId — Get task detail with comments
   */
  router.get('/tasks/:taskId', async (req: any, res) => {
    try {
      const tasks = await queryOrg(req.orgId,
        `SELECT * FROM tasks WHERE id = $1`, [req.params.taskId]);
      if (tasks.length === 0) return res.status(404).json({ error: 'Task not found' });

      const comments = await queryOrg(req.orgId,
        `SELECT * FROM task_comments WHERE task_id = $1 ORDER BY created_at DESC`, [req.params.taskId]);

      const task = mapTask(tasks[0]);
      task.comments = comments.map((c: any) => ({
        id: c.id,
        memberName: c.member_name,
        memberAvatar: c.member_avatar,
        authorType: c.author_type || 'human',
        agentId: c.agent_id,
        date: c.date,
        comment: c.comment,
      }));

      res.json(task);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /tasks — Create a task (agent can create tasks)
   */
  router.post('/tasks', async (req: any, res) => {
    try {
      const { title, description, projectId, status, priority, assigneeId, assigneeType, dueDate, tags } = req.body;
      if (!title) return res.status(400).json({ error: 'title is required' });

      const taskId = crypto.randomBytes(16).toString('hex');
      const now = new Date();

      await executeOrg(req.orgId,
        `INSERT INTO tasks (id, title, description, project_id, status, priority, assignee_id, assignee_type, due_date, tags, created_by, created_at, created_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [taskId, title, description || null, projectId || null, status || 'todo', priority || 'medium',
         assigneeId || null, assigneeType || 'human', dueDate || null,
         tags ? JSON.stringify(tags) : null, req.agentId, Date.now(), now.toISOString().split('T')[0]]);

      emitEvent(EventTypes.TASK_CREATED, 'task', taskId, req.orgId, 'ai_agent', req.agentId,
        { title, status: status || 'todo', projectId }, extractMentions(description))
        .catch(err => console.error('[Agent API] Event error:', err));

      res.status(201).json({ id: taskId, title, status: status || 'todo' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * PATCH /tasks/:taskId — Update task
   */
  router.patch('/tasks/:taskId', async (req: any, res) => {
    try {
      const taskId = req.params.taskId;
      const updates = req.body;

      const fieldMap: Record<string, string> = {
        title: 'title', description: 'description', status: 'status',
        priority: 'priority', actualHours: 'actual_hours',
      };

      const setClauses: string[] = [];
      const values: any[] = [];
      let idx = 1;

      for (const [key, dbField] of Object.entries(fieldMap)) {
        if (updates[key] !== undefined) {
          setClauses.push(`${dbField} = $${idx++}`);
          values.push(updates[key]);
        }
      }

      if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });

      setClauses.push('updated_at = NOW()');
      values.push(taskId);

      await executeOrg(req.orgId,
        `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${idx}`, values);

      emitEvent(EventTypes.TASK_UPDATED, 'task', taskId, req.orgId, 'ai_agent', req.agentId,
        { updatedFields: Object.keys(updates) })
        .catch(err => console.error('[Agent API] Event error:', err));

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /tasks/:taskId/comments — Post comment as agent
   */
  router.post('/tasks/:taskId/comments', async (req: any, res) => {
    try {
      const { comment } = req.body;
      if (!comment) return res.status(400).json({ error: 'comment is required' });

      const commentId = crypto.randomBytes(16).toString('hex');
      const today = new Date().toISOString().split('T')[0];

      await executeOrg(req.orgId,
        `INSERT INTO task_comments (id, task_id, member_name, member_avatar, date, comment, author_type, agent_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [commentId, req.params.taskId, req.agentName || 'AI Agent', '🤖', today, comment.trim(), 'ai_agent', req.agentId]);

      emitEvent(EventTypes.TASK_COMMENTED, 'task', req.params.taskId, req.orgId, 'ai_agent', req.agentId,
        { commentId, comment: comment.trim() }, extractMentions(comment))
        .catch(err => console.error('[Agent API] Event error:', err));

      res.status(201).json({ id: commentId, comment: comment.trim() });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /tasks/:taskId/progress — Post progress update
   */
  router.post('/tasks/:taskId/progress', async (req: any, res) => {
    try {
      const { update, type } = req.body;
      if (!update) return res.status(400).json({ error: 'update is required' });

      const updateId = crypto.randomBytes(8).toString('hex');
      const task = await queryOrg(req.orgId, 'SELECT project_id FROM tasks WHERE id = $1', [req.params.taskId]);

      await executeOrg(req.orgId,
        `INSERT INTO task_progress_updates (update_id, project_id, user_id, associated_tasks, date_id, reason, update_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [updateId, task[0]?.project_id || null, req.agentId,
         JSON.stringify([req.params.taskId]), new Date().toISOString().split('T')[0],
         type || 'update', update]);

      res.status(201).json({ id: updateId });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /tasks/:taskId/delegate — Delegate task to another agent
   */
  router.post('/tasks/:taskId/delegate', async (req: any, res) => {
    try {
      const { targetAgentId, context } = req.body;
      if (!targetAgentId) return res.status(400).json({ error: 'targetAgentId is required' });

      const assignmentId = `taa_${crypto.randomBytes(8).toString('hex')}`;
      const now = new Date();

      await executeOrg(req.orgId,
        `INSERT INTO task_ai_assignments (id, task_id, agent_id, status, assigned_at, created_at, delegated_by_agent_id, delegation_context)
         VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)`,
        [assignmentId, req.params.taskId, targetAgentId, now, now, req.agentId, context || null]);

      // Update task assignee_type
      await executeOrg(req.orgId,
        `UPDATE tasks SET assignee_type = 'ai_agent', updated_at = NOW() WHERE id = $1`,
        [req.params.taskId]);

      emitEvent(EventTypes.TASK_ASSIGNED, 'task', req.params.taskId, req.orgId, 'ai_agent', req.agentId,
        { targetAgentId, delegatedBy: req.agentId })
        .catch(err => console.error('[Agent API] Event error:', err));

      res.status(201).json({ assignmentId });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // PROJECTS
  // ============================================================================

  router.get('/projects', async (req: any, res) => {
    try {
      const { status, limit = '50' } = req.query;
      const conditions: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(Math.min(parseInt(limit as string) || 50, 100));

      const projects = await queryOrg(req.orgId,
        `SELECT id, name, description, status, priority, owner_email, due_date, created_at, updated_at
         FROM projects ${where} ORDER BY created_at DESC LIMIT $${idx}`, params);

      res.json(projects.map((p: any) => ({
        id: p.id, name: p.name, description: p.description, status: p.status,
        priority: p.priority, ownerEmail: p.owner_email, dueDate: p.due_date,
        createdAt: p.created_at,
      })));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/projects/:projectId', async (req: any, res) => {
    try {
      const projects = await queryOrg(req.orgId,
        `SELECT * FROM projects WHERE id = $1`, [req.params.projectId]);
      if (projects.length === 0) return res.status(404).json({ error: 'Project not found' });

      const members = await queryOrg(req.orgId,
        `SELECT user_email, role FROM project_members WHERE project_id = $1`, [req.params.projectId]);

      const p = projects[0];
      res.json({
        id: p.id, name: p.name, description: p.description, status: p.status,
        priority: p.priority, ownerEmail: p.owner_email, dueDate: p.due_date,
        createdAt: p.created_at, members: members.map((m: any) => ({ email: m.user_email, role: m.role })),
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/projects/:projectId/comments', async (req: any, res) => {
    try {
      const { comment } = req.body;
      if (!comment) return res.status(400).json({ error: 'comment is required' });

      const commentId = crypto.randomBytes(16).toString('hex');
      const today = new Date().toISOString().split('T')[0];

      await executeOrg(req.orgId,
        `INSERT INTO project_comments (id, project_id, member_name, member_avatar, date, comment, author_type, agent_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [commentId, req.params.projectId, req.agentName || 'AI Agent', '🤖', today, comment.trim(), 'ai_agent', req.agentId]);

      emitEvent(EventTypes.PROJECT_COMMENTED, 'project', req.params.projectId, req.orgId, 'ai_agent', req.agentId,
        { commentId, comment: comment.trim() }, extractMentions(comment))
        .catch(err => console.error('[Agent API] Event error:', err));

      res.status(201).json({ id: commentId });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // PLANS
  // ============================================================================

  router.get('/plans', async (req: any, res) => {
    try {
      const plans = await queryOrg(req.orgId,
        `SELECT id, name, description, status, start_date, end_date, total_budget, currency,
                spent_to_date, health_score, health_trend, owner_email, created_at
         FROM plans ORDER BY created_at DESC LIMIT 50`);

      res.json(plans.map((p: any) => ({
        id: p.id, name: p.name, description: p.description, status: p.status,
        startDate: p.start_date, endDate: p.end_date, totalBudget: Number(p.total_budget),
        currency: p.currency, spentToDate: Number(p.spent_to_date),
        healthScore: p.health_score, healthTrend: p.health_trend,
        ownerEmail: p.owner_email, createdAt: p.created_at,
      })));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/plans/:planId', async (req: any, res) => {
    try {
      const plans = await queryOrg(req.orgId, 'SELECT * FROM plans WHERE id = $1', [req.params.planId]);
      if (plans.length === 0) return res.status(404).json({ error: 'Plan not found' });

      const objectives = await queryOrg(req.orgId,
        'SELECT * FROM plan_objectives WHERE plan_id = $1', [req.params.planId]);
      const milestones = await queryOrg(req.orgId,
        'SELECT * FROM plan_milestones WHERE plan_id = $1', [req.params.planId]);
      const budgetCategories = await queryOrg(req.orgId,
        'SELECT * FROM plan_budget_categories WHERE plan_id = $1', [req.params.planId]);

      const p = plans[0];
      res.json({
        id: p.id, name: p.name, description: p.description, status: p.status,
        startDate: p.start_date, endDate: p.end_date, totalBudget: Number(p.total_budget),
        currency: p.currency, spentToDate: Number(p.spent_to_date),
        healthScore: p.health_score, healthTrend: p.health_trend,
        objectives: objectives.map((o: any) => ({
          id: o.id, text: o.text, targetValue: Number(o.target_value),
          currentValue: Number(o.current_value), unit: o.unit, status: o.status,
        })),
        milestones: milestones.map((m: any) => ({
          id: m.id, name: m.name, dueDate: m.due_date, status: m.status, description: m.description,
        })),
        budgetCategories: budgetCategories.map((b: any) => ({
          id: b.id, name: b.name, allocatedAmount: Number(b.allocated_amount),
          spentAmount: Number(b.spent_amount),
        })),
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/plans/:planId/activity', async (req: any, res) => {
    try {
      const { type, title, description } = req.body;
      if (!title) return res.status(400).json({ error: 'title is required' });

      const eventId = crypto.randomBytes(8).toString('hex');
      await executeOrg(req.orgId,
        `INSERT INTO plan_activity_events (id, plan_id, type, title, description, user_id, user_name, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [eventId, req.params.planId, type || 'project_update', title, description || '', req.agentId, req.agentName || 'AI Agent']);

      res.status(201).json({ id: eventId });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.patch('/plans/:planId/milestones/:milestoneId', async (req: any, res) => {
    try {
      const { status } = req.body;
      if (!status) return res.status(400).json({ error: 'status is required' });

      await executeOrg(req.orgId,
        `UPDATE plan_milestones SET status = $1, updated_at = NOW() WHERE id = $2 AND plan_id = $3`,
        [status, req.params.milestoneId, req.params.planId]);

      emitEvent(EventTypes.PLAN_MILESTONE_UPDATED, 'plan', req.params.planId, req.orgId, 'ai_agent', req.agentId,
        { milestoneId: req.params.milestoneId, status })
        .catch(err => console.error('[Agent API] Event error:', err));

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // TEAM / MEMBERS
  // ============================================================================

  router.get('/team/members', async (req: any, res) => {
    try {
      const members = await queryOrg(req.orgId,
        `SELECT email, first_name, last_name, job_title, role, status FROM users WHERE status = 'active'`);
      res.json(members.map((m: any) => ({
        email: m.email, name: `${m.first_name} ${m.last_name}`.trim(),
        jobTitle: m.job_title, role: m.role,
      })));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // AGENTS (Discovery)
  // ============================================================================

  router.get('/agents', async (req: any, res) => {
    try {
      const { capability, entityType } = req.query;
      let query = `SELECT id, name, description, agent_type, status, capabilities,
                    total_tasks_completed, average_response_time_ms, last_triggered_at
                   FROM ai_agents WHERE status = 'active'`;
      const params: any[] = [];

      if (capability) {
        query += ` AND capabilities @> $${params.length + 1}::jsonb`;
        params.push(JSON.stringify([{ domain: capability }]));
      }

      query += ' ORDER BY name ASC';
      const agents = await queryOrg(req.orgId, query, params);

      res.json(agents.map((a: any) => ({
        id: a.id, name: a.name, description: a.description,
        agentType: a.agent_type, status: a.status, capabilities: a.capabilities,
        totalTasksCompleted: a.total_tasks_completed,
        averageResponseTimeMs: a.average_response_time_ms,
      })));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/agents/:agentId', async (req: any, res) => {
    try {
      const agents = await queryOrg(req.orgId,
        `SELECT id, name, description, agent_type, status, capabilities,
                total_tasks_completed, average_response_time_ms, last_triggered_at, created_at
         FROM ai_agents WHERE id = $1`, [req.params.agentId]);
      if (agents.length === 0) return res.status(404).json({ error: 'Agent not found' });

      const a = agents[0];
      res.json({
        id: a.id, name: a.name, description: a.description,
        agentType: a.agent_type, status: a.status, capabilities: a.capabilities,
        totalTasksCompleted: a.total_tasks_completed,
        averageResponseTimeMs: a.average_response_time_ms,
        lastTriggeredAt: a.last_triggered_at, createdAt: a.created_at,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // EVENT SUBSCRIPTIONS (Phase 3)
  // ============================================================================

  router.post('/subscriptions', async (req: any, res) => {
    try {
      const { eventPattern, filterCriteria, deliveryMethod, webhookUrl } = req.body;
      if (!eventPattern) return res.status(400).json({ error: 'eventPattern is required' });
      if (!deliveryMethod || !['webhook', 'sse'].includes(deliveryMethod)) {
        return res.status(400).json({ error: 'deliveryMethod must be "webhook" or "sse"' });
      }
      if (deliveryMethod === 'webhook' && !webhookUrl) {
        return res.status(400).json({ error: 'webhookUrl required for webhook delivery' });
      }

      // Check subscription limit
      const existing = await queryOrg(req.orgId,
        'SELECT COUNT(*) as cnt FROM agent_event_subscriptions WHERE agent_id = $1', [req.agentId]);
      if (parseInt(existing[0]?.cnt || '0') >= 50) {
        return res.status(400).json({ error: 'Maximum 50 subscriptions per agent' });
      }

      const subId = `sub_${crypto.randomBytes(8).toString('hex')}`;
      await executeOrg(req.orgId,
        `INSERT INTO agent_event_subscriptions (id, agent_id, event_pattern, filter_criteria, delivery_method, webhook_url)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [subId, req.agentId, eventPattern, JSON.stringify(filterCriteria || {}), deliveryMethod, webhookUrl || null]);

      res.status(201).json({ id: subId, eventPattern, deliveryMethod });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/subscriptions', async (req: any, res) => {
    try {
      const subs = await queryOrg(req.orgId,
        `SELECT * FROM agent_event_subscriptions WHERE agent_id = $1 ORDER BY created_at DESC`, [req.agentId]);
      res.json(subs.map((s: any) => ({
        id: s.id, eventPattern: s.event_pattern, filterCriteria: s.filter_criteria,
        deliveryMethod: s.delivery_method, webhookUrl: s.webhook_url,
        isActive: s.is_active, createdAt: s.created_at,
      })));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.patch('/subscriptions/:subscriptionId', async (req: any, res) => {
    try {
      const { isActive, webhookUrl } = req.body;
      const setClauses: string[] = ['updated_at = NOW()'];
      const values: any[] = [];
      let idx = 1;

      if (isActive !== undefined) { setClauses.push(`is_active = $${idx++}`); values.push(isActive); }
      if (webhookUrl !== undefined) { setClauses.push(`webhook_url = $${idx++}`); values.push(webhookUrl); }

      values.push(req.params.subscriptionId, req.agentId);
      await executeOrg(req.orgId,
        `UPDATE agent_event_subscriptions SET ${setClauses.join(', ')} WHERE id = $${idx++} AND agent_id = $${idx}`, values);

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.delete('/subscriptions/:subscriptionId', async (req: any, res) => {
    try {
      await executeOrg(req.orgId,
        `DELETE FROM agent_event_subscriptions WHERE id = $1 AND agent_id = $2`,
        [req.params.subscriptionId, req.agentId]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // SSE EVENT STREAM (Phase 3c)
  // ============================================================================

  router.get('/events/stream', (req: any, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connected event
    res.write(`event: connected\ndata: {"agentId":"${req.agentId}"}\n\n`);

    // Register this connection
    activeSSEConnections.set(req.agentId, res);

    // Heartbeat every 30 seconds
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
      activeSSEConnections.delete(req.agentId);
    });
  });

  // ============================================================================
  // COLLABORATION THREADS (Phase 7d)
  // ============================================================================

  router.post('/threads', async (req: any, res) => {
    try {
      const { entityType, entityId, title } = req.body;
      if (!entityType || !entityId) return res.status(400).json({ error: 'entityType and entityId required' });

      const threadId = `thread_${crypto.randomBytes(8).toString('hex')}`;
      await executeOrg(req.orgId,
        `INSERT INTO collaboration_threads (id, entity_type, entity_id, title, created_by_type, created_by_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [threadId, entityType, entityId, title || null, 'ai_agent', req.agentId]);

      res.status(201).json({ id: threadId });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/threads', async (req: any, res) => {
    try {
      const { entityType, entityId } = req.query;
      const conditions: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (entityType) { conditions.push(`entity_type = $${idx++}`); params.push(entityType); }
      if (entityId) { conditions.push(`entity_id = $${idx++}`); params.push(entityId); }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const threads = await queryOrg(req.orgId,
        `SELECT * FROM collaboration_threads ${where} ORDER BY created_at DESC LIMIT 50`, params);
      res.json(threads.map((t: any) => ({
        id: t.id, entityType: t.entity_type, entityId: t.entity_id,
        title: t.title, status: t.status, createdByType: t.created_by_type,
        createdById: t.created_by_id, createdAt: t.created_at,
      })));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/threads/:threadId/messages', async (req: any, res) => {
    try {
      const messages = await queryOrg(req.orgId,
        `SELECT * FROM collaboration_messages WHERE thread_id = $1 ORDER BY created_at ASC`, [req.params.threadId]);
      res.json(messages.map((m: any) => ({
        id: m.id, authorType: m.author_type, authorId: m.author_id,
        content: m.content, metadata: m.metadata, mentions: m.mentions, createdAt: m.created_at,
      })));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/threads/:threadId/messages', async (req: any, res) => {
    try {
      const { content } = req.body;
      if (!content) return res.status(400).json({ error: 'content is required' });

      const msgId = `msg_${crypto.randomBytes(8).toString('hex')}`;
      const mentions = extractMentions(content);

      await executeOrg(req.orgId,
        `INSERT INTO collaboration_messages (id, thread_id, author_type, author_id, content, mentions)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [msgId, req.params.threadId, 'ai_agent', req.agentId, content, JSON.stringify(mentions.map(m => m.identifier))]);

      res.status(201).json({ id: msgId });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // SKILL.MD SELF-MANAGEMENT
  // ============================================================================

  /**
   * GET /me/skill — Retrieve the agent's own SKILL.md
   */
  router.get('/me/skill', async (req: any, res) => {
    try {
      const rows = await queryOrg(
        req.orgId,
        `SELECT skill_md as skillMd, skill_summary as skillSummary, skill_version as skillVersion
         FROM ai_agents WHERE id = $1`,
        [req.agentId]
      );

      if (rows.length === 0) return res.status(404).json({ error: 'Agent not found' });

      const agent = rows[0];
      res.json({
        skillMd: agent.skillmd || null,
        skillSummary: agent.skillsummary || null,
        skillVersion: agent.skillversion || null,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * PUT /me/skill — Update the agent's own SKILL.md
   */
  router.put('/me/skill', async (req: any, res) => {
    try {
      const { skillMd } = req.body;

      if (!skillMd || typeof skillMd !== 'string') {
        return res.status(400).json({ error: 'skillMd (string) is required in the request body' });
      }

      if (skillMd.length > 10000) {
        return res.status(400).json({ error: 'SKILL.md must be 10000 characters or less' });
      }

      // Parse to extract summary and version
      const parsed = parseSkillMd(skillMd);

      await executeOrg(
        req.orgId,
        `UPDATE ai_agents SET skill_md = $1, skill_summary = $2, skill_version = $3, updated_at = NOW()
         WHERE id = $4`,
        [skillMd, parsed.summary || null, parsed.version, req.agentId]
      );

      res.json({
        skillMd,
        skillSummary: parsed.summary || null,
        skillVersion: parsed.version,
        message: 'SKILL.md updated successfully',
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /me/routing-log — See Lean's routing decisions about this agent
   */
  router.get('/me/routing-log', async (req: any, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const rows = await queryOrg(
        req.orgId,
        `SELECT id, event_id as eventId, event_type as eventType, decision, reasoning,
                confidence, context_passed as contextPassed, latency_ms as latencyMs,
                created_at as createdAt
         FROM lean_routing_log
         WHERE agent_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [req.agentId, limit]
      );

      res.json(rows);
    } catch (error: any) {
      // Gracefully handle missing table
      if (error?.code === '42P01') {
        return res.json([]);
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // MOUNT ROUTER
  // ============================================================================

  app.use('/api/agent/v1', router);
}

// ============================================================================
// HELPERS
// ============================================================================

function mapTask(t: any) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    assigneeId: t.assignee_id,
    assigneeName: t.assignee_name,
    assigneeType: t.assignee_type,
    projectId: t.project_id,
    projectName: t.project_name,
    dueDate: t.due_date,
    tags: t.tags,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    comments: [] as any[],
  };
}
