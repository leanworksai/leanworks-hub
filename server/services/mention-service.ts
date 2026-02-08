/**
 * Mention Service
 *
 * Server-side mention extraction and routing.
 * Detects @mentions in text content, resolves them to users or agents,
 * and routes notifications or triggers accordingly.
 */

import { queryOrg } from '../../database/multi-tenant-pool.js';

// ============================================================================
// TYPES
// ============================================================================

export interface MentionTarget {
  type: 'user' | 'agent';
  identifier: string; // email for users, agent ID or name for agents
  raw: string; // the raw @mention text
}

export interface ResolvedMention extends MentionTarget {
  resolved: boolean;
  displayName?: string;
  entityId?: string; // resolved agent ID for agent mentions
}

// ============================================================================
// MENTION REGEX (matches the frontend regex from ChatMessage.tsx)
// ============================================================================

/**
 * Regex for detecting @mentions in text.
 * Supports:
 * - @username (simple names)
 * - @user@domain.com (email format)
 * - @agent:agent-name (agent prefix format)
 */
const MENTION_REGEX = /@(agent:[a-zA-Z0-9_-]+|[a-zA-Z0-9_]+(?:\s+[a-zA-Z0-9_]+)*?|[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)(?=\s|$|[.,!?;:])/g;

// ============================================================================
// EXTRACTION
// ============================================================================

/**
 * Extract @mentions from text content.
 * Returns a list of mention targets (users or agents).
 */
export function extractMentions(text: string | null | undefined): MentionTarget[] {
  if (!text) return [];

  const mentions: MentionTarget[] = [];
  const seen = new Set<string>();

  let match;
  const regex = new RegExp(MENTION_REGEX.source, MENTION_REGEX.flags);
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0]; // full @mention
    const value = match[1]; // without @

    // Avoid duplicates
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (value.startsWith('agent:')) {
      // Agent mention: @agent:agent-name
      mentions.push({
        type: 'agent',
        identifier: value.substring(6), // strip "agent:" prefix
        raw,
      });
    } else if (value.includes('@')) {
      // Email mention: @user@domain.com
      mentions.push({
        type: 'user',
        identifier: value.toLowerCase(),
        raw,
      });
    } else {
      // Simple name mention: @username — could be user or agent
      // We'll resolve this later by checking both tables
      mentions.push({
        type: 'user', // default to user, will be resolved
        identifier: value,
        raw,
      });
    }
  }

  return mentions;
}

/**
 * Extract just the mention identifiers as a flat string array.
 * Useful for storing in the event's mentions field.
 */
export function extractMentionIds(text: string | null | undefined): string[] {
  return extractMentions(text).map((m) => m.identifier);
}

// ============================================================================
// RESOLUTION
// ============================================================================

/**
 * Resolve mention targets against the org's user and agent tables.
 * For name-based mentions, checks both users and agents.
 */
