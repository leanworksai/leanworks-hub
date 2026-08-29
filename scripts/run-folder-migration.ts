#!/usr/bin/env node
/**
 * Run folder support migration on dev database
 */

import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { getGoogleCloudConfig } from '../server/utils/google-cloud.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getPostgresPassword(): Promise<string> {
  const { projectId } = getGoogleCloudConfig(join(__dirname, '..'));

  const secretManagerClient = new SecretManagerServiceClient({
    projectId,
  });

  const secretName = `projects/${projectId}/secrets/dev-postgresdb-password/versions/latest`;
  const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
  const password = (version.payload?.data?.toString() || '').trim();
  console.log('✅ PostgreSQL password fetched from Secret Manager');
  return password;
}

async function runMigration() {
  try {
    // Fetch password from Secret Manager
    const password = await getPostgresPassword();

    const client = new Client({
      host: 'localhost',
      port: 5432,
      database: 'leanworks-dev',
      user: 'postgres',
      password: password,
    });

    await client.connect();
    console.log('✅ Connected to leanworks-dev database');

    // Read and execute the migration SQL
    const migrationPath = join(__dirname, '../database/migrations/add-folder-support.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    console.log('📝 Running folder support migration...');
    await client.query(migrationSQL);
    console.log('✅ Migration completed successfully');

    await client.end();

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
