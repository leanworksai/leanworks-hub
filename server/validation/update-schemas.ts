import { z } from 'zod';

/**
 * Schema for querying task progress updates
 */
export const queryTaskProgressUpdatesSchema = z.object({
  userId: z.string().email().optional(),
  projectId: z.string().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

/**
 * Schema for querying project progress updates
 */
export const queryProjectProgressUpdatesSchema = z.object({
  projectId: z.string().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export type QueryTaskProgressUpdatesInput = z.infer<typeof queryTaskProgressUpdatesSchema>;
export type QueryProjectProgressUpdatesInput = z.infer<typeof queryProjectProgressUpdatesSchema>;
