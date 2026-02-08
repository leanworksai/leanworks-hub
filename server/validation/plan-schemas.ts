import { z } from 'zod';

// Email validation
const emailSchema = z.string().email('Invalid email format').toLowerCase();

// ============================================================================
// OBJECTIVES SCHEMA
// ============================================================================

export const createObjectiveSchema = z.object({
  text: z.string().min(1, 'Objective text is required').max(255, 'Objective text must be 255 characters or less'),
  targetValue: z.number().nonnegative('Target value must be non-negative'),
  currentValue: z.number().nonnegative('Current value must be non-negative').default(0),
  unit: z.enum(['percentage', 'count', 'currency'], {
    errorMap: () => ({ message: 'Unit must be one of: percentage, count, currency' }),
  }),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be in YYYY-MM-DD format').optional(),
  status: z.enum(['on-track', 'at-risk', 'completed'], {
    errorMap: () => ({ message: 'Status must be one of: on-track, at-risk, completed' }),
  }).default('on-track'),
});

export const updateObjectiveSchema = createObjectiveSchema.partial();

// ============================================================================
// BUDGET CATEGORY SCHEMA
// ============================================================================

export const createBudgetCategorySchema = z.object({
  name: z.string().min(1, 'Budget category name is required').max(255, 'Name must be 255 characters or less'),
  allocatedAmount: z.number().nonnegative('Allocated amount must be non-negative'),
  spentAmount: z.number().nonnegative('Spent amount must be non-negative').default(0),
  projectId: z.string().max(50, 'Project ID must be 50 characters or less').optional().nullable(),
});

export const updateBudgetCategorySchema = createBudgetCategorySchema.partial();

// ============================================================================
// RESOURCE ALLOCATION SCHEMA
// ============================================================================

const baseResourceAllocationSchema = z.object({
  userEmail: emailSchema,
  userName: z.string().max(255, 'User name must be 255 characters or less').optional(),
  allocationPercentage: z.number().min(0, 'Allocation percentage must be at least 0').max(100, 'Allocation percentage must not exceed 100'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be in YYYY-MM-DD format'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be in YYYY-MM-DD format'),
  role: z.string().max(255, 'Role must be 255 characters or less').optional(),
  hourlyRate: z.number().nonnegative('Hourly rate must be non-negative').optional(),
  normalizedHours: z.number().nonnegative('Normalized hours must be non-negative').optional(),
  projectId: z.string().max(50, 'Project ID must be 50 characters or less').optional().nullable(),
});

export const createResourceAllocationSchema = baseResourceAllocationSchema.refine(
  (data) => new Date(data.startDate) <= new Date(data.endDate),
  {
    message: 'End date must be after or equal to start date',
    path: ['endDate'],
  }
);

export const updateResourceAllocationSchema = baseResourceAllocationSchema
  .partial()
  .refine(
    (data) => {
      if (!data.startDate || !data.endDate) return true;
      return new Date(data.startDate) <= new Date(data.endDate);
    },
    {
      message: 'End date must be after or equal to start date',
      path: ['endDate'],
    }
  );

// ============================================================================
// MILESTONE SCHEMA
// ============================================================================

export const createMilestoneSchema = z.object({
  name: z.string().min(1, 'Milestone name is required').max(255, 'Name must be 255 characters or less'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be in YYYY-MM-DD format'),
  status: z.enum(['pending', 'completed', 'at-risk'], {
    errorMap: () => ({ message: 'Status must be one of: pending, completed, at-risk' }),
  }).default('pending'),
  description: z.string().max(5000, 'Description must be 5000 characters or less').optional(),
});

export const updateMilestoneSchema = createMilestoneSchema.partial();

// ============================================================================
// BASE PLAN SCHEMA
// ============================================================================

const basePlanSchema = z.object({
  id: z.string().max(50, 'Plan ID must be 50 characters or less').optional(),
  name: z
    .string()
    .min(1, 'Plan name is required')
    .max(255, 'Plan name must be 255 characters or less'),
  description: z
    .string()
    .max(5000, 'Description must be 5000 characters or less')
    .optional(),
  status: z.enum(['planning', 'active', 'at-risk', 'completed'], {
    errorMap: () => ({ message: 'Status must be one of: planning, active, at-risk, completed' }),
  }).optional().default('planning'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be in YYYY-MM-DD format'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be in YYYY-MM-DD format'),
  totalBudget: z.number().nonnegative('Total budget must be non-negative'),
  currency: z.string().length(3, 'Currency must be 3 characters (e.g., USD, EUR)').default('USD'),
  spentToDate: z.number().nonnegative('Spent to date must be non-negative').optional().default(0),
  ownerEmail: emailSchema,
  ownerName: z.string().max(255, 'Owner name must be 255 characters or less').optional(),
  teamSize: z.number().nonnegative('Team size must be non-negative').optional().default(0),
  objectives: z.array(createObjectiveSchema).optional().default([]),
  budgetCategories: z.array(createBudgetCategorySchema).optional().default([]),
  resourceAllocations: z.array(createResourceAllocationSchema).optional().default([]),
  milestones: z.array(createMilestoneSchema).optional().default([]),
  projectIds: z.array(z.string().max(50)).optional().default([]),
});

// ============================================================================
// CREATE AND UPDATE PLAN SCHEMAS
// ============================================================================

export const createPlanSchema = basePlanSchema
  .refine(
    (data) => new Date(data.startDate) <= new Date(data.endDate),
    {
      message: 'End date must be after or equal to start date',
      path: ['endDate'],
    }
  )
  .refine(
    (data) => data.spentToDate <= data.totalBudget,
    {
      message: 'Spent to date cannot exceed total budget',
      path: ['spentToDate'],
    }
  );

export const updatePlanSchema = basePlanSchema
  .omit({ id: true })
  .partial()
  .refine(
    (data) => {
      if (!data.startDate || !data.endDate) return true;
      return new Date(data.startDate) <= new Date(data.endDate);
    },
    {
      message: 'End date must be after or equal to start date',
      path: ['endDate'],
    }
  )
  .refine(
    (data) => {
      if (data.spentToDate === undefined || data.totalBudget === undefined) return true;
      return data.spentToDate <= data.totalBudget;
    },
    {
      message: 'Spent to date cannot exceed total budget',
      path: ['spentToDate'],
    }
  );

// ============================================================================
// PROJECT LINKING SCHEMA
// ============================================================================

export const linkProjectSchema = z.object({
  projectId: z.string().max(50, 'Project ID must be 50 characters or less'),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type CreateObjectiveInput = z.infer<typeof createObjectiveSchema>;
export type UpdateObjectiveInput = z.infer<typeof updateObjectiveSchema>;

export type CreateBudgetCategoryInput = z.infer<typeof createBudgetCategorySchema>;
export type UpdateBudgetCategoryInput = z.infer<typeof updateBudgetCategorySchema>;

export type CreateResourceAllocationInput = z.infer<typeof createResourceAllocationSchema>;
export type UpdateResourceAllocationInput = z.infer<typeof updateResourceAllocationSchema>;

export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export type LinkProjectInput = z.infer<typeof linkProjectSchema>;
