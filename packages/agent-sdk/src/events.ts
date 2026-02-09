/**
 * LeanWorks Agent SDK — Event Stream Helper
 *
 * Provides SSE event stream connection and event subscription management.
 */

import type { PlatformEvent, ClientConfig } from './types.js';

export type EventHandler = (event: PlatformEvent) => void | Promise<void>;

export class EventStream {
  private config: ClientConfig;
  private eventSource: EventSource | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;

  constructor(config: ClientConfig) {
    this.config = config;
  }

  /**
   * Subscribe to a specific event type.
   */
  on(eventType: string, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
  }

  /**
   * Unsubscribe from an event type.
   */
  off(eventType: string, handler: EventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  /**
   * Start listening to the SSE event stream.
   */
  connect(): void {
    if (typeof EventSource === 'undefined') {
      throw new Error('EventSource not available. Use Node.js eventsource polyfill.');
    }

    const url = `${this.config.baseUrl}/api/agent/v1/events/stream`;

    // Note: EventSource doesn't support custom headers in browsers.
    // For server-side usage, an eventsource polyfill with header support is needed.
    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => {
      console.log('[Agent SDK] SSE connected');
      this.reconnectDelay = 1000; // reset on successful connection
    };

    this.eventSource.onerror = () => {
      console.warn('[Agent SDK] SSE connection error');
      this.eventSource?.close();

      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      }
    };

    // Listen for all event types
    this.eventSource.onmessage = (event) => {
      try {
        const data: PlatformEvent = JSON.parse(event.data);
        this.dispatch(data);
      } catch (err) {
        console.error('[Agent SDK] Error parsing SSE event:', err);
      }
    };

    // Listen for named events (the server sends event.type as the SSE event name)
    const knownEvents = ['task.created', 'task.updated', 'task.commented', 'project.commented', 'plan.updated', 'agent.triggered'];
    for (const eventType of knownEvents) {
      this.eventSource.addEventListener(eventType, (event: any) => {
        try {
          const data: PlatformEvent = JSON.parse(event.data);
          this.dispatch(data);
        } catch (err) {
          console.error('[Agent SDK] Error parsing named SSE event:', err);
        }
      });
    }
  }

  /**
   * Disconnect from the event stream.
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.eventSource?.close();
    this.eventSource = null;
  }

  private dispatch(event: PlatformEvent): void {
    // Exact match handlers
    const exactHandlers = this.handlers.get(event.type);
    if (exactHandlers) {
      for (const handler of exactHandlers) {
        try { handler(event); } catch (err) { console.error('[Agent SDK] Handler error:', err); }
      }
    }

    // Wildcard handlers (e.g., "task.*" matches "task.created")
    for (const [pattern, handlers] of this.handlers.entries()) {
      if (pattern === event.type) continue; // already handled
      if (matchPattern(pattern, event.type)) {
        for (const handler of handlers) {
          try { handler(event); } catch (err) { console.error('[Agent SDK] Handler error:', err); }
        }
      }
    }

    // Global "*" handler
    const globalHandlers = this.handlers.get('*');
    if (globalHandlers) {
      for (const handler of globalHandlers) {
        try { handler(event); } catch (err) { console.error('[Agent SDK] Handler error:', err); }
      }
    }
  }
}

function matchPattern(pattern: string, eventType: string): boolean {
  if (pattern === '*' || pattern === '*.*') return true;
  const [pEntity, pAction] = pattern.split('.');
  const [eEntity, eAction] = eventType.split('.');
  const entityMatch = pEntity === '*' || pEntity === eEntity;
  const actionMatch = !pAction || pAction === '*' || pAction === eAction;
  return entityMatch && actionMatch;
}
