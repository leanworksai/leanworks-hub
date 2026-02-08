import crypto from 'crypto';
import { queryOrg, executeOrg } from '../../database/multi-tenant-pool.js';

// ============================================================================
// AI AGENT SERVICE
// ============================================================================

/**
 * Notify an agent of a new task assignment
 * Supports webhook-based agents and API-based agents
 */
export async function notifyAgentOfAssignment(
  orgId: string,
  agentId: string,
  taskId: string,
  assignmentId: string,
  taskDetails: Record<string, any>
): Promise<void> {
  try {
    // Get agent details
    const agents = await queryOrg(
      orgId,
      'SELECT * FROM ai_agents WHERE id = $1',
      [agentId]
    );

    if (agents.length === 0) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const agent = agents[0];

    if (agent.agent_type === 'webhook') {
      await notifyWebhookAgent(agent, taskId, assignmentId, taskDetails);
    } else if (agent.agent_type === 'api') {
      await notifyAPIAgent(agent, taskId, assignmentId, taskDetails);
    } else if (agent.agent_type === 'mcp_server') {
      // MCP servers are typically long-running, notification handled differently
      console.log(`[AI Agent Service] MCP agent ${agentId} will handle task ${taskId}`);
    }

    // Create activity event
    await createAgentActivity(
      orgId,
      agentId,
      taskId,
      assignmentId,
      'assigned',
      `Task "${taskDetails.title}" assigned to agent`,
      `Task ID: ${taskId}`
    );
  } catch (error) {
    console.error('[AI Agent Service] Error notifying agent:', error);
    throw error;
  }
}

/**
 * Notify a webhook-based agent
 */
