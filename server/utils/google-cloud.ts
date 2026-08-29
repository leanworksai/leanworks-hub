export interface GoogleCloudConfig {
  projectId: string;
}

let cachedConfig: GoogleCloudConfig | null = null;

/**
 * Resolve Google Cloud configuration without passing credential material into
 * client constructors. Google client libraries use Application Default
 * Credentials (ADC), which maps to Workload Identity in GKE.
 *
 * Local development should use `gcloud auth application-default login`. A
 * credential file can still be selected explicitly with the standard
 * GOOGLE_APPLICATION_CREDENTIALS environment variable, but application code
 * never reads or passes its contents.
 */
export function getGoogleCloudConfig(_baseDirectory?: string): GoogleCloudConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const projectId = (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT_ID ||
    process.env.GCLOUD_PROJECT
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
