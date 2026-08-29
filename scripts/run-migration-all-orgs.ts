/**
 * Run Database Migration on All Org Databases
 * 
 * This script:
 * 1. Connects to the shared database
 * 2. Lists all organizations
 * 3. Runs the migration on each org database
 * 4. Reports success/failure for each
 * 
 * Usage:
 *   npm run db:migrate:dry-run  # Dry run (no changes)
 *   npm run db:migrate          # Run migration
 */

import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { getGoogleCloudConfig } from '../server/utils/google-cloud.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check for dry-run flag
const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('-d');

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

// Read migration SQL
const migrationSQL = readFileSync(
  join(__dirname, '../database/migrations/add-document-upload-support.sql'),
  'utf8'
);

interface Organization {
  id: string;
  name: string;
  slug: string;
}

interface MigrationResult {
  orgSlug: string;
  orgName: string;
  success: boolean;
  skipped?: boolean;
  error?: string;
  duration?: number;
}

/**
 * Get list of all organizations from shared database
 */
async function getOrganizations(password: string): Promise<Organization[]> {
  const pool = new Pool({
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: 'shared',
    user: 'postgres',
    password: password,
    ssl: false,
  });

  try {
    console.log('📋 Fetching list of organizations from shared database...');
    const result = await pool.query(
      'SELECT id, name, slug FROM organizations ORDER BY created_at ASC'
    );
    
    console.log(`✅ Found ${result.rows.length} organizations`);
    return result.rows;
  } catch (error) {
    console.error('❌ Error fetching organizations:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

/**
 * Check if migration has already been run
 */
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

/**
 * Run migration on a single org database
 */
async function runMigrationForOrg(org: Organization, password: string): Promise<MigrationResult> {
  const dbName = `org_${org.slug}`;
  const pool = new Pool({
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: dbName,
    user: 'postgres',
    password: password,
    ssl: false,
  });

  const startTime = Date.now();

  try {
    // Check if migration already run
    const alreadyMigrated = await checkMigrationStatus(pool);
    
    if (alreadyMigrated) {
      console.log(`⏭️  Skipping ${org.name} (${dbName}) - already migrated`);
      return {
        orgSlug: org.slug,
        orgName: org.name,
        success: true,
        skipped: true,
        duration: Date.now() - startTime,
      };
    }

    if (DRY_RUN) {
      console.log(`🔍 [DRY RUN] Would migrate: ${org.name} (${dbName})`);
      return {
        orgSlug: org.slug,
        orgName: org.name,
        success: true,
        duration: Date.now() - startTime,
      };
    }

    console.log(`\n🔄 Running migration for: ${org.name} (${dbName})`);
    
    // Run migration
    await pool.query(migrationSQL);
    
    const duration = Date.now() - startTime;
    console.log(`✅ Migration completed for ${org.name} in ${duration}ms`);
    
    return {
      orgSlug: org.slug,
      orgName: org.name,
      success: true,
      duration,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`❌ Migration failed for ${org.name}:`, error.message);
    
    return {
      orgSlug: org.slug,
      orgName: org.name,
      success: false,
      error: error.message,
      duration,
    };
  } finally {
    await pool.end();
  }
}

/**
 * Main function
 */
async function main() {
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  console.log('🚀 Starting database migration for all organizations...\n');
  console.log('Database Configuration:');
  console.log(`  Host: ${dbHost}`);
  console.log(`  Port: ${dbHost.startsWith('/') ? 'Unix socket' : dbPort}`);
  console.log(`  User: postgres`);
  console.log('');

  try {
    // Get password from Secret Manager
    const password = await getPostgresPassword();
    
    if (!password) {
      throw new Error('Failed to get database password');
    }

    // Get all organizations
    const organizations = await getOrganizations(password);
    
    if (organizations.length === 0) {
      console.log('⚠️  No organizations found. Nothing to migrate.');
      return;
    }

    // Run migrations
    const results: MigrationResult[] = [];
    
    for (const org of organizations) {
      const result = await runMigrationForOrg(org, password);
      results.push(result);
      
      // Small delay between migrations to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(80));
    
    if (DRY_RUN) {
      console.log('\n🔍 DRY RUN - No changes were made');
    }
    
    const successful = results.filter(r => r.success && !r.skipped);
    const skipped = results.filter(r => r.skipped);
    const failed = results.filter(r => !r.success);
    
    if (successful.length > 0) {
      console.log(`\n✅ ${DRY_RUN ? 'Would migrate' : 'Migrated'}: ${successful.length}/${results.length}`);
      successful.forEach(r => {
        console.log(`   - ${r.orgName} (${r.orgSlug}) - ${r.duration}ms`);
      });
    }
    
    if (skipped.length > 0) {
      console.log(`\n⏭️  Skipped (already migrated): ${skipped.length}/${results.length}`);
      skipped.forEach(r => {
        console.log(`   - ${r.orgName} (${r.orgSlug})`);
      });
    }
    
    if (failed.length > 0) {
      console.log(`\n❌ Failed: ${failed.length}/${results.length}`);
      failed.forEach(r => {
        console.log(`   - ${r.orgName} (${r.orgSlug})`);
        console.log(`     Error: ${r.error}`);
      });
    }
    
    const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);
    console.log(`\n⏱️  Total time: ${totalDuration}ms (${(totalDuration / 1000).toFixed(2)}s)`);
    
    console.log('\n' + '='.repeat(80));
    
    if (DRY_RUN) {
      console.log('\n💡 To run the actual migration, use: npm run db:migrate');
      process.exit(0);
    } else if (failed.length > 0) {
      console.log('\n⚠️  Some migrations failed. Please review the errors above.');
      process.exit(1);
    } else {
      console.log('\n🎉 All migrations completed successfully!');
      process.exit(0);
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run main function
main();
