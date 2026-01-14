import { z } from 'zod';

// Timezone validation
const timezoneSchema = z
  .string()
  .min(1, 'Timezone is required')
  .max(100, 'Timezone must be 100 characters or less');

// Update user profile schema
export const updateUserProfileSchema = z.object({
  jobTitle: z
    .string()
    .min(1, 'Job title is required')
    .max(100, 'Job title must be 100 characters or less')
    .trim(),
  timezone: timezoneSchema,
  responsibilities: z
    .string()
    .max(1000, 'Responsibilities must be 1000 characters or less')
    .optional(),
});

// Export types
export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
