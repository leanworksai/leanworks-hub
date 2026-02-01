/**
 * Environment detection and resource configuration utilities
 *
 * This module provides consistent environment detection and resource naming
 * for local development vs production deployments.
 */

/**
 * Determines if the application is running in local development mode
 * @returns true if running locally (NODE_ENV=development or no DB_HOST set)
 */
export function isLocalDev(): boolean {
  return process.env.NODE_ENV === 'development' || !process.env.DB_HOST;
}

/**
 * Gets the appropriate database instance name based on environment
 * @returns 'leanworks-dev' for local dev, otherwise DB_INSTANCE_NAME env var or 'leanworks-prod'
 */
export function getDbInstanceName(): string {
  if (isLocalDev()) {
    return 'leanworks-dev';
  }
  return process.env.DB_INSTANCE_NAME || 'leanworks-prod';
}

/**
 * Gets the appropriate database name based on environment
 * @returns 'leanworks-dev' for local dev, otherwise DB_NAME env var or 'leanworks-prod'
 */
export function getDbName(): string {
  if (isLocalDev()) {
    return 'leanworks-dev';
  }
  return process.env.DB_NAME || 'leanworks-prod';
}

/**
 * Gets the appropriate storage bucket name based on environment
 * @returns 'leanworks-dev' for local dev, otherwise AUDIO_STORAGE_BUCKET env var or 'leanworks-prod'
 */
export function getStorageBucket(): string {
  if (isLocalDev()) {
    return 'leanworks-dev';
  }
  return process.env.AUDIO_STORAGE_BUCKET || 'leanworks-prod';
}

/**
 * Gets the appropriate Firestore database name based on environment
 * @returns 'leanworks-dev' for local dev, otherwise FIRESTORE_DATABASE_NAME env var or 'leanworks-prod'
 */
export function getFirestoreDatabaseName(): string {
  if (isLocalDev()) {
    return 'leanworks-dev';
  }
  return process.env.FIRESTORE_DATABASE_NAME || 'leanworks-prod';
}

/**
 * Gets the appropriate secret name based on environment
 * @param baseName - The base secret name (e.g., 'postgresdb-password')
 * @returns 'dev-{baseName}' for local dev, otherwise baseName for production
 */
export function getSecretName(baseName: string): string {
  if (isLocalDev()) {
    return `dev-${baseName}`;
  }
  return baseName;
}

/**
 * Gets the appropriate GCP credential file path based on environment
 * @returns path to gcp_credential_dev.json for local dev, otherwise gcp_credential.json
 */
export function getCredentialPath(): string {
  if (isLocalDev()) {
    return 'gcp_credential_dev.json';
  }
  return 'gcp_credential.json';
}