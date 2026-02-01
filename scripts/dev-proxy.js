#!/usr/bin/env node

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

// Read the dev credential file to get the project ID
const creds = JSON.parse(readFileSync('./gcp_credential_dev.json', 'utf8'));
const projectId = creds.project_id;

// Get the database instance name from environment or default
const dbInstanceName = process.env.DB_INSTANCE_NAME || 'leanworks-dev';

// Build the connection string
const connectionString = `${projectId}:us-west1:${dbInstanceName}`;

// Build the command
const cmd = `cloud-sql-proxy --credentials-file=./gcp_credential_dev.json ${connectionString} --port=5432`;

console.log(`🚀 Starting Cloud SQL proxy for: ${connectionString}`);

// Execute the command
execSync(cmd, {
  stdio: 'inherit',
  cwd: process.cwd()
});