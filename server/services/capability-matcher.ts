/**
 * Capability Matcher Service
 *
 * Matches agents to entities based on their declared capabilities.
 * Capabilities are stored as a JSONB array on ai_agents, supporting both
 * simple strings and structured objects.
 */

import { queryOrg } from '../../database/multi-tenant-pool.js';

// ============================================================================
// TYPES
// ============================================================================

export interface StructuredCapability {
  domain: string; // e.g. "code-review", "testing", "documentation"
  entityTypes?: string[]; // e.g. ["task", "project"]
  actions?: string[]; // e.g. ["analyze", "suggest", "execute"]
}

export interface CompatibleAgent {
  id: string;
  name: string;
  description: string | null;
  agentType: string;
  status: string;
  capabilities: (string | StructuredCapability)[];
  totalTasksCompleted: number;
  averageResponseTimeMs: number | null;
}

// ============================================================================
// MATCHING
// ============================================================================

/**
 * Find agents compatible with a given entity type and optional action.
 *
 * Capabilities can be:
 * - Simple strings: ["code-review", "testing"] — matches any entity type
 * - Structured: [{"domain": "code-review", "entityTypes": ["task"], "actions": ["analyze"]}]
 */
export async function findCompatibleAgents(
  orgId: string,
  entityType?: string,
  action?: string,
  domain?: string
): Promise<CompatibleAgent[]> {
  // Get all active agents
  const agents = await queryOrg(
    orgId,
    `SELECT id, name, description, agent_type, status, capabilities,
            total_tasks_completed, average_response_time_ms
     FROM ai_agents
     WHERE status = 'active'
     ORDER BY total_tasks_completed DESC`
  );

  // Filter by capability match
  return agents
    .filter((agent: any) => {
      const caps = agent.capabilities || [];
      if (!Array.isArray(caps) || caps.length === 0) {
        // Agents with no capabilities match everything (generic agents)
        return true;
      }

      return caps.some((cap: any) => {
        if (typeof cap === 'string') {
          // Simple string capability — matches if domain matches or no domain filter
          return !domain || cap.toLowerCase() === domain.toLowerCase();
        }

        if (typeof cap === 'object' && cap !== null) {
          // Structured capability
          const domainMatch = !domain || cap.domain?.toLowerCase() === domain.toLowerCase();
          const entityMatch = !entityType || !cap.entityTypes || cap.entityTypes.includes(entityType);
          const actionMatch = !action || !cap.actions || cap.actions.includes(action);
          return domainMatch && entityMatch && actionMatch;
        }

        return false;
      });
    })
    .map((agent: any) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      agentType: agent.agent_type,
      status: agent.status,
      capabilities: agent.capabilities,
      totalTasksCompleted: agent.total_tasks_completed,
      averageResponseTimeMs: agent.average_response_time_ms,
    }));
}

/**
 * Find agents that have subscribed to a specific event type.
 */
export async function findAgentsForEvent(
  orgId: string,
  eventType: string
): Promise<string[]> {
  try {
    const entityType = eventType.split('.')[0];
    const rows = await queryOrg(
      orgId,
      `SELECT DISTINCT s.agent_id
       FROM agent_event_subscriptions s
       JOIN ai_agents a ON s.agent_id = a.id
       WHERE s.is_active = true AND a.status = 'active'
         AND (s.event_pattern = $1 OR s.event_pattern = $2 OR s.event_pattern = '*.*')`,
      [eventType, `${entityType}.*`]
    );
    return rows.map((r: any) => r.agent_id);
  } catch (error) {
    // Table might not exist yet
    if ((error as any)?.code === '42P01') return [];
    throw error;
  }
}
