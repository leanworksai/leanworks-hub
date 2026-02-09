import { IntegrationConfig } from "@/components/IntegrationConnectDialog";

export const integrationConfigs: Record<string, IntegrationConfig> = {
  slack: {
    id: "slack",
    name: "Slack",
    title: "Slack",
    description:
      "Enter your Slack bot token to connect your workspace. You can create a bot token in your Slack app settings.",
    fields: [
      {
        id: "botToken",
        label: "Bot Token",
        type: "password",
        placeholder: "xoxb-your-slack-bot-token",
        required: true,
      },
    ],
  },
  atlassian: {
    id: "atlassian",
    name: "Atlassian",
    title: "Atlassian",
    description:
      "Enter your Atlassian credentials to connect your account. You can create an API token in your Atlassian account settings.",
    fields: [
      {
        id: "email",
        label: "Email",
        type: "email",
        placeholder: "your-email@example.com",
        required: true,
      },
      {
        id: "domain",
        label: "Atlassian Domain URL",
        type: "text",
        placeholder: "{your-domain}.atlassian.net",
        required: true,
      },
      {
        id: "apiToken",
        label: "API Token",
        type: "password",
        placeholder: "Your Atlassian API token",
        required: true,
      },
    ],
  },
  outlook: {
    id: "outlook",
    name: "Outlook",
    title: "Outlook",
    description:
      "Enter your Microsoft Azure App registration credentials to connect Outlook. You can find these in your Azure Portal under App registrations.",
    fields: [
      {
        id: "clientId",
        label: "Client ID",
        type: "text",
        placeholder: "Your Azure Application (client) ID",
        required: true,
      },
      {
        id: "clientSecret",
        label: "Client Secret",
        type: "password",
        placeholder: "Your Azure Client Secret value",
        required: true,
      },
      {
        id: "tenantId",
        label: "Tenant ID",
        type: "text",
        placeholder: "Your Azure Directory (tenant) ID",
        required: true,
      },
    ],
  },
  notion: {
    id: "notion",
    name: "Notion",
    title: "Notion",
    description:
      "Enter your Notion integration token to connect your workspace. You can create an internal integration in your Notion workspace settings.",
    fields: [
      {
        id: "integrationToken",
        label: "Integration Token",
        type: "password",
        placeholder: "secret_...",
        required: true,
      },
    ],
  },
  linear: {
    id: "linear",
    name: "Linear",
    title: "Linear",
    description:
      "Enter your Linear personal API key to connect your workspace. You can create an API key in your Linear account settings under API.",
    fields: [
      {
        id: "apiKey",
        label: "API Key",
        type: "password",
        placeholder: "lin_api_...",
        required: true,
      },
    ],
  },
  clickup: {
    id: "clickup",
    name: "ClickUp",
    title: "ClickUp",
    description:
      "Enter your ClickUp API token to connect your workspace. You can create an API token in your ClickUp settings under Apps.",
    fields: [
      {
        id: "apiToken",
        label: "API Token",
        type: "password",
        placeholder: "pk_...",
        required: true,
      },
    ],
  },
  workday: {
    id: "workday",
    name: "Workday",
    title: "Workday",
    description:
      "Enter your Workday OAuth credentials to connect your tenant. You can create these in your Workday OAuth client settings.",
    fields: [
      {
        id: "clientId",
        label: "Client ID",
        type: "text",
        placeholder: "Your Workday OAuth client ID",
        required: true,
      },
      {
        id: "clientSecret",
        label: "Client Secret",
        type: "password",
        placeholder: "Your Workday OAuth client secret",
        required: true,
      },
      {
        id: "tenantId",
        label: "Tenant ID",
        type: "text",
        placeholder: "Your Workday tenant ID",
        required: true,
      },
      {
        id: "baseUrl",
        label: "Base URL",
        type: "text",
        placeholder: "https://wd2-impl-services1.workday.com",
        required: true,
      },
    ],
  },
  google_drive: {
    id: "google_drive",
    name: "Google Drive",
    title: "Google Drive",
    description:
      "Paste a GCP service account JSON key with Drive API access. Create a service account in Google Cloud Console, enable the Drive API, and download the JSON key. Share Drive folders with the service account email to allow access.",
    fields: [
      {
        id: "serviceAccountJson",
        label: "Service account JSON",
        type: "textarea",
        placeholder: '{"type": "service_account", "project_id": "...", "private_key_id": "...", ...}',
        required: true,
      },
    ],
  },
  google_cloud_storage: {
    id: "google_cloud_storage",
    name: "Google Cloud Storage",
    title: "Google Cloud Storage",
    description:
      "Paste a GCP service account JSON key with Cloud Storage access. Create a service account in Google Cloud Console, grant Storage Object Viewer/Creator roles as needed, and download the JSON key. Optionally set a bucket name; the agent may use an environment default otherwise.",
    fields: [
      {
        id: "serviceAccountJson",
        label: "Service account JSON",
        type: "textarea",
        placeholder: '{"type": "service_account", "project_id": "...", "private_key_id": "...", ...}',
        required: true,
      },
      {
        id: "bucketName",
        label: "Bucket name (optional)",
        type: "text",
        placeholder: "my-gcs-bucket",
        required: false,
      },
    ],
  },
  bigquery: {
    id: "bigquery",
    name: "BigQuery",
    title: "BigQuery",
    description:
      "Paste a GCP service account JSON key with BigQuery Data Viewer/Job User access. Create a service account in Google Cloud Console, enable the BigQuery API, and download the JSON key. Used for read-only queries and listing datasets/tables.",
    fields: [
      {
        id: "serviceAccountJson",
        label: "Service account JSON",
        type: "textarea",
        placeholder: '{"type": "service_account", "project_id": "...", "private_key_id": "...", ...}',
        required: true,
      },
    ],
  },
};

