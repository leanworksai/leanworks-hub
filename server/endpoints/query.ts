import express from 'express';
import { queryService } from '../services/query-service.js';
import { validateRequest } from '../middleware/validate-request.js';
import { executeQuerySchema, getSchemaSchema, getTablesSchema } from '../validation/query-schemas.js';

// ============================================================================
// QUERY ENDPOINTS
// ============================================================================

/**
 * Setup query API endpoints
 */
export function setupQueryEndpoints(
  app: express.Express,
  authenticateUser: any,
  requireOrgMembership: any
) {
  // ============================================================================
  // POST /api/query/execute - Execute SQL query
  // ============================================================================

  app.post('/api/query/execute',
    authenticateUser,
    requireOrgMembership,
    validateRequest(executeQuerySchema),
    async (req: express.Request, res: express.Response) => {
      try {
        const { sql, params = [], options = {} } = req.body;
        const orgId = (req as any).orgId;
        const userEmail = (req as any).userEmail;

        // Execute query
        const result = await queryService.executeQuery(orgId, sql, params, options, userEmail);

        // Return result
        res.json(result);

      } catch (error: any) {
        console.error('Query execution error:', error);

        // Return error response
        res.status(500).json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An internal error occurred while processing the query',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
          }
        });
      }
    }
  );

  // ============================================================================
  // GET /api/query/schema - Get schema information
  // ============================================================================

  app.get('/api/query/schema',
    authenticateUser,
    requireOrgMembership,
    async (req: express.Request, res: express.Response) => {
      try {
        const orgId = (req as any).orgId;

        // Validate query parameters
        const validationResult = getSchemaSchema.safeParse(req.query);
        if (!validationResult.success) {
          return res.status(400).json({
            error: 'Validation failed',
            details: validationResult.error.errors
          });
        }

        const { table: tableParam } = validationResult.data;

        let schemaInfo;

        if (tableParam) {
          // Get schema for specific table(s) - handles both single string and array
          // For specific tables, return only column details without descriptions
          schemaInfo = await queryService.getTableSchemas(orgId, tableParam);
        } else {
          // When no table specified, redirect to /api/query/tables for discovery
          // This provides table names and descriptions
          return res.json({
            success: true,
            data: {
              tables: queryService.getAllowedTables(),
              note: 'For table descriptions, use GET /api/query/tables. For detailed column schema, use ?table=<table_name> or ?table[]=table1&table[]=table2'
            }
          });
        }

        res.json({
          success: true,
          data: schemaInfo
        });

      } catch (error: any) {
        console.error('Schema retrieval error:', error);

        res.status(500).json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An internal error occurred while retrieving schema information',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
          }
        });
      }
    }
  );

  // ============================================================================
  // GET /api/query/tables - List allowed tables
  // ============================================================================

  app.get('/api/query/tables',
    authenticateUser,
    requireOrgMembership,
    async (req: express.Request, res: express.Response) => {
      try {
        // Validate query parameters
        const validationResult = getTablesSchema.safeParse(req.query);
        if (!validationResult.success) {
          return res.status(400).json({
            error: 'Validation failed',
            details: validationResult.error.errors
          });
        }

        const allowedTables = queryService.getAllowedTables();

        // Add descriptions for each table
        const tableDescriptions: Record<string, string> = {
          users: 'Organization user profiles and roles',
          tasks: 'Task management data including status, priority, and assignments',
          projects: 'Project information and metadata',
          task_progress_updates: 'Task update history and progress notes',
          task_comments: 'Comments and discussions on tasks',
          project_progress_updates: 'Project update summaries',
          project_members: 'Project membership and roles',
          project_comments: 'Comments and discussions on projects',
          events: 'Calendar events and meetings'
        };

        const tables = allowedTables.map(table => ({
          name: table,
          description: tableDescriptions[table] || 'No description available'
        }));

        res.json({
          success: true,
          data: {
            tables,
            total: tables.length,
            note: 'These are the tables you can query using the /api/query/execute endpoint'
          }
        });

      } catch (error: any) {
        console.error('Tables retrieval error:', error);

        res.status(500).json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An internal error occurred while retrieving table information',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
          }
        });
      }
    }
  );
}