/**
 * Platform Event Consumer Worker
 *
 * Subscribes to the platform-events Pub/Sub topic and processes events:
 * 1. Persists events to the platform_events table
 * 2. Routes @mentions to notifications / agent triggers
 * 3. Delivers events to agent subscribers (webhook / SSE)
 */

import { Message } from '@google-cloud/pubsub';
import {
  PlatformEvent,
  subscribeToEvents,
  persistEvent,
} from '../services/event-bus.js';
import { extractMentions, routeMentions } from '../services/mention-service.js';
import { buildSignedWebhookHeaders } from '../services/webhook-signing.js';
import { queryOrg } from '../../database/multi-tenant-pool.js';
import { routeEventViaLean, isLeanEnabled, shouldLeanProcess } from '../services/lean-orchestrator.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

let isRunning = false;

// In-memory map of active SSE connections keyed by agentId
// This is populated by the SSE endpoint in agent-api-v1.ts
export const activeSSEConnections = new Map<string, any>();

// ============================================================================
// EVENT PROCESSING
// ============================================================================

/**
 * Process a single platform event.
 */
async function processEvent(event: PlatformEvent): Promise<void> {
  console.log(`[Event Consumer] Processing event: ${event.type} (${event.entityType}:${event.entityId})`);

  try {
    // 1. Persist event to database
    await persistEvent(event);

    // 2. Route mentions if present
    if (event.mentions && event.mentions.length > 0) {
      const mentionTargets = event.mentions.map(id => {
        // Determine if it's a user or agent mention
        if (id.includes('@') || !id.match(/^[a-f0-9]{16,}$/)) {
          return { type: 'user' as const, identifier: id, raw: `@${id}` };
        }
        return { type: 'agent' as const, identifier: id, raw: `@${id}` };
      });

      await routeMentions(event.orgId, mentionTargets, {
        eventType: event.type,
        entityType: event.entityType,
        entityId: event.entityId,
        actorId: event.actorId,
      });
    }

    // 3. Route through Lean Orchestrator (if enabled)
    let leanTriggeredAgentIds: Set<string> | undefined;
    if (isLeanEnabled() && shouldLeanProcess(event)) {
      try {
        const decisions = await routeEventViaLean(event);
        // Collect agent IDs that Lean already triggered (for deduplication)
        leanTriggeredAgentIds = new Set(
          decisions.filter(d => d.trigger).map(d => d.agent_id)
        );
      } catch (err) {
        console.error('[Event Consumer] Lean routing error (falling back to subscriptions):', err);
      }
    }

    // 4. Deliver to agent subscribers (Lean augments, does not replace)
    await deliverToSubscribers(event, leanTriggeredAgentIds);
  } catch (error) {
    console.error('[Event Consumer] Error processing event:', error);
    throw error; // re-throw so Pub/Sub can retry
  }
}

// ============================================================================
// AGENT EVENT DELIVERY
// ============================================================================

/**
 * Find matching agent subscriptions and deliver the event.
 */
async function deliverToSubscribers(
  event: PlatformEvent,
  leanTriggeredAgentIds?: Set<string>
): Promise<void> {
  try {
    // Query matching subscriptions
    const subscriptions = await findMatchingSubscriptions(event);

    for (const sub of subscriptions) {
      // Deduplication: skip if Lean already triggered this agent for this event
      if (leanTriggeredAgentIds && leanTriggeredAgentIds.has(sub.agent_id)) {
        console.log(`[Event Consumer] Skipping subscription delivery for agent ${sub.agent_id} — already triggered by Lean`);
        continue;
      }

      try {
        if (sub.delivery_method === 'webhook' && sub.webhook_url) {
          await deliverViaWebhook(sub, event);
        } else if (sub.delivery_method === 'sse') {
          deliverViaSSE(sub.agent_id, event);
        }
      } catch (err) {
        console.error(`[Event Consumer] Delivery failed for subscription ${sub.id}:`, err);
        // Log delivery failure
        await logDeliveryAttempt(event.orgId, sub.id, event.id, 'failed', (err as Error).message);
      }
    }
  } catch (error) {
    // If we can't query subscriptions (table might not exist yet), silently continue
    if ((error as any)?.code === '42P01') {
      // Table doesn't exist yet — that's fine, Phase 3 will create it
      return;
    }
    console.error('[Event Consumer] Error finding subscribers:', error);
  }
}

/**
 * Find subscriptions matching an event.
 * Supports glob patterns: "task.*", "*.commented", "*.*"
 */
