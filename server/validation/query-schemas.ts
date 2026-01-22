import { z } from 'zod';

// ============================================================================
// QUERY EXECUTION SCHEMA
// ============================================================================

export const executeQuerySchema = z.object({
  sql: z.string()
    .min(1, 'SQL query is required')
    .max(10000, 'SQL query too long (max 10000 characters)')
    .refine((sql) => {
      // Basic validation - more thorough validation happens in the service
      const trimmed = sql.trim().toLowerCase();
      return trimmed.startsWith('select') || trimmed.startsWith('with');
    }, 'Only SELECT and WITH (CTE) queries are allowed'),
  params: z.array(z.any()).optional().default([]),
  options: z.object({
    timeout: z.number()
      .min(1000, 'Timeout must be at least 1000ms')
      .max(60000, 'Timeout cannot exceed 60000ms')
      .optional()
      .default(30000),
    maxRows: z.number()
      .min(1, 'maxRows must be at least 1')
      .max(10000, 'maxRows cannot exceed 10000')
      .optional()
      .default(1000),
    includeMetadata: z.boolean().optional().default(true)
  }).optional().default({})
});

// ============================================================================
// SCHEMA QUERY SCHEMAS
// ============================================================================

export const getSchemaSchema = z.object({
  query: z.object({
    table: z.string()
      .min(1, 'Table name is required')
      .max(100, 'Table name too long')
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid table name format')
      .optional(),
    includeComments: z.string().optional()
  }).optional()
});

export const getTablesSchema = z.object({
  query: z.object({
    includeSchema: z.string().optional()
  }).optional()
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type ExecuteQueryRequest = z.infer<typeof executeQuerySchema>;
export type GetSchemaRequest = z.infer<typeof getSchemaSchema>;
export type GetTablesRequest = z.infer<typeof getTablesSchema>;