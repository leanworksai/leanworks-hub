import { z } from 'zod';

// Email validation
const emailSchema = z.string().email('Invalid email format').toLowerCase();

// Visibility enum
const visibilityEnum = z.enum(['all_members', 'specific_members'], {
  errorMap: () => ({ message: 'Visibility must be one of: all_members, specific_members' }),
});

// Project member schema
const projectMemberSchema = z.object({
  email: emailSchema,
  role: z.string().max(100, 'Role must be 100 characters or less').optional(),
  avatar: z.string().max(10, 'Avatar must be 10 characters or less').optional(),
});

// Base project schema (without refine, so we can use .omit())
const baseProjectSchema = z.object({
  id: z.string().max(50, 'Project ID must be 50 characters or less').optional(),
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(255, 'Project name must be 255 characters or less'),
  description: z
    .string()
    .max(5000, 'Description must be 5000 characters or less')
    .optional(),
  teamId: z.string().max(50, 'Team ID must be 50 characters or less').optional().nullable(),
  status: z.string().max(50, 'Status must be 50 characters or less').optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent'], {
    errorMap: () => ({ message: 'Priority must be one of: low, medium, high, urgent' }),
  }).optional(),
  dueDate: z.union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be in YYYY-MM-DD format'),
    z.string().length(0), // Allow empty string
    z.null()
  ]).optional(),
  visibility: visibilityEnum.optional().default('all_members'),
  visibleToMembers: z.array(emailSchema).optional().default([]),
  members: z.array(projectMemberSchema).optional(),
});

// Visibility refinement function (reusable)
const visibilityRefine = (data: { visibility?: string; visibleToMembers?: string[] }) => {
  if (data.visibility === 'specific_members') {
    return (
      data.visibleToMembers !== undefined &&
      Array.isArray(data.visibleToMembers) &&
      data.visibleToMembers.length > 0
    );
  }
  return true;
};

// Create project schema with refinement
export const createProjectSchema = baseProjectSchema.refine(
  visibilityRefine,
  {
    message: 'visibleToMembers must be a non-empty array when visibility is specific_members',
    path: ['visibleToMembers'],
  }
);

// Update project schema (omit id and members, make partial, then add refinement)
export const updateProjectSchema = baseProjectSchema
  .omit({ id: true, members: true })
  .partial()
  .refine(
    visibilityRefine,
    {
      message: 'visibleToMembers must be a non-empty array when visibility is specific_members',
      path: ['visibleToMembers'],
    }
  );

// Add project member schema
export const addProjectMemberSchema = z.object({
  memberEmail: emailSchema,
  role: z.string().max(100, 'Role must be 100 characters or less').optional(),
  avatar: z.string().max(10, 'Avatar must be 10 characters or less').optional(),
});

// Add project comment schema
export const addProjectCommentSchema = z.object({
  comment: z
    .string()
    .min(1, 'Comment is required')
    .max(5000, 'Comment must be 5000 characters or less')
    .trim(),
});

// Export types
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
export type AddProjectCommentInput = z.infer<typeof addProjectCommentSchema>;
