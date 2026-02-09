/**
 * GitHub App utilities for authentication and API access
 */

import { App } from '@octokit/app';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { getSecretName } from '../utils/env.js';

let githubApp: App | null = null;

/**
 * Initialize GitHub App instance
 */
export async function getGitHubApp(secretManagerClient: SecretManagerServiceClient, projectId: string): Promise<App> {
  if (!githubApp) {
    try {
      // Retrieve GitHub App ID from Secret Manager
      const appIdSecretName = `projects/${projectId}/secrets/${getSecretName('github-app-id')}/versions/latest`;
      const [appIdVersion] = await secretManagerClient.accessSecretVersion({ name: appIdSecretName });
      const appId = appIdVersion.payload?.data?.toString()?.trim();

      // Retrieve GitHub App private key from Secret Manager
      const privateKeySecretName = `projects/${projectId}/secrets/${getSecretName('github-app-private-key')}/versions/latest`;
      const [privateKeyVersion] = await secretManagerClient.accessSecretVersion({ name: privateKeySecretName });
      const privateKey = privateKeyVersion.payload?.data?.toString()?.trim();

      if (!appId || !privateKey) {
        throw new Error('GitHub App credentials not found in Secret Manager. Please ensure github-app-id and github-app-private-key secrets are configured.');
      }

      githubApp = new App({
        appId: parseInt(appId, 10),
        privateKey: privateKey.replace(/\\n/g, '\n'), // Handle escaped newlines
      });
    } catch (error: any) {
      throw new Error(`GitHub App credentials not configured: ${error.message}`);
    }
  }

  return githubApp;
}

/**
 * Get an installation token for a specific installation
 */
export async function getInstallationToken(
  installationId: number,
  secretManagerClient: SecretManagerServiceClient,
  projectId: string
): Promise<string> {
  try {
    const app = await getGitHubApp(secretManagerClient, projectId);
    const octokit = await app.getInstallationOctokit(installationId);
    const auth = await octokit.auth({ type: 'installation' });
    return (auth as any).token;
  } catch (error: any) {
    console.error('[GitHub App] Error getting installation token:', error);
    throw new Error(`Failed to get installation token: ${error.message}`);
  }
}

/**
 * List all installations for the GitHub App
 */
export async function listInstallations(
  secretManagerClient: SecretManagerServiceClient,
  projectId: string
): Promise<Array<{
  id: number;
  account: any;
  repository_selection: string;
  permissions: Record<string, string>;
  events: string[];
  single_file_name: string | null;
}>> {
  try {
    const app = await getGitHubApp(secretManagerClient, projectId);
    const octokit = await app.getInstallationOctokit(1); // Use any installation to get the app octokit
    const { data } = await octokit.request('GET /app/installations');
    return data;
  } catch (error: any) {
    console.error('[GitHub App] Error listing installations:', error);
    throw new Error(`Failed to list installations: ${error.message}`);
  }
}

/**
 * Get details for a specific installation
 */
export async function getInstallation(
  installationId: number,
  secretManagerClient: SecretManagerServiceClient,
  projectId: string
): Promise<{
  id: number;
  account: any;
  repository_selection: string;
  permissions: Record<string, string>;
  events: string[];
  single_file_name: string | null;
}> {
  try {
    const app = await getGitHubApp(secretManagerClient, projectId);
    const octokit = await app.getInstallationOctokit(installationId);
    const { data } = await octokit.request('GET /app/installations/{installation_id}', {
      installation_id: installationId
    });
    return data;
  } catch (error: any) {
    console.error('[GitHub App] Error getting installation:', error);
    throw new Error(`Failed to get installation details: ${error.message}`);
  }
}