/**
 * LeanWorks Agent SDK
 *
 * TypeScript SDK for building AI agents that integrate with the LeanWorks platform.
 *
 * @example
 * ```typescript
 * import { LeanWorksAgentClient, EventStream } from '@leanworks/agent-sdk';
 *
 * const client = new LeanWorksAgentClient({
 *   apiKey: 'lw_agent_...',
 *   baseUrl: 'https://app.leanworks.io',
 *   orgId: 'org-123',
 * });
 *
 * // Read tasks
 * const tasks = await client.tasks.list({ status: 'in-progress' });
 *
 * // Post a comment
 * await client.tasks.comment(tasks[0].id, 'Analysis complete.');
 *
 * // Subscribe to events via webhook
 * await client.subscriptions.create({
 *   eventPattern: 'task.*',
 *   deliveryMethod: 'webhook',
 *   webhookUrl: 'https://my-agent.com/webhook',
 * });
 * ```
 */

export { LeanWorksAgentClient } from './client.js';
export { EventStream } from './events.js';
export { parseWebhookPayload, createWebhookHandler } from './webhooks.js';
export type {
  ClientConfig,
  Task,
  Comment,
  Project,
  Plan,
  Objective,
  Milestone,
  Agent,
  Subscription,
  PlatformEvent,
  TeamMember,
} from './types.js';
