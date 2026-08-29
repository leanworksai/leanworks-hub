/**
 * Reprocess a document by resetting its status
 */

import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { getGoogleCloudConfig } from '../server/utils/google-cloud.js';

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

const { projectId } = getGoogleCloudConfig(join(__dirname, '..'));

// Initialize Secret Manager client
const secretManagerClient = new SecretManagerServiceClient({
  projectId,
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

// Get doc ID from command line arguments
const docId = process.argv[2] || 'fee0f57a-72c4-4eb8-960e-3664995ebedd';
const orgSlug = process.argv[3] || 'leanworksai_mj6bu7m8';

const dbName = `org_${orgSlug}`;

async function reprocessDocument(password: string) {
  console.log(`🔄 Resetting document ${docId} in org ${orgSlug} for reprocessing`);

  const pool = new Pool({
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: dbName,
    user: 'postgres',
    password: password,
    ssl: false,
  });

  try {
    // Update document status to processing and clear content
    const updateResult = await pool.query(`
      UPDATE docs
      SET processing_status = 'processing',
          content = '',
          file_metadata = NULL,
          updated_at = NOW()
      WHERE id = $1 AND doc_type = 'pptx'
      RETURNING id, title, doc_type, processing_status
    `, [docId]);

    if (updateResult.rows.length === 0) {
      console.log('❌ Document not found or not a PPTX file');
      return;
    }

    const doc = updateResult.rows[0];
    console.log('✅ Document reset for reprocessing:');
    console.log(`   ID: ${doc.id}`);
    console.log(`   Title: ${doc.title}`);
    console.log(`   Type: ${doc.doc_type}`);
    console.log(`   Status: ${doc.processing_status}`);

    console.log('\n📋 Next steps:');
    console.log('1. The document processing worker should automatically pick up this job');
    console.log('2. Or you can manually trigger processing by uploading a new version of the file');

  } catch (error: any) {
    console.error('❌ Database error:', error.message);
  } finally {
    await pool.end();
  }
}

async function main() {
  console.log('🚀 Reprocessing document...\n');

  try {
    const password = await getPostgresPassword();
    if (!password) {
      throw new Error('Failed to get database password');
    }

    await reprocessDocument(password);
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();
