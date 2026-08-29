#!/usr/bin/env node

import { spawnSync } from 'child_process';

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
if (!projectId) {
  console.error('Set GOOGLE_CLOUD_PROJECT before starting the Cloud SQL proxy.');
  process.exit(1);
}

// Get the database instance name from environment or default
const dbInstanceName = process.env.DB_INSTANCE_NAME || 'leanworks-dev';

// Build the connection string
const connectionString = `${projectId}:us-west1:${dbInstanceName}`;

console.log(`🚀 Starting Cloud SQL proxy for: ${connectionString}`);

const result = spawnSync('cloud-sql-proxy', [connectionString, '--port=5432'], {
  stdio: 'inherit',
  cwd: process.cwd()
});

process.exit(result.status ?? 1);
