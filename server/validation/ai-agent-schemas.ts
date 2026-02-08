import { z } from 'zod';

// ============================================================================
// ENUM DEFINITIONS
// ============================================================================

const agentTypeEnum = z.enum(['webhook', 'api', 'mcp_server'], {
  errorMap: () => ({ message: 'Agent type must be one of: webhook, api, mcp_server' }),
});

const agentStatusEnum = z.enum(['active', 'inactive', 'error'], {
  errorMap: () => ({ message: 'Status must be one of: active, inactive, error' }),
});

const assignmentStatusEnum = z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled'], {
  errorMap: () => ({ message: 'Assignment status must be one of: pending, in_progress, completed, failed, cancelled' }),
});

const activityTypeEnum = z.enum(['assigned', 'started', 'progress_update', 'completed', 'failed', 'comment'], {
  errorMap: () => ({ message: 'Activity type must be one of: assigned, started, progress_update, completed, failed, comment' }),
});

// Email validation
const emailSchema = z.string().email('Invalid email format').toLowerCase();

// ============================================================================
// AI AGENT SCHEMAS
// ============================================================================

// Webhook config schema
const webhookConfigSchema = z.object({
  webhookUrl: z.string().url('Invalid webhook URL'),
  method: z.string().default('POST'),
  headers: z.record(z.string()).optional().default({}),
  callbackUrl: z.string().url('Invalid callback URL'),
  timeout: z.number().positive().default(300000),
  retries: z.number().min(0).default(3),
});

// API config schema
const apiConfigSchema = z.object({
  baseUrl: z.string().url('Invalid base URL'),
  endpoints: z.object({
    submit: z.string(),
    status: z.string().optional(),
    result: z.string().optional(),
  }),
  pollInterval: z.number().positive().default(30000),
  timeout: z.number().positive().default(600000),
  headers: z.record(z.string()).optional().default({}),
});

// MCP config schema
const mcpConfigSchema = z.object({
  serverUrl: z.string().url('Invalid server URL'),
  protocol: z.enum(['sse', 'stdio']).default('sse'),
  capabilities: z.array(z.string()).default([]),
});

// Config schema - discriminated union
const configSchema = z.union([
  webhookConfigSchema.extend({ type: z.literal('webhook') }).optional(),
  apiConfigSchema.extend({ type: z.literal('api') }).optional(),
  mcpConfigSchema.extend({ type: z.literal('mcp_server') }).optional(),
]);

// Auth config schema
const authConfigSchema = z.object({
  secretName: z.string().optional(),
  tokenType: z.enum(['bearer', 'api_key', 'custom']).optional(),
  customHeaders: z.record(z.string()).optional(),
});

// Base AI Agent schema
const baseAgentSchema = z.object({
  name: z
    .string()
    .min(1, 'Agent name is required')
    .max(255, 'Agent name must be 255 characters or less'),
  description: z
    .string()
    .max(5000, 'Description must be 5000 characters or less')
    .optional()
    .nullish(),
  agentType: agentTypeEnum,
  config: z.record(z.any()).default({}),
  authConfig: authConfigSchema.optional().default({}),
  capabilities: z
    .array(z.string().max(100, 'Each capability must be 100 characters or less'))
    .max(50, 'Maximum 50 capabilities allowed')
    .default([]),
  avatar: z.string().max(10, 'Avatar must be 10 characters or less').optional(),
});

// Create agent schema
export const createAgentSchema = baseAgentSchema.extend({
  name: z
    .string()
    .min(1, 'Agent name is required')
    .max(255, 'Agent name must be 255 characters or less'),
});

// Update agent schema
export const updateAgentSchema = baseAgentSchema.partial();

// ============================================================================
// AI AGENT TEAM SCHEMAS
// ============================================================================

// Base team schema
const baseTeamSchema = z.object({
  name: z
    .string()
    .min(1, 'Team name is required')
    .max(255, 'Team name must be 255 characters or less'),
  description: z
    .string()
    .max(5000, 'Description must be 5000 characters or less')
    .optional()
    .nullish(),
  teamId: z.string().max(50, 'Team ID must be 50 characters or less').optional().nullable(),
  projectId: z.string().max(50, 'Project ID must be 50 characters or less').optional().nullable(),
  avatar: z.string().max(10, 'Avatar must be 10 characters or less').optional(),
});

// Create team schema
export const createAgentTeamSchema = baseTeamSchema.extend({
  name: z
    .string()
    .min(1, 'Team name is required')
    .max(255, 'Team name must be 255 characters or less'),
});

// Update team schema
export const updateAgentTeamSchema = baseTeamSchema.partial();

// Add agent to team schema
export const addAgentToTeamSchema = z.object({
  agentId: z.string().max(50, 'Agent ID must be 50 characters or less'),
  role: z.string().max(100, 'Role must be 100 characters or less').optional(),
  priority: z.number().int().min(0).default(0),
});

// ============================================================================
// TASK AI ASSIGNMENT SCHEMAS
// ============================================================================

// Agent callback schema - for webhook callbacks
export const agentCallbackSchema = z.object({
  status: assignmentStatusEnum,
  message: z.string().max(5000, 'Message must be 5000 characters or less'),
  result: z.record(z.any()).optional(),
  logs: z
    .array(z.string())
    .max(1000, 'Maximum 1000 log entries allowed')
    .optional()
    .default([]),
  metadata: z.record(z.any()).optional().default({}),
});

// Agent activity schema - for activity posts
export const agentActivitySchema = z.object({
  assignmentId: z.string().max(50, 'Assignment ID must be 50 characters or less'),
  taskId: z.string().max(50, 'Task ID must be 50 characters or less').optional(),
  activityType: activityTypeEnum,
  title: z
    .string()
    .min(1, 'Title is required')
    .max(255, 'Title must be 255 characters or less'),
  description: z
    .string()
    .max(5000, 'Description must be 5000 characters or less')
    .optional(),
  metadata: z.record(z.any()).optional().default({}),
});

// Assignment creation schema (when assigning task to agent)
export const createAssignmentSchema = z.object({
  taskId: z.string().max(50, 'Task ID must be 50 characters or less'),
  agentId: z.string().max(50, 'Agent ID must be 50 characters or less').optional(),
  agentTeamId: z.string().max(50, 'Agent Team ID must be 50 characters or less').optional(),
}).refine(
  (data) => data.agentId || data.agentTeamId,
  { message: 'Either agentId or agentTeamId must be provided' }
).refine(
  (data) => !(data.agentId && data.agentTeamId),
  { message: 'Cannot assign to both agent and team' }
);

// ============================================================================
// EXPORT TYPES
// ============================================================================

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type CreateAgentTeamInput = z.infer<typeof createAgentTeamSchema>;
export type UpdateAgentTeamInput = z.infer<typeof updateAgentTeamSchema>;
export type AddAgentToTeamInput = z.infer<typeof addAgentToTeamSchema>;
export type AgentCallbackInput = z.infer<typeof agentCallbackSchema>;
export type AgentActivityInput = z.infer<typeof agentActivitySchema>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
