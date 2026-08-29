import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { getLocalCredentialPath, isLocalDev } from './env.js';

export interface GoogleCloudConfig {
  projectId: string;
}

let cachedConfig: GoogleCloudConfig | null = null;

function readProjectId(credentialPath: string): string | undefined {
  try {
    const credentials = JSON.parse(readFileSync(credentialPath, 'utf8'));
    return typeof credentials.project_id === 'string' ? credentials.project_id.trim() : undefined;
  } catch (error) {
    throw new Error(`Unable to read configured Google Cloud credentials: ${(error as Error).message}`);
  }
}

/**
 * Resolve Google Cloud configuration without passing credential material into
 * client constructors. Google client libraries use Application Default
 * Credentials (ADC), which maps to Workload Identity in GKE.
 *
 * Local development may continue to use an ignored credential JSON file. The
 * file is exposed to Google libraries only through GOOGLE_APPLICATION_CREDENTIALS.
 */
export function getGoogleCloudConfig(baseDirectory: string = process.cwd()): GoogleCloudConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  let credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

  if (credentialPath) {
    credentialPath = resolve(baseDirectory, credentialPath);
  } else if (isLocalDev()) {
    const localCredentialPath = resolve(baseDirectory, getLocalCredentialPath());
    if (existsSync(localCredentialPath)) {
      credentialPath = localCredentialPath;
      process.env.GOOGLE_APPLICATION_CREDENTIALS = localCredentialPath;
    }
  }

  const projectId = (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    (credentialPath && existsSync(credentialPath) ? readProjectId(credentialPath) : undefined)
  )?.trim();

  if (!projectId) {
    throw new Error(
      'Google Cloud project ID is required. Set GOOGLE_CLOUD_PROJECT (recommended) or GCP_PROJECT_ID.',
    );
  }

  process.env.GOOGLE_CLOUD_PROJECT ||= projectId;
  cachedConfig = { projectId };
  return cachedConfig;
}
