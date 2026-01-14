import { z } from 'zod';

// Email validation
const emailSchema = z.string().email('Invalid email format').toLowerCase();

// Demo request schema
export const demoRequestSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(255, 'Name must be 255 characters or less')
    .trim(),
  email: emailSchema,
  company: z
    .string()
    .max(255, 'Company must be 255 characters or less')
    .optional(),
  message: z
    .string()
    .max(5000, 'Message must be 5000 characters or less')
    .optional(),
});

// Doc share schema
export const docShareSchema = z.object({
  email: emailSchema,
  message: z
    .string()
    .max(500, 'Message must be 500 characters or less')
    .optional(),
});

// Add task comment schema
export const addTaskCommentSchema = z.object({
  comment: z
    .string()
    .min(1, 'Comment is required')
    .max(5000, 'Comment must be 5000 characters or less')
    .trim(),
  memberName: z
    .string()
    .max(255, 'Member name must be 255 characters or less')
    .optional(),
  memberAvatar: z
    .string()
    .max(10, 'Member avatar must be 10 characters or less')
    .optional(),
});

// Export types
export type DemoRequestInput = z.infer<typeof demoRequestSchema>;
export type DocShareInput = z.infer<typeof docShareSchema>;
export type AddTaskCommentInput = z.infer<typeof addTaskCommentSchema>;