async function notifyWebhookAgent(
  agent: Record<string, any>,
  taskId: string,
  assignmentId: string,
  taskDetails: Record<string, any>
): Promise<void> {
  const config = agent.config as Record<string, any>;
  const webhookUrl = config.webhookUrl;
  const timeout = config.timeout || 300000;

  if (!webhookUrl) {
    throw new Error('Agent webhook URL not configured');
  }

  const payload = {
    assignmentId,
    taskId,
    agentId: agent.id,
    task: taskDetails,
    callbackUrl: config.callbackUrl,
    timestamp: new Date().toISOString(),
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.headers || {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn('[AI Agent Service] Webhook returned non-2xx status:', response.status);
    }
  } catch (error: any) {
    console.error('[AI Agent Service] Webhook notification failed:', {
      webhookUrl,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Notify an API-based agent
 */
async function notifyAPIAgent(
  agent: Record<string, any>,
  taskId: string,
  assignmentId: string,
  taskDetails: Record<string, any>
): Promise<void> {
  const config = agent.config as Record<string, any>;
  const baseUrl = config.baseUrl;
  const submitEndpoint = config.endpoints?.submit;
  const timeout = config.timeout || 600000;

  if (!baseUrl || !submitEndpoint) {
    throw new Error('Agent API configuration incomplete');
  }

  const submitUrl = `${baseUrl}${submitEndpoint}`;
  const payload = {
    assignmentId,
    taskId,
    agentId: agent.id,
    task: taskDetails,
    timestamp: new Date().toISOString(),
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.headers || {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn('[AI Agent Service] API returned non-2xx status:', response.status);
    }
  } catch (error: any) {
    console.error('[AI Agent Service] API notification failed:', {
      submitUrl,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Poll API-based agent for status
 */
export async function pollAgentStatus(
  orgId: string,
  agentId: string,
  assignmentId: string
): Promise<Record<string, any>> {
  try {
    // Get agent and assignment details
    const agents = await queryOrg(
      orgId,
      'SELECT * FROM ai_agents WHERE id = $1',
      [agentId]
    );

    if (agents.length === 0) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const agent = agents[0];
    const config = agent.config as Record<string, any>;
    const baseUrl = config.baseUrl;
    const statusEndpoint = config.endpoints?.status;
    const timeout = config.timeout || 600000;

    if (!baseUrl || !statusEndpoint) {
      throw new Error('Agent API status endpoint not configured');
    }

    const statusUrl = `${baseUrl}${statusEndpoint}`.replace('{taskId}', assignmentId);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(statusUrl, {
      headers: config.headers || {},
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[AI Agent Service] Error polling agent status:', error);
    throw error;
  }
}

/**
 * Handle agent callback - update assignment status
 */
export async function handleAgentCallback(
  orgId: string,
  agentId: string,
  assignmentId: string,
  callbackData: Record<string, any>
): Promise<void> {
  try {
    const { status, message, result, logs, metadata } = callbackData;

    // Update assignment
    await executeOrg(
      orgId,
      `UPDATE task_ai_assignments 
       SET status = $1, result = $2, execution_logs = $3, updated_at = NOW()
       WHERE id = $4`,
      [status, JSON.stringify(result || {}), JSON.stringify(logs || []), assignmentId]
    );

    // If completed, update task status
    if (status === 'completed') {
      const assignments = await queryOrg(
        orgId,
        'SELECT task_id FROM task_ai_assignments WHERE id = $1',
        [assignmentId]
      );

      if (assignments.length > 0) {
        const taskId = assignments[0].task_id;
        await executeOrg(
          orgId,
          'UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2',
          ['completed', taskId]
        );

        // Create completion activity
        await createAgentActivity(
          orgId,
          agentId,
          taskId,
          assignmentId,
          'completed',
          'Task completed by agent',
          message
        );
      }
    } else if (status === 'failed') {
      const assignments = await queryOrg(
        orgId,
        'SELECT task_id FROM task_ai_assignments WHERE id = $1',
        [assignmentId]
      );

      if (assignments.length > 0) {
        const taskId = assignments[0].task_id;

        // Update with error message
        await executeOrg(
          orgId,
          'UPDATE task_ai_assignments SET error_message = $1 WHERE id = $2',
          [message || 'Task failed', assignmentId]
        );

        // Create failure activity
        await createAgentActivity(
          orgId,
          agentId,
          taskId,
          assignmentId,
          'failed',
          'Task failed',
          message
        );
      }
    } else if (status === 'in_progress') {
      const assignments = await queryOrg(
        orgId,
        'SELECT task_id FROM task_ai_assignments WHERE id = $1',
        [assignmentId]
      );

      if (assignments.length > 0) {
        const taskId = assignments[0].task_id;

        // Update started_at if not already set
        await executeOrg(
          orgId,
          `UPDATE task_ai_assignments 
           SET started_at = COALESCE(started_at, NOW()), updated_at = NOW()
           WHERE id = $1`,
          [assignmentId]
        );

        // Create progress activity
        await createAgentActivity(
          orgId,
          agentId,
          taskId,
          assignmentId,
          'progress_update',
          'Agent started working on task',
          message
        );
      }
    }
  } catch (error) {
    console.error('[AI Agent Service] Error handling agent callback:', error);
    throw error;
  }
}

/**
 * Create activity event
 */
export async function createAgentActivity(
  orgId: string,
  agentId: string,
  taskId: string | null,
  assignmentId: string | null,
  activityType: string,
  title: string,
  description?: string
): Promise<void> {
  try {
    const activityId = crypto.randomBytes(8).toString('hex');
    const now = new Date();

    await executeOrg(
      orgId,
      `INSERT INTO ai_agent_activity 
       (id, agent_id, task_id, assignment_id, activity_type, title, description, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [activityId, agentId, taskId, assignmentId, activityType, title, description || '', now]
    );
  } catch (error) {
    console.error('[AI Agent Service] Error creating activity:', error);
    throw error;
  }
}

/**
 * Update agent statistics after task completion
 */
export async function updateAgentStats(
  orgId: string,
  agentId: string,
  executionTimeMs: number
): Promise<void> {
  try {
    // Get current stats
    const agents = await queryOrg(
      orgId,
      'SELECT total_tasks_completed, average_response_time_ms FROM ai_agents WHERE id = $1',
      [agentId]
    );

    if (agents.length === 0) {
      return;
    }

    const agent = agents[0];
    const newTotal = (agent.total_tasks_completed || 0) + 1;
    const currentAvg = agent.average_response_time_ms || 0;
    const newAvg = Math.round((currentAvg * (newTotal - 1) + executionTimeMs) / newTotal);

    await executeOrg(
      orgId,
      `UPDATE ai_agents 
       SET total_tasks_completed = $1, average_response_time_ms = $2, 
           last_triggered_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [newTotal, newAvg, agentId]
    );
  } catch (error) {
    console.error('[AI Agent Service] Error updating agent stats:', error);
    throw error;
  }
}

/**
 * Get agent assignments with details
 */
export async function getAgentAssignments(
  orgId: string,
  agentId: string,
  limit: number = 20
): Promise<Record<string, any>[]> {
  try {
    return await queryOrg(
      orgId,
      `SELECT taa.*, aa.name as agent_name, t.title as task_title
       FROM task_ai_assignments taa
       JOIN ai_agents aa ON taa.agent_id = aa.id
       JOIN tasks t ON taa.task_id = t.id
       WHERE taa.agent_id = $1
       ORDER BY taa.assigned_at DESC
       LIMIT $2`,
      [agentId, limit]
    );
  } catch (error) {
    console.error('[AI Agent Service] Error fetching agent assignments:', error);
    throw error;
  }
}

/**
 * Get agent activity
 */
export async function getAgentActivity(
  orgId: string,
  agentId: string,
  limit: number = 50
): Promise<Record<string, any>[]> {
  try {
    return await queryOrg(
      orgId,
      `SELECT * FROM ai_agent_activity 
       WHERE agent_id = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [agentId, limit]
    );
  } catch (error) {
    console.error('[AI Agent Service] Error fetching agent activity:', error);
    throw error;
  }
}
