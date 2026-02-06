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
};

