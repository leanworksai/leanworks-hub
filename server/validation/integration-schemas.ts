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

// Workday integration schema
const workdayIntegrationSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  tenantId: z.string().min(1, 'Tenant ID is required'),
  baseUrl: z.string().min(1, 'Base URL is required'),
});

// GCP service account JSON validation helper
const serviceAccountJsonSchema = z.string().min(1, 'Service account JSON is required').refine(
  (val) => {
    try {
      const parsed = JSON.parse(val);
      const hasKey = (parsed.private_key ?? parsed.privateKey) != null;
      const hasEmail = (parsed.client_email ?? (parsed as any).clientEmail) != null;
      return (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed.type ?? (parsed as any).type) === 'string' &&
        hasKey &&
        hasEmail
      );
    } catch {
      return false;
    }
  },
  { message: 'Must be valid GCP service account JSON with type, private_key, and client_email' }
);

// Google Drive integration schema
const googleDriveIntegrationSchema = z.object({
  serviceAccountJson: serviceAccountJsonSchema,
});

// Google Cloud Storage integration schema
const googleCloudStorageIntegrationSchema = z.object({
  serviceAccountJson: serviceAccountJsonSchema,
  bucketName: z.string().optional(),
});

// BigQuery integration schema
const bigqueryIntegrationSchema = z.object({
  serviceAccountJson: serviceAccountJsonSchema,
});

// Union schema for all integrations
export const connectIntegrationSchema = z.union([
  slackIntegrationSchema,
  atlassianIntegrationSchema,
  outlookIntegrationSchema,
  notionIntegrationSchema,
  linearIntegrationSchema,
  clickupIntegrationSchema,
  workdayIntegrationSchema,
  googleDriveIntegrationSchema,
  googleCloudStorageIntegrationSchema,
  bigqueryIntegrationSchema,
]);

// Export individual schemas for specific use
export {
  slackIntegrationSchema,
  atlassianIntegrationSchema,
  outlookIntegrationSchema,
  notionIntegrationSchema,
  linearIntegrationSchema,
  clickupIntegrationSchema,
  workdayIntegrationSchema,
  googleDriveIntegrationSchema,
  googleCloudStorageIntegrationSchema,
  bigqueryIntegrationSchema,
};

// Export types
export type SlackIntegrationInput = z.infer<typeof slackIntegrationSchema>;
export type AtlassianIntegrationInput = z.infer<typeof atlassianIntegrationSchema>;
export type OutlookIntegrationInput = z.infer<typeof outlookIntegrationSchema>;
export type NotionIntegrationInput = z.infer<typeof notionIntegrationSchema>;
export type LinearIntegrationInput = z.infer<typeof linearIntegrationSchema>;
export type ClickUpIntegrationInput = z.infer<typeof clickupIntegrationSchema>;
export type WorkdayIntegrationInput = z.infer<typeof workdayIntegrationSchema>;
export type GoogleDriveIntegrationInput = z.infer<typeof googleDriveIntegrationSchema>;
export type GoogleCloudStorageIntegrationInput = z.infer<typeof googleCloudStorageIntegrationSchema>;
export type BigQueryIntegrationInput = z.infer<typeof bigqueryIntegrationSchema>;