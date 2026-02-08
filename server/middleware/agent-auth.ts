/**
 * Agent Authentication Middleware
 *
 * Authenticates AI agents via API key in the Authorization header.
 * Sets req.agentId, req.orgId, and req.agentCapabilities on the request.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { queryOrg } from '../../database/multi-tenant-pool.js';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      agentId?: string;
      agentCapabilities?: any[];
      agentName?: string;
    }
  }
}

// ============================================================================
// API KEY UTILITIES
// ============================================================================

/**
 * Generate a new API key with a recognizable prefix.
 * Returns: { plaintext, hash }
 */
export function generateAgentApiKey(): { plaintext: string; hash: string; prefix: string } {
  const randomPart = crypto.randomBytes(32).toString('hex');
  const plaintext = `lw_agent_${randomPart}`;
  const hash = hashApiKey(plaintext);
  const prefix = plaintext.substring(0, 18); // "lw_agent_" + first 9 hex chars
  return { plaintext, hash, prefix };
}

/**
 * Hash an API key for storage.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// ============================================================================
// RATE LIMITING
// ============================================================================

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 100; // 100 requests per minute per agent

function checkRateLimit(agentId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(agentId);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(agentId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return false;
  }

  return true;
}

// Clean up expired rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000); // every 5 minutes

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Authenticate an AI agent by API key.
 *
 * Expects:
 * - Authorization: Bearer lw_agent_...
 * - X-Org-Id: <org-id> (required to scope the agent lookup)
 *
 * Sets on req: agentId, orgId, agentCapabilities, agentName
 */
export function authenticateAgent(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const orgId = req.headers['x-org-id'] as string;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header. Expected: Bearer <api-key>' });
    return;
  }

  if (!orgId) {
    res.status(400).json({ error: 'Missing X-Org-Id header' });
    return;
  }

  const apiKey = authHeader.substring(7); // strip "Bearer "
  const keyHash = hashApiKey(apiKey);

  // Look up the agent by API key hash
  lookupAgentByKey(orgId, keyHash)
    .then((agent) => {
      if (!agent) {
        res.status(401).json({ error: 'Invalid API key' });
        return;
      }

      if (agent.status !== 'active') {
        res.status(403).json({ error: `Agent is ${agent.status}` });
        return;
      }

      // Check rate limit
      if (!checkRateLimit(agent.id)) {
        res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
        });
        return;
      }

      // Set agent context on the request
      (req as any).agentId = agent.id;
      (req as any).orgId = orgId;
      (req as any).agentCapabilities = agent.capabilities || [];
      (req as any).agentName = agent.name;

      // Update last_used_at on the API key (fire-and-forget)
      updateKeyLastUsed(orgId, keyHash).catch(() => {});

      next();
    })
    .catch((err) => {
      console.error('[Agent Auth] Error authenticating agent:', err);
      res.status(500).json({ error: 'Authentication error' });
    });
}

/**
 * Look up an agent by API key hash.
 * First checks the agent_api_keys table, falls back to ai_agents.api_key_hash.
 */
async function lookupAgentByKey(orgId: string, keyHash: string): Promise<any | null> {
  try {
    // Check agent_api_keys table first
    const keyRows = await queryOrg(
      orgId,
      `SELECT k.agent_id, a.id, a.name, a.status, a.capabilities
       FROM agent_api_keys k
       JOIN ai_agents a ON k.agent_id = a.id
       WHERE k.key_hash = $1 AND k.is_active = true
         AND (k.expires_at IS NULL OR k.expires_at > NOW())`,
      [keyHash]
    );

    if (keyRows.length > 0) {
      return keyRows[0];
    }

    // Fallback: check api_key_hash column on ai_agents
    const agentRows = await queryOrg(
      orgId,
      `SELECT id, name, status, capabilities FROM ai_agents WHERE api_key_hash = $1`,
      [keyHash]
    );

    return agentRows.length > 0 ? agentRows[0] : null;
  } catch (error: any) {
    // If agent_api_keys table doesn't exist yet, just check ai_agents
    if (error.code === '42P01' || error.code === '42703') {
      try {
        const agentRows = await queryOrg(
          orgId,
          `SELECT id, name, status, capabilities FROM ai_agents WHERE api_key_hash = $1`,
          [keyHash]
        );
        return agentRows.length > 0 ? agentRows[0] : null;
      } catch {
        return null;
      }
    }
    throw error;
  }
}

/**
 * Update the last_used_at timestamp on an API key.
 */
async function updateKeyLastUsed(orgId: string, keyHash: string): Promise<void> {
  try {
    await queryOrg(
      orgId,
      `UPDATE agent_api_keys SET last_used_at = NOW() WHERE key_hash = $1`,
      [keyHash]
    );
  } catch {
    // Silently ignore — table might not exist
  }
}
