/**
 * Platform Event Bus Service
 *
 * Central event bus that captures all platform mutations and routes them
 * to interested consumers (mention router, agent delivery, notifications, etc.)
 *
 * Uses Google Cloud Pub/Sub for reliable async event delivery, with
 * in-process fallback for local development.
 */

import { PubSub, Topic, Subscription, Message } from '@google-cloud/pubsub';
import crypto from 'crypto';
import { getGoogleCloudConfig } from '../utils/google-cloud.js';
import { queryOrg, executeOrg } from '../../database/multi-tenant-pool.js';

// ============================================================================
// TYPES
// ============================================================================

export type EntityType = 'task' | 'project' | 'plan' | 'discussion' | 'agent';

export type ActorType = 'human' | 'ai_agent' | 'system';

export interface PlatformEvent {
  id: string;
  type: string; // e.g. "task.created", "project.commented", "plan.updated"
  entityType: EntityType;
  entityId: string;
  orgId: string;
  actorType: ActorType;
  actorId: string; // user email or agent ID
  payload: Record<string, any>;
  mentions: string[]; // extracted @mentions (emails or agent IDs)
  timestamp: string;
}

export type EventHandler = (event: PlatformEvent) => Promise<void>;

// ============================================================================
// EVENT TYPES CONSTANTS
// ============================================================================

export const EventTypes = {
  // Task events
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_DELETED: 'task.deleted',
  TASK_COMMENTED: 'task.commented',
  TASK_STATUS_CHANGED: 'task.status_changed',
  TASK_ASSIGNED: 'task.assigned',

  // Project events
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  PROJECT_DELETED: 'project.deleted',
  PROJECT_COMMENTED: 'project.commented',
  PROJECT_MEMBER_ADDED: 'project.member_added',
  PROJECT_MEMBER_REMOVED: 'project.member_removed',

  // Plan events
  PLAN_CREATED: 'plan.created',
  PLAN_UPDATED: 'plan.updated',
  PLAN_DELETED: 'plan.deleted',
  PLAN_OBJECTIVE_CREATED: 'plan.objective_created',
  PLAN_MILESTONE_CREATED: 'plan.milestone_created',
  PLAN_MILESTONE_UPDATED: 'plan.milestone_updated',
  PLAN_BUDGET_CHANGED: 'plan.budget_changed',
  PLAN_RESOURCE_CHANGED: 'plan.resource_changed',
  PLAN_PROJECT_LINKED: 'plan.project_linked',

  // Agent events
  AGENT_TRIGGERED: 'agent.triggered',
  AGENT_COMPLETED: 'agent.completed',
  AGENT_FAILED: 'agent.failed',
  AGENT_PROGRESS: 'agent.progress_update',
  AGENT_COMMENTED: 'agent.commented',
} as const;

// ============================================================================
// PUB/SUB CLIENT (lazy initialized)
// ============================================================================

let pubsubClient: PubSub | null = null;
let platformEventsTopic: Topic | null = null;
const TOPIC_NAME = process.env.PUBSUB_PLATFORM_EVENTS_TOPIC || 'platform-events';
const SUBSCRIPTION_NAME = process.env.PUBSUB_PLATFORM_EVENTS_SUB || 'platform-events-sub';

function getPubSubClient(): PubSub {
  if (!pubsubClient) {
    const { projectId } = getGoogleCloudConfig();
    pubsubClient = new PubSub({ projectId });
  }
  return pubsubClient;
}

async function getPlatformEventsTopic(): Promise<Topic> {
  if (!platformEventsTopic) {
    const pubsub = getPubSubClient();
    platformEventsTopic = pubsub.topic(TOPIC_NAME);

    const [exists] = await platformEventsTopic.exists();
    if (!exists) {
      console.warn(`[Event Bus] Topic ${TOPIC_NAME} does not exist. Creating...`);
      await pubsub.createTopic(TOPIC_NAME);
      platformEventsTopic = pubsub.topic(TOPIC_NAME);
    }
  }
  return platformEventsTopic;
}

// ============================================================================
// IN-PROCESS EVENT HANDLERS (for local dev & same-process consumers)
// ============================================================================

const inProcessHandlers: EventHandler[] = [];

/**
 * Register an in-process event handler.
 * Handlers are called for every event published. Use for local dev
 * and for consumers that run in the same server process.
 */
export function onEvent(handler: EventHandler): void {
  inProcessHandlers.push(handler);
}

/**
 * Remove a previously registered handler
 */
export function offEvent(handler: EventHandler): void {
  const idx = inProcessHandlers.indexOf(handler);
  if (idx >= 0) inProcessHandlers.splice(idx, 1);
}

// ============================================================================
// PUBLISH
// ============================================================================

/**
 * Generate a unique event ID
 */
export function generateEventId(): string {
  return crypto.randomBytes(12).toString('hex');
}

/**
 * Publish a platform event.
 *
 * 1. Publishes to GCP Pub/Sub for async processing by workers
 * 2. Dispatches to in-process handlers (fire-and-forget)
 * 3. Persists to platform_events table for history
 */
