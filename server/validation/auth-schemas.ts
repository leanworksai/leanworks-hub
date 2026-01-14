import { z } from 'zod';

// Email validation with normalization
const emailSchema = z
  .string()
  .email('Invalid email format')
  .toLowerCase()
  .transform((email) => email.trim());

// Password validation (minimum 6 characters for security)
const passwordSchema = z
  .string()
  .min(6, 'Password must be at least 6 characters long')
  .max(128, 'Password must be 128 characters or less');

// Timezone validation
const timezoneSchema = z
  .string()
  .min(1, 'Timezone is required')
  .max(100, 'Timezone must be 100 characters or less');

// Signup schema
export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z
    .string()
    .min(1, 'First name is required')
    .max(100, 'First name must be 100 characters or less')
    .trim(),
  lastName: z
    .string()
    .min(1, 'Last name is required')
    .max(100, 'Last name must be 100 characters or less')
    .trim(),
  jobTitle: z
    .string()
    .max(100, 'Job title must be 100 characters or less')
    .optional(),
  timezone: timezoneSchema,
});

// Login schema
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

// Resend verification schema
export const resendVerificationSchema = z.object({
  email: emailSchema,
});

// Export types
export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