export async function resolveMentionTargets(
  orgId: string,
  mentions: MentionTarget[]
): Promise<ResolvedMention[]> {
  if (mentions.length === 0) return [];

  const resolved: ResolvedMention[] = [];

  // Separate by type
  const userMentions = mentions.filter((m) => m.type === 'user');
  const agentMentions = mentions.filter((m) => m.type === 'agent');

  // Resolve email-based user mentions
  const emailMentions = userMentions.filter((m) => m.identifier.includes('@'));
  if (emailMentions.length > 0) {
    const emails = emailMentions.map((m) => m.identifier);
    try {
      const users = await queryOrg(
        orgId,
        `SELECT email, first_name, last_name FROM users WHERE LOWER(email) = ANY($1)`,
        [emails]
      );
      const userMap = new Map(users.map((u: any) => [u.email.toLowerCase(), u]));

      for (const mention of emailMentions) {
        const user = userMap.get(mention.identifier);
        resolved.push({
          ...mention,
          resolved: !!user,
          displayName: user ? `${user.first_name} ${user.last_name}`.trim() : undefined,
        });
      }
    } catch (err) {
      // If resolution fails, mark as unresolved
      for (const mention of emailMentions) {
        resolved.push({ ...mention, resolved: false });
      }
    }
  }

  // Resolve name-based mentions (check users first, then agents)
  const nameMentions = userMentions.filter((m) => !m.identifier.includes('@'));
  if (nameMentions.length > 0) {
    for (const mention of nameMentions) {
      const name = mention.identifier;
      try {
        // Check users by first name (case-insensitive)
        const users = await queryOrg(
          orgId,
          `SELECT email, first_name, last_name FROM users WHERE LOWER(first_name) = LOWER($1) LIMIT 1`,
          [name]
        );

        if (users.length > 0) {
          const user = users[0];
          resolved.push({
            ...mention,
            type: 'user',
            resolved: true,
            displayName: `${user.first_name} ${user.last_name}`.trim(),
            entityId: user.email,
          });
          continue;
        }

        // Check agents by name (case-insensitive)
        const agents = await queryOrg(
          orgId,
          `SELECT id, name FROM ai_agents WHERE LOWER(name) = LOWER($1) AND status = 'active' LIMIT 1`,
          [name]
        );

        if (agents.length > 0) {
          const agent = agents[0];
          resolved.push({
            ...mention,
            type: 'agent',
            resolved: true,
            displayName: agent.name,
            entityId: agent.id,
          });
          continue;
        }

        resolved.push({ ...mention, resolved: false });
      } catch (err) {
        resolved.push({ ...mention, resolved: false });
      }
    }
  }

  // Resolve agent mentions (@agent:agent-id or @agent:agent-name)
  for (const mention of agentMentions) {
    try {
      const agents = await queryOrg(
        orgId,
        `SELECT id, name FROM ai_agents WHERE (id = $1 OR LOWER(name) = LOWER($1)) AND status = 'active' LIMIT 1`,
        [mention.identifier]
      );

      if (agents.length > 0) {
        const agent = agents[0];
        resolved.push({
          ...mention,
          resolved: true,
          displayName: agent.name,
          entityId: agent.id,
        });
      } else {
        resolved.push({ ...mention, resolved: false });
      }
    } catch (err) {
      resolved.push({ ...mention, resolved: false });
    }
  }

  return resolved;
}

// ============================================================================
// ROUTING
// ============================================================================

/**
 * Route mentions to the appropriate notification/trigger endpoints.
 * - User mentions: create notifications
 * - Agent mentions: trigger the agent via the agent service
 *
 * This is called by the event consumer worker when processing events.
 */
export async function routeMentions(
  orgId: string,
  mentions: MentionTarget[],
  context: {
    eventType: string;
    entityType: string;
    entityId: string;
    actorId: string;
    content?: string;
  }
): Promise<void> {
  if (mentions.length === 0) return;

  const resolved = await resolveMentionTargets(orgId, mentions);

  for (const mention of resolved) {
    if (!mention.resolved) continue;

    if (mention.type === 'user' && mention.entityId) {
      // Create a notification for the mentioned user
      try {
        await createMentionNotification(orgId, mention, context);
      } catch (err) {
        console.error('[Mention Service] Error creating notification:', err);
      }
    }

    if (mention.type === 'agent' && mention.entityId) {
      // Agent mentions will be handled by the event consumer worker
      // which will call triggerAgent() from ai-agent-service.ts
      console.log(
        `[Mention Service] Agent ${mention.entityId} mentioned in ${context.entityType}:${context.entityId}`
      );
    }
  }
}

/**
 * Create a notification for a mentioned user.
 */
async function createMentionNotification(
  orgId: string,
  mention: ResolvedMention,
  context: {
    eventType: string;
    entityType: string;
    entityId: string;
    actorId: string;
    content?: string;
  }
): Promise<void> {
  // For now, log the mention. In a full implementation, this would
  // insert into the shared notifications table.
  console.log(
    `[Mention Service] Notification for user ${mention.entityId || mention.identifier}: ` +
      `mentioned in ${context.entityType}:${context.entityId} by ${context.actorId}`
  );

  // TODO: Insert into shared.notifications table when notification
  // delivery via WebSocket/SSE is implemented
}
