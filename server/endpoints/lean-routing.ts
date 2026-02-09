/**
 * Lean Routing Log Endpoints
 *
 * Admin-only endpoints for viewing Lean orchestrator routing decisions,
 * stats, and per-agent routing history.
 */

import express from 'express';
import { queryOrg } from '../../database/multi-tenant-pool.js';

export function setupLeanRoutingEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  requireOrgMembership: express.RequestHandler
): void {
  // ============================================================================
  // GET ROUTING LOG (paginated, with filters)
  // ============================================================================
  app.get(
    '/api/lean/routing-log',
    authenticateUser,
    requireOrgMembership,
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const offset = parseInt(req.query.offset as string) || 0;
        const agentId = req.query.agentId as string;
        const eventType = req.query.eventType as string;
        const decision = req.query.decision as string;

        // Build dynamic WHERE clause
        const conditions: string[] = [];
        const values: any[] = [];
        let paramCount = 1;

        if (agentId) {
          conditions.push(`l.agent_id = $${paramCount++}`);
          values.push(agentId);
        }
        if (eventType) {
          conditions.push(`l.event_type = $${paramCount++}`);
          values.push(eventType);
        }
        if (decision && (decision === 'triggered' || decision === 'skipped')) {
          conditions.push(`l.decision = $${paramCount++}`);
          values.push(decision);
        }

        const whereClause = conditions.length > 0
          ? `WHERE ${conditions.join(' AND ')}`
          : '';

        values.push(limit, offset);

        const rows = await queryOrg(
          orgId,
          `SELECT l.id, l.event_id as eventId, l.event_type as eventType, 
                  l.agent_id as agentId, a.name as agentName,
                  l.decision, l.reasoning, l.confidence, l.context_passed as contextPassed,
                  l.latency_ms as latencyMs, l.created_at as createdAt
           FROM lean_routing_log l
           LEFT JOIN ai_agents a ON l.agent_id = a.id
           ${whereClause}
           ORDER BY l.created_at DESC
           LIMIT $${paramCount++} OFFSET $${paramCount++}`,
          values
        );

        res.json(rows);
      } catch (error: any) {
        // Gracefully handle missing table
        if (error?.code === '42P01') {
          return res.json([]);
        }
        console.error('[Lean Routing] Error fetching routing log:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch routing log' });
      }
    }
  );

  // ============================================================================
  // GET ROUTING LOG FOR SPECIFIC AGENT
  // ============================================================================
  app.get(
    '/api/lean/routing-log/:agentId',
    authenticateUser,
    requireOrgMembership,
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;
        const { agentId } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

        const rows = await queryOrg(
          orgId,
          `SELECT l.id, l.event_id as eventId, l.event_type as eventType,
                  l.decision, l.reasoning, l.confidence, l.context_passed as contextPassed,
                  l.latency_ms as latencyMs, l.created_at as createdAt
           FROM lean_routing_log l
           WHERE l.agent_id = $1
           ORDER BY l.created_at DESC
           LIMIT $2`,
          [agentId, limit]
        );

        res.json(rows);
      } catch (error: any) {
        if (error?.code === '42P01') {
          return res.json([]);
        }
        console.error('[Lean Routing] Error fetching agent routing log:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch routing log' });
      }
    }
  );

  // ============================================================================
  // GET ROUTING STATS
  // ============================================================================
  app.get(
    '/api/lean/stats',
    authenticateUser,
    requireOrgMembership,
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;

        // Aggregate stats
        const statsRows = await queryOrg(
          orgId,
          `SELECT 
             COUNT(*) as total_decisions,
             COUNT(*) FILTER (WHERE decision = 'triggered') as total_triggered,
             COUNT(*) FILTER (WHERE decision = 'skipped') as total_skipped,
             AVG(latency_ms) as avg_latency_ms,
             AVG(confidence) FILTER (WHERE decision = 'triggered') as avg_triggered_confidence
           FROM lean_routing_log
           WHERE created_at > NOW() - INTERVAL '30 days'`
        );

        // Per-agent stats
        const agentRows = await queryOrg(
          orgId,
          `SELECT 
             l.agent_id as agentId,
             a.name as agentName,
             COUNT(*) as total_decisions,
             COUNT(*) FILTER (WHERE l.decision = 'triggered') as triggered_count,
             AVG(l.latency_ms) as avg_latency_ms,
             MAX(l.created_at) as last_decision_at
           FROM lean_routing_log l
           LEFT JOIN ai_agents a ON l.agent_id = a.id
           WHERE l.created_at > NOW() - INTERVAL '30 days'
           GROUP BY l.agent_id, a.name
           ORDER BY triggered_count DESC
           LIMIT 20`
        );

        const stats = statsRows[0] || {};
        res.json({
          summary: {
            totalDecisions: parseInt(stats.total_decisions) || 0,
            totalTriggered: parseInt(stats.total_triggered) || 0,
            totalSkipped: parseInt(stats.total_skipped) || 0,
            avgLatencyMs: Math.round(parseFloat(stats.avg_latency_ms) || 0),
            avgTriggeredConfidence: parseFloat(stats.avg_triggered_confidence) || 0,
          },
          perAgent: agentRows,
        });
      } catch (error: any) {
        if (error?.code === '42P01') {
          return res.json({
            summary: { totalDecisions: 0, totalTriggered: 0, totalSkipped: 0, avgLatencyMs: 0, avgTriggeredConfidence: 0 },
            perAgent: [],
          });
        }
        console.error('[Lean Routing] Error fetching stats:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch stats' });
      }
    }
  );
}
