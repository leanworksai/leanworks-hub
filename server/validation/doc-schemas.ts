import { z } from 'zod';

// Enum definitions matching database constraints
const visibilityEnum = z.enum(['all_members', 'specific_members'], {
  errorMap: () => ({ message: 'Visibility must be one of: all_members, specific_members' }),
});

// Email validation
const emailSchema = z.string().email('Invalid email format').toLowerCase();

const looksLikeHtml = (content: string) => /<\/?[a-z][\s\S]*>/i.test(content);

const isJsonString = (content: string) => {
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
};

// TipTap content validation (JSON or HTML, allow empty/default structure)
const tiptapContentSchema = z.string().refine(
  (content) => {
    // Allow empty string (will be treated as empty doc)
    if (!content || content.trim().length === 0) {
      return true;
    }
    // Accept JSON (TipTap format) or HTML (to be converted server-side)
    return isJsonString(content) || looksLikeHtml(content);
  },
  { message: 'Content must be valid JSON (TipTap format) or HTML if provided' }
);

// Base doc schema with common fields
const baseDocSchema = z.object({
  id: z.string().max(50, 'Document ID must be 50 characters or less').optional(),
  title: z
    .string()
    .min(1, 'Title is required')
    .max(255, 'Title must be 255 characters or less'),
  content: tiptapContentSchema,
  projectId: z
    .string()
    .max(50, 'Project ID must be 50 characters or less')
    .optional()
    .nullable(),
  teamId: z
    .string()
    .max(50, 'Team ID must be 50 characters or less')
    .optional()
    .nullable(),
  folderId: z
    .string()
    .max(50, 'Folder ID must be 50 characters or less')
    .optional()
    .nullable(),
  isFolder: z.boolean().optional().default(false),
  tags: z
    .array(z.string().max(100, 'Each tag must be 100 characters or less'))
    .max(50, 'Maximum 50 tags allowed')
    .optional()
    .default([]),
  metadata: z
    .record(z.unknown())
    .optional()
    .default({}),
  visibility: visibilityEnum.optional().default('all_members'),
  visibleToMembers: z
    .array(emailSchema)
    .optional()
    .default([]),
});

// Content schema for folders (empty or minimal content allowed)
const folderContentSchema = z.string().refine(
  (content) => {
    // Allow empty content for folders
    if (!content || content.trim().length === 0 || content === '{}' || content === '[]') {
      return true;
    }
    // Accept JSON (TipTap format) or HTML
    return isJsonString(content) || looksLikeHtml(content);
  },
  { message: 'Content must be valid JSON (TipTap format), HTML, or empty for folders' }
);

// Doc creation schema
export const createDocSchema = baseDocSchema
  .extend({
    title: z
      .string()
      .min(1, 'Title is required')
      .max(255, 'Title must be 255 characters or less'),
    content: tiptapContentSchema,
  })
  .refine(
    (data) => {
      // If this is a folder, allow empty/minimal content
      if (data.isFolder) {
        return true;
      }
      // For regular documents, content is required
      return data.content && data.content.trim().length > 0;
    },
    {
      message: 'Content is required for documents (folders can have empty content)',
      path: ['content'],
    }
  )
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

// TipTap content validation for updates (optional, but if provided must be valid)
const optionalTiptapContentSchema = z.string().optional().refine(
  (content) => {
    // If content is undefined or empty string, it's valid (field is optional)
    if (content === undefined || content === null || content.trim().length === 0) {
      return true;
    }
    // Accept JSON (TipTap format) or HTML (to be converted server-side)
    return isJsonString(content) || looksLikeHtml(content);
  },
  { message: 'Content must be valid JSON (TipTap format) or HTML if provided' }
);

// Doc partial update schema - all fields optional
export const updateDocSchema = baseDocSchema
  .omit({ id: true }) // Don't allow updating the ID
  .partial()
  .extend({
    // Override content to be optional with proper validation
    content: optionalTiptapContentSchema,
  })
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
  )
  .refine(
    (data) => {
      // Prevent setting folderId to the document's own ID (circular reference)
      if (data.folderId && data.id && data.folderId === data.id) {
        return false;
      }
      return true;
    },
    {
      message: 'Cannot move a document/folder into itself',
      path: ['folderId'],
    }
  );

// Export types for use in the codebase
export type CreateDocInput = z.infer<typeof createDocSchema>;
export type UpdateDocInput = z.infer<typeof updateDocSchema>;
