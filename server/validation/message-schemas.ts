import { z } from 'zod';

// Message role enum
const messageRoleEnum = z.enum(['user', 'assistant', 'system'], {
  errorMap: () => ({ message: 'Role must be one of: user, assistant, system' }),
});

// Create message schema
export const createMessageSchema = z.object({
  chatId: z
    .string()
    .min(1, 'Chat ID is required')
    .max(255, 'Chat ID must be 255 characters or less'),
  role: messageRoleEnum.optional().default('user'),
  content: z
    .string()
    .min(1, 'Content is required')
    .max(50000, 'Content must be 50000 characters or less'),
  memberName: z
    .string()
    .max(255, 'Member name must be 255 characters or less')
    .optional(),
  memberAvatar: z
    .string()
    .max(10, 'Member avatar must be 10 characters or less')
    .optional(),
  projectId: z
    .string()
    .max(50, 'Project ID must be 50 characters or less')
    .optional()
    .nullable(),
  citedContext: z.any().optional(),
  imageUrls: z.array(z.string().url('Invalid image URL')).optional(),
});

// Export types
export type CreateMessageInput = z.infer<typeof createMessageSchema>;
