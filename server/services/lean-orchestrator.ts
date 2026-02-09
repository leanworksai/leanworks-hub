/**
 * Lean Orchestrator (Hub-side)
 *
 * Thin proxy that calls the Lean API's /api/lean-route endpoint
 * for event-driven agent routing, then executes trigger decisions
 * and logs routing results.
 */

import crypto from 'crypto';
import { PlatformEvent } from './event-bus.js';
import { triggerAgent } from './ai-agent-service.js';
import { executeOrg, queryOrg } from '../../database/multi-tenant-pool.js';
import { isLocalDev } from '../utils/env.js';

// ============================================================================
// TYPES
// ============================================================================

export interface RoutingDecision {
  agent_id: string;
  trigger: boolean;
  reasoning: string;
  context: string;
  confidence: number;
  latency_ms?: number;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

function getAiServiceBase(): string {
  return isLocalDev()
    ? process.env.AI_SERVICE_URL || 'http://0.0.0.0:8082'
    : process.env.AI_SERVICE_URL || 'http://ask-api:80';
}

export function isLeanEnabled(): boolean {
  return process.env.LEAN_ROUTING_ENABLED === 'true';
}

/**
 * Event types that Lean should process. Excludes agent.* to avoid loops.
 */
const LEAN_EVENT_FILTER = (process.env.LEAN_EVENT_FILTER || 'task.*,project.*,plan.*')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

export function shouldLeanProcess(event: PlatformEvent): boolean {
  // Never process agent events to avoid loops
  if (event.type.startsWith('agent.')) return false;

  // If the actor is an AI agent, skip to avoid cascading triggers
  if (event.actorType === 'ai_agent') return false;

  // Check against configured event filter patterns
  return LEAN_EVENT_FILTER.some((pattern) => {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(event.type);
    }
    return event.type === pattern;
  });
}

// ============================================================================
// ROUTING
// ============================================================================

let cachedApiKey: string | null = null;
let apiKeyCacheTime = 0;
const API_KEY_CACHE_TTL = 5 * 60 * 1000; // 5 min

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (isLocalDev()) {
    // Local: use cached API key
    try {
      if (!cachedApiKey || Date.now() - apiKeyCacheTime > API_KEY_CACHE_TTL) {
        // Use ASK_API_KEY env var if available, otherwise skip auth
        cachedApiKey = process.env.ASK_API_KEY || '';
        apiKeyCacheTime = Date.now();
      }
      if (cachedApiKey) {
        headers['X-API-Key'] = cachedApiKey;
      }
    } catch {
      // No auth for local dev
    }
  } else {
    // Production: use internal service auth
    if (process.env.ASK_API_KEY) {
      headers['X-API-Key'] = process.env.ASK_API_KEY;
    }
  }

  return headers;
}

/**
 * Route a platform event through the Lean API's /api/lean-route endpoint.
 * Returns the list of routing decisions.
 */
export async function routeEventViaLean(
  event: PlatformEvent,
  orgSlug?: string
): Promise<RoutingDecision[]> {
  const aiServiceBase = getAiServiceBase();
  const url = `${aiServiceBase}/api/lean-route`;

  const headers = await getAuthHeaders();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event,
        org_slug: orgSlug || event.orgId,
        max_candidates: parseInt(process.env.LEAN_MAX_CANDIDATES || '5'),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Lean API returned ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as { decisions: RoutingDecision[] };
    const decisions = data.decisions || [];

    // Execute triggers and log all decisions
    for (const decision of decisions) {
      // Log routing decision
      await logRoutingDecision(event, decision);

      // Trigger the agent if decided
      if (decision.trigger) {
        try {
          await triggerAgent(event.orgId, decision.agent_id, {
            type: 'lean_orchestrator',
            entityType: event.entityType as any,
            entityId: event.entityId,
            context: {
              prompt: decision.context,
              leanReasoning: decision.reasoning,
            },
            triggeredBy: 'lean-orchestrator',
          });
          console.log(
            `[Lean Orchestrator] Triggered agent ${decision.agent_id} on ${event.entityType}:${event.entityId} ` +
              `(confidence: ${decision.confidence}, reason: ${decision.reasoning})`
          );
        } catch (err) {
          console.error(`[Lean Orchestrator] Failed to trigger agent ${decision.agent_id}:`, err);
        }
      }
    }

    return decisions;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Lean API request timed out after 30s');
    }
    throw err;
  }
}

// ============================================================================
// LOGGING
// ============================================================================

async function logRoutingDecision(event: PlatformEvent, decision: RoutingDecision): Promise<void> {
  try {
    const logId = `lrl_${crypto.randomBytes(8).toString('hex')}`;
    await executeOrg(
      event.orgId,
      `INSERT INTO lean_routing_log (id, event_id, event_type, agent_id, decision, reasoning, confidence, context_passed, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        logId,
        event.id,
        event.type,
        decision.agent_id,
        decision.trigger ? 'triggered' : 'skipped',
        decision.reasoning,
        decision.confidence,
        JSON.stringify(decision.context ? { prompt: decision.context } : {}),
        decision.latency_ms || null,
      ]
    );
  } catch (err) {
    // Don't fail the routing flow for logging errors
    console.error('[Lean Orchestrator] Error logging routing decision:', err);
  }
}
