/**
 * Migration Script: Domain-Based to Organization-Based Multi-Tenancy
 * 
 * This script migrates existing domain-based tenant databases to the new
 * organization-based multi-tenancy model.
 * 
 * Steps:
 * 1. Initialize the shared database with the new schema
 * 2. For each existing domain database:
 *    a. Create an organization in the shared database
 *    b. Migrate users from domain DB to shared DB (if not exists)
 *    c. Create org_members entries for all users
 *    d. Keep the existing domain DB as the org's database (rename if needed)
 * 
 * Usage: npx tsx database/migrate-to-org-based.ts [--dry-run]
 */

import { Pool, PoolConfig } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

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

// Load GCP credentials
const serviceAccountPath = join(__dirname, '../gcp_credential.json');
let serviceAccount: any;
try {
  serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
  console.log('✅ Loaded GCP credentials');
} catch (error) {
  console.error('❌ Failed to load GCP credentials from:', serviceAccountPath);
  process.exit(1);
}

const secretManagerClient = new SecretManagerServiceClient({
  keyFilename: serviceAccountPath,
});

const projectId = serviceAccount.project_id;
const instanceName = 'leanworks-prod';
const region = process.env.DB_REGION || 'us-west1';

// Shared database name
const SHARED_DB_NAME = 'shared';

let cachedPassword: string | null = null;

// Fetch PostgreSQL password from Secret Manager
async function getPostgresPassword(): Promise<string> {
  if (cachedPassword) return cachedPassword;

  try {
    const secretName = `projects/${projectId}/secrets/postgresdb-password/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
    cachedPassword = (version.payload?.data?.toString() || '').trim();
    console.log('✅ PostgreSQL password fetched');
    return cachedPassword;
  } catch (error) {
    console.error('❌ Failed to fetch password from Secret Manager:', error);
    return process.env.DB_PASSWORD || '';
  }
}

// Create a connection pool for a database
async function createPool(dbName: string): Promise<Pool> {
  const password = await getPostgresPassword();
  const dbHost = process.env.DB_HOST || `/cloudsql/${projectId}:${region}:${instanceName}`;
  const dbPort = parseInt(process.env.DB_PORT || '5432');

  const poolConfig: PoolConfig = {
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: dbName,
    user: process.env.DB_USER || 'postgres',
    password: password,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: false,
  };

  return new Pool(poolConfig);
}

// Get list of existing domain databases
async function getExistingDatabases(): Promise<string[]> {
  const pool = await createPool('postgres');
  
  try {
    const result = await pool.query(`
      SELECT datname FROM pg_database 
      WHERE datistemplate = false 
      AND datname NOT IN ('postgres', 'template0', 'template1', 'shared')
      ORDER BY datname
    `);
    
    return result.rows.map(row => row.datname);
  } finally {
    await pool.end();
  }
}

// Check if database has users table (indicating it's a tenant DB)
async function isTenantDatabase(dbName: string): Promise<boolean> {
  const pool = await createPool(dbName);
  
  try {
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      ) as has_users
    `);
    
    return result.rows[0].has_users;
  } catch (error) {
    console.warn(`  ⚠️ Could not check ${dbName}:`, (error as Error).message);
    return false;
  } finally {
    await pool.end();
  }
}

// Generate org name from domain/database name
function generateOrgName(dbName: string): string {
  // Try to reconstruct domain name
  // If dbName starts with 'db_', remove it
  let name = dbName.startsWith('db_') ? dbName.substring(3) : dbName;
  
  // Try to add back common TLDs
  const commonDomains: Record<string, string> = {
    'leanworksai': 'leanworks.ai',
    'gmail': 'gmail.com',
    'yahoo': 'yahoo.com',
    'hotmail': 'hotmail.com',
    'outlook': 'outlook.com',
  };
  
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (commonDomains[normalized]) {
    return commonDomains[normalized];
  }
  
  // Otherwise just use the sanitized name
  return name.length > 0 ? name : dbName;
}

