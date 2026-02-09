/**
 * LeanWorks Agent SDK — Webhook Helpers
 *
 * Utilities for handling incoming webhook events from the platform.
 */

import type { PlatformEvent } from './types.js';

export type WebhookHandler = (event: PlatformEvent) => void | Promise<void>;

/**
 * Verify and parse an incoming webhook request.
 * Returns the parsed PlatformEvent if valid.
 */
export function parseWebhookPayload(body: string | object): PlatformEvent {
  const data = typeof body === 'string' ? JSON.parse(body) : body;

  // Basic validation
  if (!data.id || !data.type || !data.entityType) {
    throw new Error('Invalid webhook payload: missing required fields');
  }

  return data as PlatformEvent;
}

/**
 * Create an Express-compatible webhook handler middleware.
 *
 * Usage:
 * ```
 * app.post('/webhook', createWebhookHandler({
 *   'task.created': async (event) => { ... },
 *   'task.commented': async (event) => { ... },
 * }));
 * ```
 */
export function createWebhookHandler(handlers: Record<string, WebhookHandler>) {
  return async (req: any, res: any) => {
    try {
      const event = parseWebhookPayload(req.body);
      const handler = handlers[event.type] || handlers['*'];

      if (handler) {
        await handler(event);
      }

      res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error('[Webhook] Error processing event:', err);
      res.status(400).json({ error: err.message });
    }
  };
}
