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
};

