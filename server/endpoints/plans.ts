/**
 * Plans API Endpoints
 * Handles CRUD operations for strategic plans
 */

import express from 'express';
import crypto from 'crypto';
import { queryOrg, executeOrg } from '../../database/multi-tenant-pool.js';
import { validateRequest } from '../middleware/validate-request.js';
import {
  createPlanSchema,
  updatePlanSchema,
  createObjectiveSchema,
  updateObjectiveSchema,
  createBudgetCategorySchema,
  updateBudgetCategorySchema,
  createResourceAllocationSchema,
  updateResourceAllocationSchema,
  createMilestoneSchema,
  updateMilestoneSchema,
  linkProjectSchema,
} from '../validation/plan-schemas.js';

export const setupPlansEndpoints = (
  app: express.Application,
  authenticateUser: express.RequestHandler,
  requireOrgMembership: express.RequestHandler
) => {
  const mapPlanRow = (row: any) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    totalBudget: Number(row.total_budget),
    currency: row.currency,
    spentToDate: Number(row.spent_to_date),
    ownerEmail: row.owner_email,
    ownerName: row.owner_name,
    teamSize: row.team_size,
    healthScore: row.health_score,
    healthTrend: row.health_trend,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  // ============================================================================
  // GET /api/plans - Get all plans with optional filters
  // ============================================================================
  app.get('/api/plans', authenticateUser, requireOrgMembership, async (req: any, res: any) => {
    try {
      const orgId = req.orgId;
      const status = req.query.status as string;
      const searchQuery = req.query.search as string;
      const sortBy = req.query.sortBy as string || 'created_at DESC';

      let query = 'SELECT * FROM plans';
      const params: any[] = [];

      // Apply filters
      if (status && status !== 'all') {
        query += ' WHERE status = $1';
        params.push(status);
      }

      if (searchQuery) {
        const paramIndex = params.length + 1;
        const searchPattern = `%${searchQuery.toLowerCase()}%`;
        if (params.length === 0) {
          query += ` WHERE (LOWER(name) LIKE $${paramIndex} OR LOWER(description) LIKE $${paramIndex})`;
        } else {
          query += ` AND (LOWER(name) LIKE $${paramIndex} OR LOWER(description) LIKE $${paramIndex})`;
        }
        params.push(searchPattern);
      }

      // Apply sorting
      if (sortBy === 'health') {
        query += ' ORDER BY health_score DESC';
      } else if (sortBy === 'budget') {
        query += ' ORDER BY total_budget DESC';
      } else if (sortBy === 'timeline') {
        query += ' ORDER BY end_date ASC';
      } else {
        query += ' ORDER BY created_at DESC';
      }

      const plans = await queryOrg(orgId, query, params);
      res.json(plans.map(mapPlanRow));
    } catch (error) {
      console.error('Get plans error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // GET /api/plans/:id - Get single plan with all nested data
  // ============================================================================
  app.get('/api/plans/:id', authenticateUser, requireOrgMembership, async (req: any, res: any) => {
    try {
      const orgId = req.orgId;
      const planId = req.params.id;

      // Get plan
      const planResult = await queryOrg(
        orgId,
        'SELECT * FROM plans WHERE id = $1',
        [planId]
      );

      if (planResult.length === 0) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      const plan = mapPlanRow(planResult[0]);

      // Get objectives
      const objectives = await queryOrg(
        orgId,
        'SELECT id, text, target_value as targetValue, current_value as currentValue, unit, due_date as dueDate, status FROM plan_objectives WHERE plan_id = $1 ORDER BY created_at',
        [planId]
      );

      // Get budget categories
      const budgetCategories = await queryOrg(
        orgId,
        'SELECT id, name, allocated_amount as allocatedAmount, spent_amount as spentAmount, project_id as projectId FROM plan_budget_categories WHERE plan_id = $1 ORDER BY created_at',
        [planId]
      );

      // Get resource allocations
      const resourceAllocations = await queryOrg(
        orgId,
        'SELECT id, user_email as userEmail, user_name as userName, allocation_percentage as allocationPercentage, start_date as startDate, end_date as endDate, role, hourly_rate as hourlyRate, normalized_hours as normalizedHours, project_id as projectId FROM plan_resource_allocations WHERE plan_id = $1 ORDER BY created_at',
        [planId]
      );

      // Get milestones
      const milestones = await queryOrg(
        orgId,
        'SELECT id, name, due_date as dueDate, status, description FROM plan_milestones WHERE plan_id = $1 ORDER BY due_date',
        [planId]
      );

      // Get activity events
      const recentActivity = await queryOrg(
        orgId,
        'SELECT id, type, title, description, timestamp, user_id as userId, user_name as userName FROM plan_activity_events WHERE plan_id = $1 ORDER BY timestamp DESC LIMIT 10',
        [planId]
      );

      // Get linked projects
      const projectsResult = await queryOrg(
        orgId,
        'SELECT project_id as projectId FROM plan_projects WHERE plan_id = $1',
        [planId]
      );
      const projectIds = projectsResult.map(p => p.projectId);

      // Combine response
      const response = {
        ...plan,
        objectives,
        budgetCategories,
        resourceAllocations,
        milestones,
        recentActivity,
        projectIds,
      };

      res.json(response);
    } catch (error) {
      console.error('Get plan error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // POST /api/plans - Create new plan
  // ============================================================================
  app.post(
    '/api/plans',
    authenticateUser,
    requireOrgMembership,
    validateRequest(createPlanSchema),
    async (req: any, res: any) => {
      try {
        const userEmail = (req as any).userEmail.toLowerCase();
        const orgId = (req as any).orgId;
        const data = req.body;

        const planId = crypto.randomBytes(16).toString('hex');
        const now = new Date().toISOString();

        // Insert plan
        await executeOrg(
          orgId,
          `INSERT INTO plans (id, name, description, status, start_date, end_date, total_budget, currency, spent_to_date, owner_email, owner_name, team_size, health_score, health_trend, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            planId,
            data.name,
            data.description || '',
            data.status || 'planning',
            data.startDate,
            data.endDate,
            data.totalBudget,
            data.currency || 'USD',
            data.spentToDate || 0,
            userEmail,
            data.ownerName || '',
            data.teamSize || 0,
            100,
            'stable',
            now,
            now,
          ]
        );

        // Insert objectives if provided
        if (data.objectives && data.objectives.length > 0) {
          for (const obj of data.objectives) {
            const objId = crypto.randomBytes(8).toString('hex');
            await executeOrg(
              orgId,
              `INSERT INTO plan_objectives (id, plan_id, text, target_value, current_value, unit, due_date, status, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                objId,
                planId,
                obj.text,
                obj.targetValue,
                obj.currentValue || 0,
                obj.unit,
                obj.dueDate || null,
                obj.status || 'on-track',
                now,
                now,
              ]
            );
          }
        }

        // Insert budget categories if provided
        if (data.budgetCategories && data.budgetCategories.length > 0) {
          for (const category of data.budgetCategories) {
            const catId = crypto.randomBytes(8).toString('hex');
            await executeOrg(
              orgId,
              `INSERT INTO plan_budget_categories (id, plan_id, name, allocated_amount, spent_amount, project_id, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                catId,
                planId,
                category.name,
                category.allocatedAmount,
                category.spentAmount || 0,
                category.projectId || null,
                now,
                now,
              ]
            );
          }
        }

        // Insert resource allocations if provided
        if (data.resourceAllocations && data.resourceAllocations.length > 0) {
          for (const allocation of data.resourceAllocations) {
            const allocId = crypto.randomBytes(8).toString('hex');
            await executeOrg(
              orgId,
              `INSERT INTO plan_resource_allocations (id, plan_id, user_email, user_name, allocation_percentage, start_date, end_date, role, hourly_rate, normalized_hours, project_id, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
              [
                allocId,
                planId,
                allocation.userEmail.toLowerCase(),
                allocation.userName || '',
                allocation.allocationPercentage,
                allocation.startDate,
                allocation.endDate,
                allocation.role || '',
                allocation.hourlyRate || null,
                allocation.normalizedHours || null,
                allocation.projectId || null,
                now,
                now,
              ]
            );
          }
        }

        // Insert milestones if provided
        if (data.milestones && data.milestones.length > 0) {
          for (const milestone of data.milestones) {
            const milestoneId = crypto.randomBytes(8).toString('hex');
            await executeOrg(
              orgId,
              `INSERT INTO plan_milestones (id, plan_id, name, due_date, status, description, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                milestoneId,
                planId,
                milestone.name,
                milestone.dueDate,
                milestone.status || 'pending',
                milestone.description || null,
                now,
                now,
              ]
            );
          }
        }

        // Link projects if provided
        if (data.projectIds && data.projectIds.length > 0) {
          for (const projectId of data.projectIds) {
            await executeOrg(
              orgId,
              `INSERT INTO plan_projects (plan_id, project_id, linked_at)
               VALUES ($1, $2, $3)
               ON CONFLICT (plan_id, project_id) DO NOTHING`,
              [planId, projectId, now]
            );
          }
        }

        // Add activity event
        const eventId = crypto.randomBytes(8).toString('hex');
        await executeOrg(
          orgId,
          `INSERT INTO plan_activity_events (id, plan_id, type, title, description, user_id, user_name, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [eventId, planId, 'project_update', 'Plan created', `Plan "${data.name}" has been created`, userEmail, data.ownerName || '', now]
        );

        res.status(201).json({
          id: planId,
          name: data.name,
          status: data.status || 'planning',
          ownerEmail: userEmail,
          createdAt: now,
        });
      } catch (error) {
        console.error('Create plan error:', error);
        res.status(500).json({ error: (error as Error).message });
      }
    }
  );

  // ============================================================================
  // PUT /api/plans/:id - Update plan
  // ============================================================================
  app.put(
    '/api/plans/:id',
    authenticateUser,
    requireOrgMembership,
    validateRequest(updatePlanSchema),
    async (req: any, res: any) => {
      try {
        const orgId = req.orgId;
        const planId = req.params.id;
        const data = req.body;
        const userEmail = req.userEmail.toLowerCase();

        // Check if plan exists
        const planResult = await queryOrg(
          orgId,
          'SELECT * FROM plans WHERE id = $1',
          [planId]
        );

        if (planResult.length === 0) {
          return res.status(404).json({ error: 'Plan not found' });
        }

        const now = new Date().toISOString();

        // Update plan
        const updates = [];
        const values = [planId];
        let paramIndex = 2;

        if (data.name !== undefined) {
          updates.push(`name = $${paramIndex}`);
          values.push(data.name);
          paramIndex++;
        }
        if (data.description !== undefined) {
          updates.push(`description = $${paramIndex}`);
          values.push(data.description);
          paramIndex++;
        }
        if (data.status !== undefined) {
          updates.push(`status = $${paramIndex}`);
          values.push(data.status);
          paramIndex++;
        }
        if (data.startDate !== undefined) {
          updates.push(`start_date = $${paramIndex}`);
          values.push(data.startDate);
          paramIndex++;
        }
        if (data.endDate !== undefined) {
          updates.push(`end_date = $${paramIndex}`);
          values.push(data.endDate);
          paramIndex++;
        }
        if (data.totalBudget !== undefined) {
          updates.push(`total_budget = $${paramIndex}`);
          values.push(data.totalBudget);
          paramIndex++;
        }
        if (data.spentToDate !== undefined) {
          updates.push(`spent_to_date = $${paramIndex}`);
          values.push(data.spentToDate);
          paramIndex++;
        }
        if (data.healthScore !== undefined) {
          updates.push(`health_score = $${paramIndex}`);
          values.push(data.healthScore);
          paramIndex++;
        }
        if (data.healthTrend !== undefined) {
          updates.push(`health_trend = $${paramIndex}`);
          values.push(data.healthTrend);
          paramIndex++;
        }

        updates.push(`updated_at = NOW()`);

        if (updates.length > 0) {
          await executeOrg(
            orgId,
            `UPDATE plans SET ${updates.join(', ')} WHERE id = $1`,
            values
          );
        }

        res.json({ success: true, planId });
      } catch (error) {
        console.error('Update plan error:', error);
        res.status(500).json({ error: (error as Error).message });
      }
    }
  );

  // ============================================================================
  // DELETE /api/plans/:id - Delete plan
  // ============================================================================
  app.delete('/api/plans/:id', authenticateUser, requireOrgMembership, async (req: any, res: any) => {
    try {
      const orgId = req.orgId;
      const planId = req.params.id;

      // Check if plan exists
      const planResult = await queryOrg(
        orgId,
        'SELECT * FROM plans WHERE id = $1',
        [planId]
      );

      if (planResult.length === 0) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      // Delete plan (cascades to related tables)
      await executeOrg(
        orgId,
        'DELETE FROM plans WHERE id = $1',
        [planId]
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Delete plan error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // OBJECTIVES ENDPOINTS
  // ============================================================================

  // POST /api/plans/:id/objectives
  app.post(
    '/api/plans/:id/objectives',
    authenticateUser,
    requireOrgMembership,
    validateRequest(createObjectiveSchema),
    async (req: any, res: any) => {
      try {
        const orgId = req.orgId;
        const planId = req.params.id;
        const data = req.body;

        const objId = crypto.randomBytes(8).toString('hex');
        const now = new Date().toISOString();

        await executeOrg(
          orgId,
          `INSERT INTO plan_objectives (id, plan_id, text, target_value, current_value, unit, due_date, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            objId,
            planId,
            data.text,
            data.targetValue,
            data.currentValue || 0,
            data.unit,
            data.dueDate || null,
            data.status || 'on-track',
            now,
            now,
          ]
        );

        res.status(201).json({ id: objId });
      } catch (error) {
        console.error('Create objective error:', error);
        res.status(500).json({ error: (error as Error).message });
      }
    }
  );

  // PUT /api/plans/:id/objectives/:objId
  app.put(
    '/api/plans/:id/objectives/:objId',
    authenticateUser,
    requireOrgMembership,
    validateRequest(updateObjectiveSchema),
    async (req: any, res: any) => {
      try {
        const orgId = req.orgId;
        const objId = req.params.objId;
        const data = req.body;

        const updates = [];
        const values = [objId];
        let paramIndex = 2;

        if (data.text !== undefined) {
          updates.push(`text = $${paramIndex}`);
          values.push(data.text);
          paramIndex++;
        }
        if (data.targetValue !== undefined) {
          updates.push(`target_value = $${paramIndex}`);
          values.push(data.targetValue);
          paramIndex++;
        }
        if (data.currentValue !== undefined) {
          updates.push(`current_value = $${paramIndex}`);
          values.push(data.currentValue);
          paramIndex++;
        }
        if (data.status !== undefined) {
          updates.push(`status = $${paramIndex}`);
          values.push(data.status);
          paramIndex++;
        }

        updates.push(`updated_at = NOW()`);

        if (updates.length > 0) {
          await executeOrg(
            orgId,
            `UPDATE plan_objectives SET ${updates.join(', ')} WHERE id = $1`,
            values
          );
        }

        res.json({ success: true });
      } catch (error) {
        console.error('Update objective error:', error);
        res.status(500).json({ error: (error as Error).message });
      }
    }
  );

  // DELETE /api/plans/:id/objectives/:objId
  app.delete('/api/plans/:id/objectives/:objId', authenticateUser, requireOrgMembership, async (req: any, res: any) => {
    try {
      const orgId = req.orgId;
      const objId = req.params.objId;

      await executeOrg(
        orgId,
        'DELETE FROM plan_objectives WHERE id = $1',
        [objId]
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Delete objective error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // BUDGET CATEGORIES ENDPOINTS
  // ============================================================================

  // POST /api/plans/:id/budget-categories
  app.post(
    '/api/plans/:id/budget-categories',
    authenticateUser,
    requireOrgMembership,
    validateRequest(createBudgetCategorySchema),
    async (req: any, res: any) => {
      try {
        const orgId = req.orgId;
        const planId = req.params.id;
        const data = req.body;

        const catId = crypto.randomBytes(8).toString('hex');
        const now = new Date().toISOString();

        await executeOrg(
          orgId,
          `INSERT INTO plan_budget_categories (id, plan_id, name, allocated_amount, spent_amount, project_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            catId,
            planId,
            data.name,
            data.allocatedAmount,
            data.spentAmount || 0,
            data.projectId || null,
            now,
            now,
          ]
        );

        res.status(201).json({ id: catId });
      } catch (error) {
        console.error('Create budget category error:', error);
        res.status(500).json({ error: (error as Error).message });
      }
    }
  );

  // PUT /api/plans/:id/budget-categories/:catId
  app.put(
    '/api/plans/:id/budget-categories/:catId',
    authenticateUser,
    requireOrgMembership,
    validateRequest(updateBudgetCategorySchema),
    async (req: any, res: any) => {
      try {
        const orgId = req.orgId;
        const catId = req.params.catId;
        const data = req.body;

        const updates = [];
        const values = [catId];
        let paramIndex = 2;

        if (data.name !== undefined) {
          updates.push(`name = $${paramIndex}`);
          values.push(data.name);
          paramIndex++;
        }
        if (data.allocatedAmount !== undefined) {
          updates.push(`allocated_amount = $${paramIndex}`);
          values.push(data.allocatedAmount);
          paramIndex++;
        }
        if (data.spentAmount !== undefined) {
          updates.push(`spent_amount = $${paramIndex}`);
          values.push(data.spentAmount);
          paramIndex++;
        }

        updates.push(`updated_at = NOW()`);

        if (updates.length > 0) {
          await executeOrg(
            orgId,
            `UPDATE plan_budget_categories SET ${updates.join(', ')} WHERE id = $1`,
            values
          );
        }

        res.json({ success: true });
      } catch (error) {
        console.error('Update budget category error:', error);
        res.status(500).json({ error: (error as Error).message });
      }
    }
  );

  // DELETE /api/plans/:id/budget-categories/:catId
  app.delete('/api/plans/:id/budget-categories/:catId', authenticateUser, requireOrgMembership, async (req: any, res: any) => {
    try {
      const orgId = req.orgId;
      const catId = req.params.catId;

      await executeOrg(
        orgId,
        'DELETE FROM plan_budget_categories WHERE id = $1',
        [catId]
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Delete budget category error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // RESOURCE ALLOCATIONS ENDPOINTS
  // ============================================================================

  // POST /api/plans/:id/resource-allocations
  app.post(
    '/api/plans/:id/resource-allocations',
    authenticateUser,
    requireOrgMembership,
    validateRequest(createResourceAllocationSchema),
    async (req: any, res: any) => {
      try {
        const orgId = req.orgId;
        const planId = req.params.id;
        const data = req.body;

        const allocId = crypto.randomBytes(8).toString('hex');
        const now = new Date().toISOString();

        await executeOrg(
          orgId,
          `INSERT INTO plan_resource_allocations (id, plan_id, user_email, user_name, allocation_percentage, start_date, end_date, role, hourly_rate, normalized_hours, project_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            allocId,
            planId,
            data.userEmail.toLowerCase(),
            data.userName || '',
            data.allocationPercentage,
            data.startDate,
            data.endDate,
            data.role || '',
            data.hourlyRate || null,
            data.normalizedHours || null,
            data.projectId || null,
            now,
            now,
          ]
        );

        res.status(201).json({ id: allocId });
      } catch (error) {
        console.error('Create resource allocation error:', error);
        res.status(500).json({ error: (error as Error).message });
      }
    }
  );

  // PUT /api/plans/:id/resource-allocations/:allocId
  app.put(
    '/api/plans/:id/resource-allocations/:allocId',
    authenticateUser,
    requireOrgMembership,
    validateRequest(updateResourceAllocationSchema),
    async (req: any, res: any) => {
      try {
        const orgId = req.orgId;
        const allocId = req.params.allocId;
        const data = req.body;

        const updates = [];
        const values = [allocId];
        let paramIndex = 2;

        if (data.allocationPercentage !== undefined) {
          updates.push(`allocation_percentage = $${paramIndex}`);
          values.push(data.allocationPercentage);
          paramIndex++;
        }
        if (data.role !== undefined) {
          updates.push(`role = $${paramIndex}`);
          values.push(data.role);
          paramIndex++;
        }
        if (data.hourlyRate !== undefined) {
          updates.push(`hourly_rate = $${paramIndex}`);
          values.push(data.hourlyRate);
          paramIndex++;
        }

        updates.push(`updated_at = NOW()`);

        if (updates.length > 0) {
          await executeOrg(
            orgId,
            `UPDATE plan_resource_allocations SET ${updates.join(', ')} WHERE id = $1`,
            values
          );
        }

        res.json({ success: true });
      } catch (error) {
        console.error('Update resource allocation error:', error);
        res.status(500).json({ error: (error as Error).message });
      }
    }
  );

  // DELETE /api/plans/:id/resource-allocations/:allocId
  app.delete('/api/plans/:id/resource-allocations/:allocId', authenticateUser, requireOrgMembership, async (req: any, res: any) => {
    try {
      const orgId = req.orgId;
      const allocId = req.params.allocId;

      await executeOrg(
        orgId,
        'DELETE FROM plan_resource_allocations WHERE id = $1',
        [allocId]
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Delete resource allocation error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // MILESTONES ENDPOINTS
  // ============================================================================

  // POST /api/plans/:id/milestones
  app.post(
    '/api/plans/:id/milestones',
    authenticateUser,
    requireOrgMembership,
    validateRequest(createMilestoneSchema),
    async (req: any, res: any) => {
      try {
        const orgId = req.orgId;
        const planId = req.params.id;
        const data = req.body;

        const milestoneId = crypto.randomBytes(8).toString('hex');
        const now = new Date().toISOString();

        await executeOrg(
          orgId,
          `INSERT INTO plan_milestones (id, plan_id, name, due_date, status, description, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            milestoneId,
            planId,
            data.name,
            data.dueDate,
            data.status || 'pending',
            data.description || null,
            now,
            now,
          ]
        );

        res.status(201).json({ id: milestoneId });
      } catch (error) {
        console.error('Create milestone error:', error);
        res.status(500).json({ error: (error as Error).message });
      }
    }
  );

  // PUT /api/plans/:id/milestones/:milestoneId
  app.put(
    '/api/plans/:id/milestones/:milestoneId',
    authenticateUser,
    requireOrgMembership,
    validateRequest(updateMilestoneSchema),
    async (req: any, res: any) => {
      try {
        const orgId = req.orgId;
        const milestoneId = req.params.milestoneId;
        const data = req.body;

        const updates = [];
        const values = [milestoneId];
        let paramIndex = 2;

        if (data.name !== undefined) {
          updates.push(`name = $${paramIndex}`);
          values.push(data.name);
          paramIndex++;
        }
        if (data.dueDate !== undefined) {
          updates.push(`due_date = $${paramIndex}`);
          values.push(data.dueDate);
          paramIndex++;
        }
        if (data.status !== undefined) {
          updates.push(`status = $${paramIndex}`);
          values.push(data.status);
          paramIndex++;
        }

        updates.push(`updated_at = NOW()`);

        if (updates.length > 0) {
          await executeOrg(
            orgId,
            `UPDATE plan_milestones SET ${updates.join(', ')} WHERE id = $1`,
            values
          );
        }

        res.json({ success: true });
      } catch (error) {
        console.error('Update milestone error:', error);
        res.status(500).json({ error: (error as Error).message });
      }
    }
  );

  // DELETE /api/plans/:id/milestones/:milestoneId
  app.delete('/api/plans/:id/milestones/:milestoneId', authenticateUser, requireOrgMembership, async (req: any, res: any) => {
    try {
      const orgId = req.orgId;
      const milestoneId = req.params.milestoneId;

      await executeOrg(
        orgId,
        'DELETE FROM plan_milestones WHERE id = $1',
        [milestoneId]
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Delete milestone error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // PROJECT LINKING ENDPOINTS
  // ============================================================================

  // POST /api/plans/:id/projects
  app.post(
    '/api/plans/:id/projects',
    authenticateUser,
    requireOrgMembership,
    validateRequest(linkProjectSchema),
    async (req: any, res: any) => {
      try {
        const orgId = req.orgId;
        const planId = req.params.id;
        const { projectId } = req.body;
        const now = new Date().toISOString();

        await executeOrg(
          orgId,
          `INSERT INTO plan_projects (plan_id, project_id, linked_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (plan_id, project_id) DO NOTHING`,
          [planId, projectId, now]
        );

        res.status(201).json({ success: true });
      } catch (error) {
        console.error('Link project error:', error);
        res.status(500).json({ error: (error as Error).message });
      }
    }
  );

  // DELETE /api/plans/:id/projects/:projectId
  app.delete('/api/plans/:id/projects/:projectId', authenticateUser, requireOrgMembership, async (req: any, res: any) => {
    try {
      const orgId = req.orgId;
      const planId = req.params.id;
      const projectId = req.params.projectId;

      await executeOrg(
        orgId,
        'DELETE FROM plan_projects WHERE plan_id = $1 AND project_id = $2',
        [planId, projectId]
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Unlink project error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // ACTIVITY FEED ENDPOINT
  // ============================================================================

  // GET /api/plans/:id/activity
  app.get('/api/plans/:id/activity', authenticateUser, requireOrgMembership, async (req: any, res: any) => {
    try {
      const orgId = req.orgId;
      const planId = req.params.id;
      const limit = parseInt(req.query.limit as string) || 20;

      const activity = await queryOrg(
        orgId,
        'SELECT id, type, title, description, timestamp, user_id as userId, user_name as userName FROM plan_activity_events WHERE plan_id = $1 ORDER BY timestamp DESC LIMIT $2',
        [planId, limit]
      );

      res.json(activity);
    } catch (error) {
      console.error('Get activity error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });
};
