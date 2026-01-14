import { z } from 'zod';

// Subscription plan enum
const subscriptionPlanEnum = z.enum(['free', 'standard', 'pro'], {
  errorMap: () => ({ message: 'Plan must be one of: free, standard, pro' }),
});

// Checkout schema
export const checkoutSchema = z.object({
  plan: subscriptionPlanEnum,
  successUrl: z
    .string()
    .url('Success URL must be a valid URL')
    .optional(),
  cancelUrl: z
    .string()
    .url('Cancel URL must be a valid URL')
    .optional(),
});

// Portal schema
export const portalSchema = z.object({
  returnUrl: z
    .string()
    .url('Return URL must be a valid URL')
    .optional(),
});

// Switch plan schema
export const switchPlanSchema = z.object({
  plan: subscriptionPlanEnum,
});

// Export types
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type PortalInput = z.infer<typeof portalSchema>;
export type SwitchPlanInput = z.infer<typeof switchPlanSchema>;
