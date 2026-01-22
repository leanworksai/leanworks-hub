import express from 'express';
// TODO: Install express-rate-limit package: npm install express-rate-limit
// import rateLimit from 'express-rate-limit';
import { queryService } from '../services/query-service.js';
import { validateRequest } from '../middleware/validate-request.js';
import { executeQuerySchema, getSchemaSchema, getTablesSchema } from '../validation/query-schemas.js';

// ============================================================================
// RATE LIMITING (TODO: Install express-rate-limit)
// ============================================================================

// Rate limiter for query execution (stricter limits)
// const queryExecuteLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 100, // 100 requests per window
//   keyGenerator: (req: express.Request) => {
//     const user = (req as any).user;
//     const orgId = req.headers['x-org-id'] as string;
//     return `${user?.email || 'unknown'}:${orgId || 'unknown'}`;
//   },
//   message: {
//     success: false,
//     error: {
//       code: 'RATE_LIMIT_EXCEEDED',
//       message: 'Too many query requests. Please try again later.',
//       details: { retryAfter: '15 minutes' }
//     }
//   },
//   standardHeaders: true,
//   legacyHeaders: false,
// });

// Rate limiter for schema/metadata endpoints (more lenient)
// const querySchemaLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 20, // 20 requests per window
//   keyGenerator: (req: express.Request) => {
//     const user = (req as any).user;
//     const orgId = req.headers['x-org-id'] as string;
//     return `${user?.email || 'unknown'}:${orgId || 'unknown'}`;
//   },
//   message: {
//     success: false,
//     error: {
//       code: 'RATE_LIMIT_EXCEEDED',
//       message: 'Too many schema requests. Please try again later.',
//       details: { retryAfter: '15 minutes' }
//     }
//   },
//   standardHeaders: true,
//   legacyHeaders: false,
// });

// Temporary rate limiting middleware (basic implementation)
const queryExecuteLimiter = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // TODO: Replace with express-rate-limit once installed
  // For now, allow all requests (implement proper rate limiting after package installation)
  next();
};

const querySchemaLimiter = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // TODO: Replace with express-rate-limit once installed
  // For now, allow all requests (implement proper rate limiting after package installation)
  next();
};

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
    queryExecuteLimiter,
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
    querySchemaLimiter,
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

        const { query } = validationResult.data;
        const tableName = query?.table;

        let schemaInfo;

        if (tableName) {
          // Get schema for specific table
          schemaInfo = await queryService.getTableSchema(orgId, tableName);
        } else {
          // Get schema for all allowed tables
          const allowedTables = queryService.getAllowedTables();
          schemaInfo = {
            tables: allowedTables,
            note: 'Use ?table=<table_name> to get detailed schema for a specific table'
          };
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
    querySchemaLimiter,
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