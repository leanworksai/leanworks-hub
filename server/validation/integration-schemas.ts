import { z } from 'zod';

// Email validation
const emailSchema = z.string().email('Invalid email format');

// Slack integration schema
const slackIntegrationSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
});

// Atlassian integration schema
const atlassianIntegrationSchema = z.object({
  email: emailSchema,
  domain: z.string().min(1, 'Atlassian domain is required'),
  apiToken: z.string().min(1, 'API token is required'),
});

// Outlook integration schema
const outlookIntegrationSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  tenantId: z.string().min(1, 'Tenant ID is required'),
});

// Notion integration schema
const notionIntegrationSchema = z.object({
  integrationToken: z.string().min(1, 'Integration token is required'),
});

// Linear integration schema
const linearIntegrationSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
});

// ClickUp integration schema
const clickupIntegrationSchema = z.object({
  apiToken: z.string().min(1, 'API token is required'),
});

// Union schema for all integrations
export const connectIntegrationSchema = z.union([
  slackIntegrationSchema,
  atlassianIntegrationSchema,
  outlookIntegrationSchema,
  notionIntegrationSchema,
  linearIntegrationSchema,
  clickupIntegrationSchema,
]);

// Export individual schemas for specific use
export {
  slackIntegrationSchema,
  atlassianIntegrationSchema,
  outlookIntegrationSchema,
  notionIntegrationSchema,
  linearIntegrationSchema,
  clickupIntegrationSchema,
};

// Export types
export type SlackIntegrationInput = z.infer<typeof slackIntegrationSchema>;
export type AtlassianIntegrationInput = z.infer<typeof atlassianIntegrationSchema>;
export type OutlookIntegrationInput = z.infer<typeof outlookIntegrationSchema>;
export type NotionIntegrationInput = z.infer<typeof notionIntegrationSchema>;
export type LinearIntegrationInput = z.infer<typeof linearIntegrationSchema>;
export type ClickUpIntegrationInput = z.infer<typeof clickupIntegrationSchema>;
