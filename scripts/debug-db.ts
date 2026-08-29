/**
 * Debug database connection and check columns
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
const dbHost = process.env.DB_HOST || (isLocalDev ? 'localhost' : `/cloudsql/${projectId}:us-west1:leanworks-prod`);
const dbPort = parseInt(process.env.DB_PORT || '5432');

// Get org slug from command line arguments
const orgSlug = process.argv[2] || 'leanworksai_mj6bu7m8'; // Default to leanworks.ai
const dbName = `org_${orgSlug}`;

async function debugDatabase(password: string) {
  console.log(`🔍 Debugging database: ${orgSlug} (${dbName})`);
  console.log(`Database: ${dbHost}:${dbPort}/${dbName}`);

  const pool = new Pool({
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: dbName,
    user: 'postgres',
    password: password,
    ssl: false,
  });

  try {
    // Test basic connection
    console.log('\n🔌 Testing database connection...');
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful');

    // Check if docs table exists
    console.log('\n📊 Checking docs table...');
    const tableResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'docs'
      AND table_schema = 'public'
    `);

    if (tableResult.rows.length === 0) {
      console.log('❌ docs table does not exist');
      return;
    }
    console.log('✅ docs table exists');

    // Check columns
    console.log('\n📋 Checking docs table columns...');
    const columnResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'docs'
      ORDER BY ordinal_position
    `);

    console.log('Current columns:');
    columnResult.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'YES' ? '(nullable)' : '(not null)'}`);
    });

    // Specifically check for doc_type
    const docTypeColumn = columnResult.rows.find(c => c.column_name === 'doc_type');
    if (docTypeColumn) {
      console.log('\n✅ doc_type column exists');
    } else {
      console.log('\n❌ doc_type column is MISSING');
    }

    // Try the exact queries that are failing in the API
    console.log('\n🧪 Testing the failing API queries...');

    // Test 1: GET /api/docs/:id/presentation query
    try {
      const testResult1 = await pool.query(
        `SELECT content FROM docs WHERE id = 'test-id' AND doc_type = 'pptx'`,
        []
      );
      console.log('✅ GET presentation query works (no rows returned as expected)');
    } catch (queryError: any) {
      console.log('❌ GET presentation query fails:', queryError.message);
    }

    // Test 2: PUT /api/docs/:id/presentation query
    try {
      const testResult2 = await pool.query(
        `UPDATE docs SET content = $1, updated_at = NOW() WHERE id = 'test-id' AND doc_type = 'pptx'`,
        ['test-content']
      );
      console.log('✅ PUT presentation query works (no rows affected as expected)');
    } catch (queryError: any) {
      console.log('❌ PUT presentation query fails:', queryError.message);
    }

    // Test 3: POST /api/docs/:id/export-pptx query
    try {
      const testResult3 = await pool.query(
        `SELECT content, title, owner_email FROM docs WHERE id = 'test-id' AND doc_type = 'pptx'`,
        []
      );
      console.log('✅ POST export-pptx query works (no rows returned as expected)');
    } catch (queryError: any) {
      console.log('❌ POST export-pptx query fails:', queryError.message);
    }

  } catch (error: any) {
    console.error('❌ Database error:', error.message);
  } finally {
    await pool.end();
  }
}

async function main() {
  console.log('🚀 Database debugging...\n');

  try {
    const password = await getPostgresPassword();
    if (!password) {
      throw new Error('Failed to get database password');
    }

    await debugDatabase(password);
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();
