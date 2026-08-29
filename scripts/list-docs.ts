/**
 * List all documents in a database
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
    return password;
  } catch (error) {
    return process.env.DB_PASSWORD || '';
  }
}

// Database configuration
const isLocalDev = process.env.NODE_ENV === 'development' || !process.env.DB_HOST;
const dbHost = process.env.DB_HOST || (isLocalDev ? 'localhost' : `/cloudsql/${projectId}:us-west1:${process.env.DB_INSTANCE_NAME || 'leanworks-prod'}`);
const dbPort = parseInt(process.env.DB_PORT || '5432');

const orgSlug = process.argv[2] || 'leanworksai_mj6bu7m8';
const dbName = `org_${orgSlug}`;

async function listDocs(password: string) {
  const pool = new Pool({
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: dbName,
    user: 'postgres',
    password: password,
    ssl: false,
  });

  try {
    const result = await pool.query(`
      SELECT id, title, doc_type, processing_status, 
             LENGTH(content) as content_length,
             created_at
      FROM docs
      ORDER BY created_at DESC
      LIMIT 20
    `);

    console.log(`\n📄 Documents in ${orgSlug}:`);
    console.log('='.repeat(80));
    result.rows.forEach(doc => {
      console.log(`ID: ${doc.id}`);
      console.log(`Title: ${doc.title}`);
      console.log(`Type: ${doc.doc_type} | Status: ${doc.processing_status}`);
      console.log(`Content Length: ${doc.content_length} chars`);
      console.log(`Created: ${doc.created_at}`);
      console.log('-'.repeat(80));
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

async function main() {
  try {
    const password = await getPostgresPassword();
    await listDocs(password);
  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();
