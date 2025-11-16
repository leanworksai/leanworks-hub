/**
 * Updates and Update Summaries Endpoints
 */

import express from 'express';
import { updateSummaryQueries, queryMany, convertToFirestoreFormat } from '../../database/queries.js';

export function setupUpdateEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler
) {
  
  // GET update summaries
  app.get('/api/update-summaries', authenticateUser, async (req, res) => {
    try {
      const domain = (req as any).userDomain;
      const projectId = req.query.projectId as string | undefined;
      
      if (projectId) {
        // Get summary for specific project
        const summary = await updateSummaryQueries.getByProjectId(projectId, domain);
        
        if (!summary) {
          return res.json(null);
        }
        
        res.json(convertToFirestoreFormat(summary));
      } else {
        // Get latest summaries for all projects
        const summaries = await updateSummaryQueries.getLatestByDomain(domain);
        res.json(summaries);
      }
    } catch (error) {
      console.error('Get update summaries error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GET updates by task ID
  app.get('/api/updates/task/:taskId', authenticateUser, async (req, res) => {
    try {
      const domain = (req as any).userDomain;
      const taskId = req.params.taskId;
      
      // Query updates that include this task ID in associated_tasks
      const updates = await queryMany(
        `SELECT 
          id, update_id, project_id, user_id, associated_tasks,
          date_id, reason, update_text, timestamp
         FROM updates
         WHERE domain = $1 AND associated_tasks @> $2::jsonb
         ORDER BY timestamp DESC`,
        [domain, JSON.stringify([taskId])]
      );
      
      res.json(updates.map(update => convertToFirestoreFormat(update)));
    } catch (error) {
      console.error('Get updates by task error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });
}

