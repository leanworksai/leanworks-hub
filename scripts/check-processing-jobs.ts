/**
 * Check document processing jobs
 */

import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file if it exists (for local development)
const envPath = join(__dirname, '../.env');
if (existsSync(envPath)) {
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
const dbHost = process.env.DB_HOST || (isLocalDev ? 'localhost' : `/cloudsql/${projectId}:us-west1:${process.env.DB_INSTANCE_NAME || 'leanworks-prod'}`);
const dbPort = parseInt(process.env.DB_PORT || '5432');

// Get org slug from command line arguments
const orgSlug = process.argv[2] || 'leanworksai_mj6bu7m8';
const dbName = `org_${orgSlug}`;

async function checkProcessingJobs(password: string) {
  console.log(`🔍 Checking processing jobs in org ${orgSlug} (${dbName})`);

  const pool = new Pool({
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: dbName,
    user: 'postgres',
    password: password,
    ssl: false,
  });

  try {
    // Check processing jobs
    const jobsResult = await pool.query(`
      SELECT id, doc_id, job_type, status, priority, retry_count, max_retries,
             created_at, started_at, completed_at
      FROM doc_processing_jobs
      ORDER BY created_at DESC
      LIMIT 10
    `);

    console.log(`\n📋 Processing Jobs (${jobsResult.rows.length} found):`);
    jobsResult.rows.forEach(job => {
      console.log(`  ${job.status.toUpperCase()}: ${job.job_type} for doc ${job.doc_id}`);
      console.log(`    Created: ${job.created_at}`);
      if (job.started_at) console.log(`    Started: ${job.started_at}`);
      if (job.completed_at) console.log(`    Completed: ${job.completed_at}`);
      console.log(`    Retries: ${job.retry_count}/${job.max_retries}`);
      console.log('');
    });

    // Check if there are any pending jobs for our document
    const pendingJobs = await pool.query(`
      SELECT COUNT(*) as pending_count
      FROM doc_processing_jobs
      WHERE status IN ('pending', 'processing')
    `);

    console.log(`📊 Job Status: ${pendingJobs.rows[0].pending_count} jobs pending/processing`);

  } catch (error: any) {
    console.error('❌ Database error:', error.message);
  } finally {
    await pool.end();
  }
}

async function main() {
  console.log('🚀 Checking processing jobs...\n');

  try {
    const password = await getPostgresPassword();
    if (!password) {
      throw new Error('Failed to get database password');
    }

    await checkProcessingJobs(password);
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();