async function findMatchingSubscriptions(event: PlatformEvent): Promise<any[]> {
  try {
    const rows = await queryOrg(
      event.orgId,
      `SELECT s.* FROM agent_event_subscriptions s
       JOIN ai_agents a ON s.agent_id = a.id
       WHERE s.is_active = true
         AND a.status = 'active'
         AND (
           s.event_pattern = $1
           OR s.event_pattern = '*.*'
           OR s.event_pattern = $2
           OR s.event_pattern = $3
         )`,
      [
        event.type, // exact match: "task.created"
        `${event.entityType}.*`, // entity wildcard: "task.*"
        `*.${event.type.split('.')[1] || ''}`, // action wildcard: "*.created"
      ]
    );

    // Apply filter criteria
    return rows.filter((sub: any) => {
      if (!sub.filter_criteria || Object.keys(sub.filter_criteria).length === 0) {
        return true; // no filter = match all
      }
      // Check each filter criterion against the event payload
      for (const [key, value] of Object.entries(sub.filter_criteria)) {
        if (event.payload[key] !== value) return false;
      }
      return true;
    });
  } catch (error) {
    // Table might not exist yet (Phase 3)
    if ((error as any)?.code === '42P01') return [];
    throw error;
  }
}

/**
 * Deliver event via webhook (HTTP POST).
 */
async function deliverViaWebhook(
  subscription: any,
  event: PlatformEvent,
  retries: number = 3
): Promise<void> {
  const webhookUrl = subscription.webhook_url;
  let lastError: Error | null = null;

  const body = JSON.stringify(event);
  const agentId = subscription.agent_id;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const headers = await buildSignedWebhookHeaders(agentId, body, {
        'X-LeanWorks-Event': event.type,
        'X-LeanWorks-Event-Id': event.id,
        'X-LeanWorks-Subscription-Id': subscription.id,
      });

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        await logDeliveryAttempt(event.orgId, subscription.id, event.id, 'delivered');
        return;
      }

      lastError = new Error(`Webhook returned ${response.status}`);
    } catch (err) {
      lastError = err as Error;
    }

    // Exponential backoff between retries
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  throw lastError || new Error('Webhook delivery failed');
}

/**
 * Deliver event via SSE to an active agent connection.
 */
function deliverViaSSE(agentId: string, event: PlatformEvent): void {
  const connection = activeSSEConnections.get(agentId);
  if (connection) {
    try {
      connection.write(`id: ${event.id}\n`);
      connection.write(`event: ${event.type}\n`);
      connection.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      console.error(`[Event Consumer] SSE write error for agent ${agentId}:`, err);
      activeSSEConnections.delete(agentId);
    }
  }
}

/**
 * Log a delivery attempt to the event_delivery_log table.
 */
async function logDeliveryAttempt(
  orgId: string,
  subscriptionId: string,
  eventId: string,
  status: string,
  errorMessage?: string
): Promise<void> {
  try {
    const { randomBytes } = await import('crypto');
    const logId = randomBytes(12).toString('hex');
    await queryOrg(
      orgId,
      `INSERT INTO event_delivery_log (id, subscription_id, event_id, status, attempts, last_error, delivered_at, created_at)
       VALUES ($1, $2, $3, $4, 1, $5, ${status === 'delivered' ? 'NOW()' : 'NULL'}, NOW())
       ON CONFLICT DO NOTHING`,
      [logId, subscriptionId, eventId, status, errorMessage || null]
    );
  } catch (error) {
    // Table might not exist yet (Phase 3)
    if ((error as any)?.code !== '42P01') {
      console.error('[Event Consumer] Error logging delivery:', error);
    }
  }
}

// ============================================================================
// WORKER LIFECYCLE
// ============================================================================

/**
 * Start the event consumer worker.
 * Can run as a standalone process or be started from the main server.
 */
export async function startEventConsumer(): Promise<void> {
  if (isRunning) {
    console.log('[Event Consumer] Already running');
    return;
  }

  isRunning = true;
  console.log('[Event Consumer] Starting platform event consumer...');

  try {
    const subscription = await subscribeToEvents(processEvent);
    console.log('[Event Consumer] Successfully subscribed to platform events');

    // Handle shutdown
    const shutdown = () => {
      console.log('[Event Consumer] Shutting down...');
      isRunning = false;
      subscription.close();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('[Event Consumer] Failed to start:', error);
    isRunning = false;
    throw error;
  }
}

/**
 * Start the event consumer using in-process handler (for development).
 * Instead of Pub/Sub, registers an in-process handler on the event bus.
 */
export function startInProcessEventConsumer(): void {
  const { onEvent } = require('../services/event-bus.js');

  onEvent(async (event: PlatformEvent) => {
    try {
      await processEvent(event);
    } catch (err) {
      console.error('[Event Consumer] In-process event error:', err);
    }
  });

  console.log('[Event Consumer] In-process event consumer started');
}

export { activeSSEConnections as sseConnections };