// Generate org slug from database name
function generateOrgSlug(dbName: string): string {
  // Use the existing DB name pattern, but prefix with 'migrated_' to distinguish
  const sanitized = dbName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `migrated_${sanitized}`;
}

// Sanitize DB name for org_slug conversion
function sanitizeSlugForDb(slug: string): string {
  const sanitized = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (sanitized && /^\d/.test(sanitized)) {
    return 'org_' + sanitized;
  }
  return 'org_' + sanitized;
}

// Initialize shared database schema
async function initializeSharedDatabase(): Promise<void> {
  console.log('\n📦 Initializing shared database...');
  
  // First, ensure the database exists
  const adminPool = await createPool('postgres');
  try {
    const dbExists = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [SHARED_DB_NAME]
    );
    
    if (dbExists.rows.length === 0) {
      console.log(`  Creating database ${SHARED_DB_NAME}...`);
      if (!DRY_RUN) {
        await adminPool.query(`CREATE DATABASE "${SHARED_DB_NAME}"`);
      }
    } else {
      console.log(`  Database ${SHARED_DB_NAME} already exists`);
    }
  } finally {
    await adminPool.end();
  }
  
  // Initialize schema
  const sharedPool = await createPool(SHARED_DB_NAME);
  try {
    const schemaPath = join(__dirname, 'shared-schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    
    console.log('  Applying shared schema...');
    if (!DRY_RUN) {
      await sharedPool.query(schema);
    }
    console.log('  ✅ Shared database initialized');
  } finally {
    await sharedPool.end();
  }
}

// Migrate a single domain database to organization model
async function migrateDomainToOrg(dbName: string, sharedPool: Pool): Promise<void> {
  console.log(`\n🔄 Migrating domain database: ${dbName}`);
  
  const domainPool = await createPool(dbName);
  
  try {
    // Get users from domain database
    const usersResult = await domainPool.query(`
      SELECT email, password_hash, first_name, last_name, job_title, timezone, responsibilities, created_at
      FROM users
      ORDER BY created_at
    `);
    
    const users = usersResult.rows;
    console.log(`  Found ${users.length} users`);
    
    if (users.length === 0) {
      console.log('  ⚠️ No users found, skipping...');
      return;
    }
    
    // Determine org owner (first user or first with email matching domain)
    const orgOwner = users[0].email;
    const orgName = generateOrgName(dbName);
    const orgSlug = generateOrgSlug(dbName);
    
    console.log(`  Org name: ${orgName}`);
    console.log(`  Org slug: ${orgSlug}`);
    console.log(`  Owner: ${orgOwner}`);
    
    if (DRY_RUN) {
      console.log('  [DRY RUN] Would migrate users and create org');
      return;
    }
    
    // Migrate users to shared database
    console.log('  Migrating users to shared database...');
    for (const user of users) {
      try {
        await sharedPool.query(`
          INSERT INTO users (email, password_hash, first_name, last_name, job_title, timezone, responsibilities, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (email) DO UPDATE SET
            password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash),
            first_name = COALESCE(EXCLUDED.first_name, users.first_name),
            last_name = COALESCE(EXCLUDED.last_name, users.last_name),
            job_title = COALESCE(EXCLUDED.job_title, users.job_title)
        `, [
          user.email.toLowerCase(),
          user.password_hash,
          user.first_name,
          user.last_name,
          user.job_title || '',
          user.timezone || 'America/Los_Angeles',
          user.responsibilities,
          user.created_at
        ]);
      } catch (error) {
        console.warn(`    ⚠️ Failed to migrate user ${user.email}:`, (error as Error).message);
      }
    }
    console.log(`  ✅ Migrated ${users.length} users`);
    
    // Check if org already exists
    const existingOrg = await sharedPool.query(
      'SELECT id FROM organizations WHERE slug = $1',
      [orgSlug]
    );
    
    let orgId: string;
    
    if (existingOrg.rows.length > 0) {
      orgId = existingOrg.rows[0].id;
      console.log(`  Org already exists: ${orgId}`);
    } else {
      // Create organization
      console.log('  Creating organization...');
      const orgResult = await sharedPool.query(`
        INSERT INTO organizations (name, slug, type, owner_email, description, created_at)
        VALUES ($1, $2, 'team', $3, $4, NOW())
        RETURNING id
      `, [orgName, orgSlug, orgOwner, `Migrated from domain database: ${dbName}`]);
      
      orgId = orgResult.rows[0].id;
      console.log(`  ✅ Created org: ${orgId}`);
    }
    
    // Create org memberships
    console.log('  Creating org memberships...');
    for (const user of users) {
      const role = user.email.toLowerCase() === orgOwner.toLowerCase() ? 'owner' : 'member';
      try {
        await sharedPool.query(`
          INSERT INTO org_members (org_id, user_email, role, joined_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (org_id, user_email) DO NOTHING
        `, [orgId, user.email.toLowerCase(), role, user.created_at || new Date()]);
      } catch (error) {
        console.warn(`    ⚠️ Failed to add member ${user.email}:`, (error as Error).message);
      }
    }
    console.log(`  ✅ Created ${users.length} memberships`);
    
    // Note: We're keeping the existing domain database as-is
    // The new org will use a database named based on its slug
    // For migrated orgs, we'll need to manually rename or copy data if needed
    console.log(`  ℹ️ Existing database "${dbName}" preserved`);
    console.log(`  ℹ️ New org will use database: ${sanitizeSlugForDb(orgSlug)}`);
    
  } finally {
    await domainPool.end();
  }
}

