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
 *   npm run db:migrate -- --dev              # Run against dev (default)
 *   npm run db:migrate -- --prod             # Run against prod
 *   npm run db:migrate:dry-run -- --dev      # Dry run, dev
 *   npm run db:migrate:dry-run -- --prod     # Dry run, prod
 *
 * Options:
 *   --dev, -D    Use dev DB (dev-postgresdb-password, localhost)
 *   --prod, -P   Use prod DB (postgresdb-password, Cloud SQL or DB_HOST)
 *   --dry-run, -d  Do not apply migrations, only list what would be done
 *
 * For prod: set DB_HOST=localhost when using Cloud SQL Proxy; otherwise uses Unix socket.
 */

import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { getGoogleCloudConfig } from '../server/utils/google-cloud.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse --dev / --prod (explicit target environment)
const hasDev = process.argv.includes('--dev') || process.argv.includes('-D');
const hasProd = process.argv.includes('--prod') || process.argv.includes('-P');
let TARGET_ENV: 'dev' | 'prod' = 'dev';
if (hasDev && hasProd) {
  console.error('❌ Use only one of --dev or --prod.');
  process.exit(1);
}
if (hasProd) TARGET_ENV = 'prod';
if (hasDev) TARGET_ENV = 'dev';

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

// Resolve paths and names from --dev / --prod
const secretNameForPassword = TARGET_ENV === 'dev' ? 'dev-postgresdb-password' : 'postgresdb-password';
const defaultInstanceName = TARGET_ENV === 'dev' ? 'leanworks-dev' : 'leanworks-prod';
const dbRegion = process.env.DB_REGION || 'us-west1';

process.env.ENVIRONMENT = TARGET_ENV;
const { projectId } = getGoogleCloudConfig(join(__dirname, '..'));

const secretManagerClient = new SecretManagerServiceClient({
  projectId,
});

async function getPostgresPassword(): Promise<string> {
  try {
    const fullSecretName = `projects/${projectId}/secrets/${secretNameForPassword}/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name: fullSecretName });
    const password = (version.payload?.data?.toString() || '').trim();
    console.log(`✅ PostgreSQL password fetched from Secret Manager (${secretNameForPassword})`);
    return password;
  } catch (error) {
    console.error('❌ Failed to fetch password from Secret Manager:', error);
    return process.env.DB_PASSWORD || '';
  }
}

// Database connection: DB_HOST overrides; else dev=localhost, prod=Unix socket
const dbHost =
  process.env.DB_HOST ||
  (TARGET_ENV === 'dev'
    ? 'localhost'
    : `/cloudsql/${projectId}:${dbRegion}:${process.env.DB_INSTANCE_NAME || defaultInstanceName}`);
const dbPort = parseInt(process.env.DB_PORT || '5432', 10);

// Read migration SQL files
const folderMigrationSQL = readFileSync(
  join(__dirname, '../database/migrations/add-folder-support.sql'),
  'utf8'
);

const documentUploadMigrationSQL = readFileSync(
  join(__dirname, '../database/migrations/add-document-upload-support.sql'),
  'utf8'
);

const plansMigrationSQL = readFileSync(
  join(__dirname, '../database/migrations/add-plans-tables.sql'),
  'utf8'
);

const aiAgentsMigrationSQL = readFileSync(
  join(__dirname, '../database/migrations/add-ai-agents-tables.sql'),
  'utf8'
);

const plansAiSummaryMigrationSQL = readFileSync(
  join(__dirname, '../database/migrations/add-plans-ai-summary.sql'),
  'utf8'
);

const skillMdAndRoutingLogMigrationSQL = readFileSync(
  join(__dirname, '../database/migrations/add-skill-md-and-routing-log.sql'),
  'utf8'
);

// Combine migrations
const migrationSQL =
  folderMigrationSQL +
  '\n' +
  documentUploadMigrationSQL +
  '\n' +
  plansMigrationSQL +
  '\n' +
  aiAgentsMigrationSQL +
  '\n' +
  plansAiSummaryMigrationSQL +
  '\n' +
  skillMdAndRoutingLogMigrationSQL;

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
 * Check if migration has already been run (including plans AI summary, ai_agents, and skill_md / lean_routing_log)
 */
async function checkMigrationStatus(pool: Pool): Promise<boolean> {
  try {
    const docTypeResult = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'docs'
      AND column_name = 'doc_type'
    `);
    const plansTableResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'plans'
    `);
    const plansAiSummaryResult = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'plans'
      AND column_name = 'ai_quick_insight'
    `);
    const aiAgentsTableResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'ai_agents'
    `);
    const skillMdColumnResult = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'ai_agents'
      AND column_name = 'skill_md'
    `);
    const leanRoutingLogTableResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'lean_routing_log'
    `);
    return (
      docTypeResult.rows.length > 0 &&
      plansTableResult.rows.length > 0 &&
      plansAiSummaryResult.rows.length > 0 &&
      aiAgentsTableResult.rows.length > 0 &&
      skillMdColumnResult.rows.length > 0 &&
      leanRoutingLogTableResult.rows.length > 0
    );
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

  console.log(`🚀 Starting database migration for all organizations (target: ${TARGET_ENV})...\n`);
  console.log('Database Configuration:');
  console.log(`  Target: ${TARGET_ENV}`);
  console.log('  Authentication: Application Default Credentials');
  console.log(`  Host: ${dbHost}`);
  console.log(`  Port: ${dbHost.startsWith('/') ? 'Unix socket' : dbPort}`);
  console.log(`  User: postgres`);
  if (TARGET_ENV === 'prod' && dbHost.startsWith('/cloudsql/')) {
    console.log('\n  💡 To run against prod from your machine, use Cloud SQL Proxy and set:');
    console.log('     DB_HOST=localhost DB_PORT=5432 npm run db:migrate:prod');
  }
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
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error?.message || error);
    const addr = error?.address ?? '';
    if (addr.includes('/cloudsql/') && (error?.code === 'ENOENT' || error?.errno === -2)) {
      const instance = process.env.DB_INSTANCE_NAME || defaultInstanceName;
      console.error('\n💡 The Cloud SQL Unix socket only exists inside GCP. To run against prod locally:');
      console.error(`   1. Start Cloud SQL Proxy: cloud_sql_proxy -instances=${projectId}:${dbRegion}:${instance}=tcp:5432`);
      console.error('   2. Run: DB_HOST=localhost DB_PORT=5432 npm run db:migrate:prod');
      console.error('   Or set DB_HOST=localhost and DB_PORT=5432 in .env and run npm run db:migrate:prod');
    }
    process.exit(1);
  }
}

// Run main function
main();
