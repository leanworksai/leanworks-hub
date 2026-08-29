/**
 * Run migration on a specific organization database
 */

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file if it exists (for local development)
const envPath = join(__dirname, '../.env');
if (envPath) {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = value;
        }
      }
    }
  });
}

// Read GCP credentials
const serviceAccountPath = join(__dirname, '../gcp_credential.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
const projectId = serviceAccount.project_id;

// Initialize Secret Manager client
const secretManagerClient = new SecretManagerServiceClient({
  keyFilename: serviceAccountPath,
});

// Fetch PostgreSQL password from Secret Manager
async function getPostgresPassword(): Promise<string> {
  try {
    const secretName = `projects/${projectId}/secrets/postgresdb-password/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
    const password = (version.payload?.data?.toString() || '').trim();
    console.log('✅ PostgreSQL password fetched from Secret Manager');
    return password;
  } catch (error) {
    console.error('❌ Failed to fetch password from Secret Manager:', error);
    // Fallback to environment variable
    return process.env.DB_PASSWORD || '';
  }
}

// Database configuration
const isLocalDev = process.env.NODE_ENV === 'development' || !process.env.DB_HOST;
const dbHost = process.env.DB_HOST || (isLocalDev ? 'localhost' : `/cloudsql/${projectId}:us-west1:leanworks-prod`);
const dbPort = parseInt(process.env.DB_PORT || '5432');

// Read migration SQL
const migrationSQL = readFileSync(
  join(__dirname, '../database/migrations/add-document-upload-support.sql'),
  'utf8'
);

// Get org slug from command line arguments
const orgSlug = process.argv[2];
if (!orgSlug) {
  console.error('❌ Please provide an organization slug as an argument');
  console.error('Usage: npm run tsx scripts/run-single-migration.ts <org-slug>');
  process.exit(1);
}

const dbName = `org_${orgSlug}`;

async function runMigration(password: string) {
  const pool = new Pool({
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: dbName,
    user: 'postgres',
    password: password,
    ssl: false,
  });

  try {
    console.log(`🔍 Checking migration status for: ${orgSlug} (${dbName})`);

    // Check if migration already run
    const alreadyMigrated = await checkMigrationStatus(pool);

    if (alreadyMigrated) {
      console.log(`⏭️ ${orgSlug} is already migrated`);
      return;
    }

    console.log(`\n🔄 Running migration for: ${orgSlug} (${dbName})`);

    // Run migration
    await pool.query(migrationSQL);

    console.log(`✅ Migration completed successfully for ${orgSlug}`);

  } catch (error: any) {
    console.error(`❌ Migration failed for ${orgSlug}:`, error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

async function checkMigrationStatus(pool: Pool): Promise<boolean> {
  try {
    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'docs'
      AND column_name = 'doc_type'
    `);
    return result.rows.length > 0;
  } catch (error) {
    return false;
  }
}

async function main() {
  console.log('🚀 Running migration for single organization...\n');

  try {
    const password = await getPostgresPassword();
    if (!password) {
      throw new Error('Failed to get database password');
    }

    await runMigration(password);
    console.log('\n🎉 Migration completed successfully!');
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

main();