import { z } from 'zod';

// Email validation
const emailSchema = z.string().email('Invalid email format').toLowerCase();

// Visibility enum
const visibilityEnum = z.enum(['all_members', 'specific_members'], {
  errorMap: () => ({ message: 'Visibility must be one of: all_members, specific_members' }),
});

// ISO datetime validation
const dateTimeSchema = z.string().refine(
  (date) => {
    try {
      const parsed = new Date(date);
      return !isNaN(parsed.getTime());
    } catch {
      return false;
    }
  },
  { message: 'Invalid date/time format' }
);

// Base event schema (without refine, so we can use .partial())
const baseEventSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(255, 'Title must be 255 characters or less'),
  description: z
    .string()
    .max(5000, 'Description must be 5000 characters or less')
    .optional(),
  startDate: dateTimeSchema,
  endDate: dateTimeSchema,
  allDay: z.boolean().optional(),
  location: z
    .string()
    .max(255, 'Location must be 255 characters or less')
    .optional(),
  attendees: z.array(emailSchema).optional().default([]),
  visibility: visibilityEnum.optional().default('all_members'),
  visibleToMembers: z.array(emailSchema).optional().default([]),
});

// Create event schema with refinements
export const createEventSchema = baseEventSchema.refine(
  (data) => {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    return end >= start;
  },
  {
    message: 'End date must be after or equal to start date',
    path: ['endDate'],
  }
).refine(
  (data) => {
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

// Update event schema (make partial, then add refinements)
export const updateEventSchema = baseEventSchema.partial().refine(
  (data) => {
    // Only validate date range if both dates are provided
    if (data.startDate && data.endDate) {
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      return end >= start;
    }
    return true;
  },
  {
    message: 'End date must be after or equal to start date',
    path: ['endDate'],
  }
).refine(
  (data) => {
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

// Export types
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