export async function publishEvent(event: PlatformEvent): Promise<string> {
  // Ensure the event has an ID and timestamp
  if (!event.id) event.id = generateEventId();
  if (!event.timestamp) event.timestamp = new Date().toISOString();

  try {
    // 1. Publish to Pub/Sub (async delivery to workers)
    const topic = await getPlatformEventsTopic();
    const messageId = await topic.publishMessage({
      json: event,
      attributes: {
        eventId: event.id,
        eventType: event.type,
        entityType: event.entityType,
        entityId: event.entityId,
        orgId: event.orgId,
      },
    });

    console.log(`[Event Bus] Published event ${event.type} for ${event.entityType}:${event.entityId} (msg: ${messageId})`);

    // 2. Dispatch to in-process handlers (fire-and-forget, don't block the publisher)
    if (inProcessHandlers.length > 0) {
      setImmediate(async () => {
        for (const handler of inProcessHandlers) {
          try {
            await handler(event);
          } catch (err) {
            console.error('[Event Bus] In-process handler error:', err);
          }
        }
      });
    }

    return messageId;
  } catch (error: any) {
    console.error('[Event Bus] Failed to publish event:', error.message);
    // Still dispatch to in-process handlers even if Pub/Sub fails
    for (const handler of inProcessHandlers) {
      try {
        await handler(event);
      } catch (err) {
        console.error('[Event Bus] In-process handler error (fallback):', err);
      }
    }
    return event.id; // return event ID as fallback
  }
}

/**
 * Convenience: build and publish an event in one call.
 */
export async function emitEvent(
  type: string,
  entityType: EntityType,
  entityId: string,
  orgId: string,
  actorType: ActorType,
  actorId: string,
  payload: Record<string, any> = {},
  mentions: string[] = []
): Promise<string> {
  return publishEvent({
    id: generateEventId(),
    type,
    entityType,
    entityId,
    orgId,
    actorType,
    actorId,
    payload,
    mentions,
    timestamp: new Date().toISOString(),
  });
}

// ============================================================================
// PERSIST / QUERY
// ============================================================================

/**
 * Persist a platform event to the org-scoped platform_events table.
 */
export async function persistEvent(event: PlatformEvent): Promise<void> {
  try {
    await executeOrg(
      event.orgId,
      `INSERT INTO platform_events (id, event_type, entity_type, entity_id, actor_type, actor_id, payload, mentions, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        event.id,
        event.type,
        event.entityType,
        event.entityId,
        event.actorType,
        event.actorId,
        JSON.stringify(event.payload),
        JSON.stringify(event.mentions),
        event.timestamp,
      ]
    );
  } catch (error) {
    console.error('[Event Bus] Failed to persist event:', error);
  }
}

/**
 * Query event history for a specific entity.
 */
export async function getEventHistory(
  orgId: string,
  entityType: EntityType,
  entityId: string,
  limit: number = 50
): Promise<PlatformEvent[]> {
  const rows = await queryOrg(
    orgId,
    `SELECT * FROM platform_events
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY timestamp DESC
     LIMIT $3`,
    [entityType, entityId, limit]
  );

  return rows.map(rowToEvent);
}

/**
 * Query event history by event type pattern.
 */
export async function getEventsByType(
  orgId: string,
  eventTypePattern: string,
  limit: number = 50
): Promise<PlatformEvent[]> {
  // Support glob-like patterns: "task.*" becomes "task.%"
  const sqlPattern = eventTypePattern.replace(/\*/g, '%');

  const rows = await queryOrg(
    orgId,
    `SELECT * FROM platform_events
     WHERE event_type LIKE $1
     ORDER BY timestamp DESC
     LIMIT $2`,
    [sqlPattern, limit]
  );

  return rows.map(rowToEvent);
}

function rowToEvent(row: Record<string, any>): PlatformEvent {
  return {
    id: row.id,
    type: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    orgId: row.org_id || '',
    actorType: row.actor_type,
    actorId: row.actor_id,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    mentions: typeof row.mentions === 'string' ? JSON.parse(row.mentions) : (row.mentions || []),
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
  };
}

// ============================================================================
// PUB/SUB SUBSCRIPTION (for worker processes)
// ============================================================================

/**
 * Subscribe to platform events via Pub/Sub.
 * Call this in a worker process to consume events.
 */
export async function subscribeToEvents(handler: EventHandler): Promise<Subscription> {
  const pubsub = getPubSubClient();
  const topic = await getPlatformEventsTopic();

  let subscription: Subscription;
  try {
    const sub = pubsub.subscription(SUBSCRIPTION_NAME);
    const [exists] = await sub.exists();
    if (!exists) {
      console.log(`[Event Bus] Creating subscription ${SUBSCRIPTION_NAME}...`);
      const [created] = await topic.createSubscription(SUBSCRIPTION_NAME, {
        ackDeadlineSeconds: 60,
        retryPolicy: {
          minimumBackoff: { seconds: 10 },
          maximumBackoff: { seconds: 600 },
        },
      });
      subscription = created;
    } else {
      subscription = sub;
    }
  } catch (err) {
    console.error('[Event Bus] Error setting up subscription:', err);
    throw err;
  }

  subscription.on('message', async (message: Message) => {
    try {
      const event: PlatformEvent = JSON.parse(message.data.toString());
      await handler(event);
      message.ack();
    } catch (err) {
      console.error('[Event Bus] Error processing message:', err);
      message.nack();
    }
  });

  subscription.on('error', (err) => {
    console.error('[Event Bus] Subscription error:', err);
  });

  console.log(`[Event Bus] Listening on subscription: ${SUBSCRIPTION_NAME}`);
  return subscription;
}

// ============================================================================
// EXPORTS
// ============================================================================

export function getPlatformEventsPubSubClient(): PubSub {
  return getPubSubClient();
}

export function getPlatformEventsTopicName(): string {
  return TOPIC_NAME;
}

export function getPlatformEventsSubscriptionName(): string {
  return SUBSCRIPTION_NAME;
}
