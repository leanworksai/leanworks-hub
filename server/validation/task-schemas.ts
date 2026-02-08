import { z } from 'zod';

// Enum definitions matching database constraints
const taskStatusEnum = z.enum(['todo', 'in-progress', 'review', 'completed', 'blocked'], {
  errorMap: () => ({ message: 'Status must be one of: todo, in-progress, review, completed, blocked' }),
});

const taskPriorityEnum = z.enum(['low', 'medium', 'high', 'urgent'], {
  errorMap: () => ({ message: 'Priority must be one of: low, medium, high, urgent' }),
});

const visibilityEnum = z.enum(['all_members', 'specific_members'], {
  errorMap: () => ({ message: 'Visibility must be one of: all_members, specific_members' }),
});

const assigneeTypeEnum = z.enum(['human', 'ai_agent', 'ai_team'], {
  errorMap: () => ({ message: 'Assignee type must be one of: human, ai_agent, ai_team' }),
});

// Email validation
const emailSchema = z.string().email('Invalid email format').toLowerCase();

// Date string validation (YYYY-MM-DD format)
const dateStringSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  'Date must be in YYYY-MM-DD format'
);

// Base task schema with common fields
const baseTaskSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(255, 'Title must be 255 characters or less'),
  description: z
    .string()
    .max(5000, 'Description must be 5000 characters or less')
    .optional()
    .nullish(),
  status: taskStatusEnum.optional().default('todo'),
  priority: taskPriorityEnum.optional().default('medium'),
  assigneeId: emailSchema.optional().nullish(),
  assignee: z.string().max(255, 'Assignee name must be 255 characters or less').optional().nullish(),
  assigneeAvatar: z.string().max(10, 'Assignee avatar must be 10 characters or less').optional().nullish(),
  projectId: z.string().max(50, 'Project ID must be 50 characters or less').optional().nullish(),
  projectName: z.string().max(255, 'Project name must be 255 characters or less').optional().nullish(),
  dueDate: dateStringSchema.optional().nullish(),
  createdDate: dateStringSchema.optional().nullish(),
  estimatedHours: z
    .number()
    .positive('Estimated hours must be a positive number')
    .max(9999.99, 'Estimated hours cannot exceed 9999.99')
    .optional(),
  actualHours: z
    .number()
    .positive('Actual hours must be a positive number')
    .max(9999.99, 'Actual hours cannot exceed 9999.99')
    .optional(),
  tags: z
    .array(z.string().max(100, 'Each tag must be 100 characters or less'))
    .max(50, 'Maximum 50 tags allowed')
    .optional()
    .default([]),
  reason: z
    .string()
    .max(5000, 'Reason must be 5000 characters or less')
    .optional()
    .nullish(),
  visibility: visibilityEnum.optional().default('all_members'),
  visibleToMembers: z
    .array(emailSchema)
    .optional()
    .default([]),
});

// Task creation schema - requires title and createdDate
export const createTaskSchema = baseTaskSchema
  .extend({
    title: z
      .string()
      .min(1, 'Title is required')
      .max(255, 'Title must be 255 characters or less'),
    createdDate: dateStringSchema.optional(), // Optional in creation, will default to today if not provided
  })
  .refine(
    (data) => {
      // If visibility is 'specific_members', visibleToMembers must be provided and non-empty
      if (data.visibility === 'specific_members') {
        return (
          data.visibleToMembers !== undefined &&
          Array.isArray(data.visibleToMembers) &&
          data.visibleToMembers.length > 0
        );
      }
      return true;
    },
    {
      message: 'visibleToMembers must be a non-empty array when visibility is specific_members',
      path: ['visibleToMembers'],
    }
  );

// Task partial update schema - all fields optional
export const updateTaskSchema = baseTaskSchema
  .extend({
    assigneeType: assigneeTypeEnum.optional(),
    agentId: z.string().max(50, 'Agent ID must be 50 characters or less').optional().nullish(),
    agentTeamId: z.string().max(50, 'Agent team ID must be 50 characters or less').optional().nullish(),
    agentIds: z
      .array(z.string().max(50, 'Agent ID must be 50 characters or less'))
      .max(50, 'Maximum 50 agents allowed')
      .optional(),
  })
  .partial()
  .refine(
    (data) => {
      // If visibility is being set to 'specific_members', visibleToMembers must be provided
      if (data.visibility === 'specific_members') {
        return (
          data.visibleToMembers !== undefined &&
          Array.isArray(data.visibleToMembers) &&
          data.visibleToMembers.length > 0
        );
      }
      return true;
    },
    {
      message: 'visibleToMembers must be a non-empty array when visibility is specific_members',
      path: ['visibleToMembers'],
    }
  );

// Task full update schema - requires all editable fields (for PUT endpoint)
export const fullUpdateTaskSchema = baseTaskSchema.extend({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(255, 'Title must be 255 characters or less'),
  assigneeType: assigneeTypeEnum.optional(),
  agentId: z.string().max(50, 'Agent ID must be 50 characters or less').optional().nullish(),
  agentTeamId: z.string().max(50, 'Agent team ID must be 50 characters or less').optional().nullish(),
  agentIds: z
    .array(z.string().max(50, 'Agent ID must be 50 characters or less'))
    .max(50, 'Maximum 50 agents allowed')
    .optional(),
});

// Export types for use in the codebase
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type FullUpdateTaskInput = z.infer<typeof fullUpdateTaskSchema>;
