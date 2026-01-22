/**
 * Updates and Update Summaries Endpoints
 */

import express from 'express';
import { getOrgPool } from '../../database/multi-tenant-pool.js';
import { taskProgressUpdateQueries, projectProgressUpdateQueries } from '../../database/queries.js';
import { queryTaskProgressUpdatesSchema, queryProjectProgressUpdatesSchema } from '../validation/update-schemas.js';

export function setupUpdateEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler
) {

  // GET task progress updates with flexible filtering
  app.get('/api/task-progress-updates', authenticateUser, async (req, res) => {
    try {
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
      
      if (!orgId) {
        return res.status(403).json({ error: 'Organization context required' });
      }

      // Validate query parameters
      const validationResult = queryTaskProgressUpdatesSchema.safeParse(req.query);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: 'Invalid query parameters',
          details: validationResult.error.errors 
        });
      }

      const filters = validationResult.data;
      const updates = await taskProgressUpdateQueries.query(orgId, filters);
      
      res.json(updates);
    } catch (error) {
      console.error('Get task progress updates error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GET project progress updates with flexible filtering
  app.get('/api/project-progress-updates', authenticateUser, async (req, res) => {
    try {
      const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
      
      if (!orgId) {
        return res.status(403).json({ error: 'Organization context required' });
      }

      // Validate query parameters
      const validationResult = queryProjectProgressUpdatesSchema.safeParse(req.query);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: 'Invalid query parameters',
          details: validationResult.error.errors 
        });
      }

      const filters = validationResult.data;
      const summaries = await projectProgressUpdateQueries.query(orgId, filters);
      
      res.json(summaries);
    } catch (error) {
      console.error('Get project progress updates error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });
}

