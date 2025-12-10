/**
 * Migration: Add transcription_sessions and transcription_chunks tables
 * Run with: npx tsx database/migrate-transcription-tables.ts
 */

import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { getOrgPoolBySlug, getSharedPool } from './multi-tenant-pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file if it exists
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

const secretManagerClient = new SecretManagerServiceClient({
  keyFilename: serviceAccountPath,
});

const projectId = serviceAccount.project_id;
const instanceName = 'leanworks-prod';
const region = process.env.DB_REGION || 'us-west1';

async function getPostgresPassword(): Promise<string> {
  try {
    const secretName = `projects/${projectId}/secrets/postgresdb-password/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
    const password = (version.payload?.data?.toString() || '').trim();
    if (!password) {
      throw new Error('Password from Secret Manager is empty');
    }
    return password;
  } catch (error: any) {
    console.error('❌ Failed to get PostgreSQL password from Secret Manager:', error.message);
    throw error;
  }
}

async function runMigrationForOrg(orgSlug: string): Promise<void> {
  console.log(`\n📝 Running migration for org: ${orgSlug}`);
  
  try {
    const pool = await getOrgPoolBySlug(orgSlug);
    const migrationSQL = readFileSync(
      join(__dirname, 'migrations/add-transcription-sessions.sql'),
      'utf8'
    );
    
    await pool.query(migrationSQL);
    console.log(`✅ Migration completed for org: ${orgSlug}`);
  } catch (error: any) {
    console.error(`❌ Error migrating org ${orgSlug}:`, error.message);
    throw error;
  }
}

async function getAllOrgSlugs(): Promise<string[]> {
  const sharedPool = await getSharedPool();
  const result = await sharedPool.query('SELECT slug FROM organizations ORDER BY slug');
  return result.rows.map(row => row.slug);
}

async function runMigration(): Promise<void> {
  console.log('🚀 Starting transcription tables migration...');
  console.log('='.repeat(60));
  
  try {
    // Get all organizations
    const orgSlugs = await getAllOrgSlugs();
    console.log(`\n📋 Found ${orgSlugs.length} organization(s) to migrate:`);
    orgSlugs.forEach((slug, i) => console.log(`   ${i + 1}. ${slug}`));
    
    if (orgSlugs.length === 0) {
      console.log('\n⚠️  No organizations found!');
      return;
    }
    
    // Migrate each organization
    for (const orgSlug of orgSlugs) {
      await runMigrationForOrg(orgSlug);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Transcription tables migration completed successfully!');
    console.log('='.repeat(60));
    console.log(`\n📊 Summary:`);
    console.log(`   Organizations migrated: ${orgSlugs.length}`);
    console.log(`\n📝 Tables created:`);
    console.log(`   - transcription_sessions`);
    console.log(`   - transcription_chunks`);
    
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();

