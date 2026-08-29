/**
 * Check migration status for a specific organization
 */

import { Pool } from 'pg';
import { existsSync, readFileSync } from 'fs';
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
const orgSlug = process.argv[2];
if (!orgSlug) {
  console.error('❌ Please provide an organization slug as an argument');
  console.error('Usage: npm run tsx scripts/check-migration-status.ts <org-slug>');
  process.exit(1);
}

const dbName = `org_${orgSlug}`;

async function checkMigrationStatus(password: string) {
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
    console.log(`Database: ${dbHost}:${dbPort}/${dbName}`);

    // Check if doc_type column exists
    const columnResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'docs'
      AND column_name IN ('doc_type', 'file_metadata', 'storage_path', 'processing_status', 'file_size', 'mime_type')
      ORDER BY column_name
    `);

    console.log('\n📊 Migration Status:');
    console.log('='.repeat(50));

    const columns = columnResult.rows;
    const expectedColumns = ['doc_type', 'file_metadata', 'storage_path', 'processing_status', 'file_size', 'mime_type'];

    expectedColumns.forEach(colName => {
      const column = columns.find(c => c.column_name === colName);
      if (column) {
        console.log(`✅ ${colName}: ${column.data_type} ${column.is_nullable === 'YES' ? '(nullable)' : '(not null)'}`);
      } else {
        console.log(`❌ ${colName}: MISSING`);
      }
    });

    // Check constraints
    console.log('\n🔒 Constraints:');
    const constraintResult = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) as definition
      FROM pg_constraint
      WHERE conrelid = 'docs'::regclass
      AND conname LIKE '%doc_type%' OR conname LIKE '%processing_status%'
    `);

    constraintResult.rows.forEach(constraint => {
      console.log(`✅ ${constraint.conname}: ${constraint.definition}`);
    });

    // Check indexes
    console.log('\n📈 Indexes:');
    const indexResult = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'docs'
      AND indexname LIKE '%doc_type%' OR indexname LIKE '%processing_status%' OR indexname LIKE '%file_metadata%'
    `);

    indexResult.rows.forEach(index => {
      console.log(`✅ ${index.indexname}`);
    });

    // Count documents
    const countResult = await pool.query('SELECT COUNT(*) as doc_count FROM docs');
    console.log(`\n📄 Total documents: ${countResult.rows[0].doc_count}`);

    const migrated = columns.length === expectedColumns.length;
    console.log(`\n🎯 Migration Status: ${migrated ? '✅ COMPLETE' : '❌ INCOMPLETE'}`);

  } catch (error: any) {
    console.error('❌ Error checking migration status:', error.message);

    // Try to connect to database to see if it exists
    try {
      await pool.query('SELECT 1');
      console.log('✅ Database connection successful');
    } catch (dbError: any) {
      console.error('❌ Database connection failed:', dbError.message);
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  console.log('🚀 Checking migration status...\n');

  try {
    const password = await getPostgresPassword();
    if (!password) {
      throw new Error('Failed to get database password');
    }

    await checkMigrationStatus(password);
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();
