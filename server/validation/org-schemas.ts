import { z } from 'zod';

// Email validation
const emailSchema = z
  .string()
  .email('Invalid email format')
  .toLowerCase()
  .transform((email) => email.trim());

// Create organization schema
export const createOrgSchema = z.object({
  name: z
    .string()
    .min(1, 'Organization name is required')
    .max(255, 'Organization name must be 255 characters or less')
    .trim(),
  description: z
    .string()
    .max(1000, 'Description must be 1000 characters or less')
    .optional(),
});

// Update organization schema
export const updateOrgSchema = z.object({
  name: z
    .string()
    .min(1, 'Organization name is required')
    .max(255, 'Organization name must be 255 characters or less')
    .trim()
    .optional(),
  description: z
    .string()
    .max(1000, 'Description must be 1000 characters or less')
    .optional(),
});

// Invite to organization schema
export const inviteToOrgSchema = z.object({
  email: emailSchema,
  message: z
    .string()
    .max(500, 'Message must be 500 characters or less')
    .optional(),
});

// Export types
export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;
export type InviteToOrgInput = z.infer<typeof inviteToOrgSchema>;