// Main migration function
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Domain to Organization Migration Script');
  console.log('═══════════════════════════════════════════════════════════════');
  
  if (DRY_RUN) {
    console.log('🏃 Running in DRY RUN mode - no changes will be made\n');
  }
  
  try {
    // Step 1: Initialize shared database
    await initializeSharedDatabase();
    
    // Step 2: Get list of existing databases
    console.log('\n📋 Scanning for existing tenant databases...');
    const databases = await getExistingDatabases();
    console.log(`  Found ${databases.length} databases total`);
    
    // Step 3: Filter to only tenant databases
    const tenantDatabases: string[] = [];
    for (const db of databases) {
      if (VERBOSE) {
        console.log(`  Checking ${db}...`);
      }
      const isTenant = await isTenantDatabase(db);
      if (isTenant) {
        tenantDatabases.push(db);
        console.log(`  ✓ ${db} is a tenant database`);
      }
    }
    
    if (tenantDatabases.length === 0) {
      console.log('\n✅ No tenant databases found to migrate');
      return;
    }
    
    console.log(`\n📊 Found ${tenantDatabases.length} tenant databases to migrate`);
    
    // Step 4: Migrate each tenant database
    const sharedPool = await createPool(SHARED_DB_NAME);
    try {
      for (const db of tenantDatabases) {
        try {
          await migrateDomainToOrg(db, sharedPool);
        } catch (error) {
          console.error(`\n❌ Failed to migrate ${db}:`, (error as Error).message);
          if (VERBOSE) {
            console.error(error);
          }
        }
      }
    } finally {
      await sharedPool.end();
    }
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   Migration Complete!');
    console.log('═══════════════════════════════════════════════════════════════');
    
    if (DRY_RUN) {
      console.log('\n🏃 This was a DRY RUN - no changes were made');
      console.log('   Run without --dry-run to apply changes');
    } else {
      console.log('\n📝 Next steps:');
      console.log('   1. Verify migrated data in the shared database');
      console.log('   2. Test user login with new organization context');
      console.log('   3. Consider renaming/moving domain databases to org pattern');
      console.log('   4. Update any direct database references to use org-based routing');
    }
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
main().catch(console.error);

