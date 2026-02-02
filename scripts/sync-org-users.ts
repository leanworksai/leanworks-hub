/**
 * Sync Users from Shared Database to Org-Specific Databases
 * 
 * This script:
 * 1. Connects to the shared database and gets all org_members
 * 2. For each org, gets the org-specific database connection
 * 3. Inserts missing users into the org-specific users table
 * 4. Handles errors gracefully and logs progress
 * 
 * Usage:
 *   npm run db:sync-users:dry-run  # Dry run (no changes)
 *   npm run db:sync-users          # Run sync
 */

import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { getCredentialPath, getSecretName } from '../server/utils/env.js';

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

// Read GCP credentials
const serviceAccountPath = join(__dirname, '../', getCredentialPath());
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
const projectId = serviceAccount.project_id;

// Initialize Secret Manager client
const secretManagerClient = new SecretManagerServiceClient({
  keyFilename: serviceAccountPath,
});

// Fetch PostgreSQL password from Secret Manager
async function getPostgresPassword(): Promise<string> {
  try {
    const secretName = `projects/${projectId}/secrets/${getSecretName('postgresdb-password')}/versions/latest`;
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

interface Organization {
  id: string;
  name: string;
  slug: string;
}

interface OrgMember {
  org_id: string;
  user_email: string;
  role: string;
  joined_at: Date;
  first_name: string;
  last_name: string;
  job_title: string | null;
  responsibilities: string | null;
  timezone: string;
}

interface SyncResult {
  orgSlug: string;
  orgName: string;
  success: boolean;
  usersAdded: number;
  usersSkipped: number;
  error?: string;
  duration?: number;
}

/**
 * Get list of all organizations from shared database
 */
async function getOrganizations(sharedPool: Pool): Promise<Organization[]> {
  try {
    console.log('📋 Fetching list of organizations from shared database...');
    const result = await sharedPool.query(
      'SELECT id, name, slug FROM organizations ORDER BY created_at ASC'
    );
    
    console.log(`✅ Found ${result.rows.length} organizations`);
    return result.rows;
  } catch (error) {
    console.error('❌ Error fetching organizations:', error);
    throw error;
  }
}

/**
 * Get all org members with their profile data from shared database
 */
async function getOrgMembers(sharedPool: Pool): Promise<OrgMember[]> {
  try {
    console.log('📋 Fetching org members from shared database...');
    const result = await sharedPool.query(`
      SELECT 
        om.org_id,
        om.user_email,
        om.role,
        om.joined_at,
        u.first_name,
        u.last_name,
        u.job_title,
        u.responsibilities,
        u.timezone
      FROM org_members om
      JOIN users u ON om.user_email = u.email
      ORDER BY om.org_id, om.user_email
    `);
    
    console.log(`✅ Found ${result.rows.length} org members`);
    return result.rows;
  } catch (error) {
    console.error('❌ Error fetching org members:', error);
    throw error;
  }
}

/**
 * Get existing users in org-specific database
 */
async function getExistingUsers(orgPool: Pool): Promise<Set<string>> {
  try {
    const result = await orgPool.query('SELECT email FROM users');
    return new Set(result.rows.map(row => row.email));
  } catch (error) {
    console.error('❌ Error fetching existing users:', error);
    throw error;
  }
}

/**
 * Sync users for a single organization
 */
async function syncUsersForOrg(
  org: Organization,
  members: OrgMember[],
  password: string
): Promise<SyncResult> {
  const dbName = `org_${org.slug}`;
  const orgPool = new Pool({
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: dbName,
    user: 'postgres',
    password: password,
    ssl: false,
  });

  const startTime = Date.now();

  try {
    // Get existing users in this org
    const existingUsers = await getExistingUsers(orgPool);
    
    // Filter members that belong to this org and are not already in the org DB
    const orgMembers = members.filter(m => m.org_id === org.id);
    const missingMembers = orgMembers.filter(m => !existingUsers.has(m.user_email));
    
    console.log(`  📊 Total members: ${orgMembers.length}, Existing: ${existingUsers.size}, Missing: ${missingMembers.length}`);

    if (missingMembers.length === 0) {
      const duration = Date.now() - startTime;
      console.log(`  ⏭️  No new users to sync for ${org.name}`);
      return {
        orgSlug: org.slug,
        orgName: org.name,
        success: true,
        usersAdded: 0,
        usersSkipped: orgMembers.length,
        duration,
      };
    }

    if (DRY_RUN) {
      console.log(`  🔍 [DRY RUN] Would add ${missingMembers.length} users to ${org.name}`);
      missingMembers.forEach(m => {
        console.log(`     - ${m.user_email} (${m.first_name} ${m.last_name})`);
      });
      
      const duration = Date.now() - startTime;
      return {
        orgSlug: org.slug,
        orgName: org.name,
        success: true,
        usersAdded: missingMembers.length,
        usersSkipped: existingUsers.size,
        duration,
      };
    }

    // Insert missing users
    let usersAdded = 0;
    for (const member of missingMembers) {
      try {
        await orgPool.query(`
          INSERT INTO users (
            email,
            first_name,
            last_name,
            job_title,
            responsibilities,
            timezone,
            role,
            joined_at,
            status,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', NOW())
          ON CONFLICT (email) DO NOTHING
        `, [
          member.user_email,
          member.first_name,
          member.last_name,
          member.job_title,
          member.responsibilities,
          member.timezone || 'America/Los_Angeles',
          member.role === 'owner' ? 'owner' : 'member',
          member.joined_at,
        ]);
        usersAdded++;
        console.log(`     ✅ Added: ${member.user_email}`);
      } catch (error: any) {
        console.error(`     ❌ Failed to add ${member.user_email}:`, error.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`  ✅ Synced ${usersAdded}/${missingMembers.length} users for ${org.name}`);
    
    return {
      orgSlug: org.slug,
      orgName: org.name,
      success: true,
      usersAdded,
      usersSkipped: existingUsers.size,
      duration,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`  ❌ Sync failed for ${org.name}:`, error.message);
    
    return {
      orgSlug: org.slug,
      orgName: org.name,
      success: false,
      usersAdded: 0,
      usersSkipped: 0,
      error: error.message,
      duration,
    };
  } finally {
    await orgPool.end();
  }
}

/**
 * Main function
 */
async function main() {
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  console.log('🚀 Starting user sync for all organizations...\n');
  console.log('Database Configuration:');
  console.log(`  Host: ${dbHost}`);
  console.log(`  Port: ${dbHost.startsWith('/') ? 'Unix socket' : dbPort}`);
  console.log(`  User: postgres`);
  console.log('');

  let sharedPool: Pool | null = null;

  try {
    // Get password from Secret Manager
    const password = await getPostgresPassword();
    
    if (!password) {
      throw new Error('Failed to get database password');
    }

    // Connect to shared database
    sharedPool = new Pool({
      host: dbHost,
      ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
      database: 'shared',
      user: 'postgres',
      password: password,
      ssl: false,
    });

    // Get all organizations
    const organizations = await getOrganizations(sharedPool);
    
    if (organizations.length === 0) {
      console.log('⚠️  No organizations found. Nothing to sync.');
      return;
    }

    // Get all org members with profile data
    const allMembers = await getOrgMembers(sharedPool);

    // Sync users for each organization
    const results: SyncResult[] = [];
    
    for (const org of organizations) {
      console.log(`\n🔄 Processing: ${org.name} (org_${org.slug})`);
      const result = await syncUsersForOrg(org, allMembers, password);
      results.push(result);
      
      // Small delay between orgs to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 SYNC SUMMARY');
    console.log('='.repeat(80));
    
    if (DRY_RUN) {
      console.log('\n🔍 DRY RUN - No changes were made');
    }
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const totalAdded = results.reduce((sum, r) => sum + r.usersAdded, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.usersSkipped, 0);
    
    console.log(`\n📈 Overall Statistics:`);
    console.log(`   Organizations processed: ${results.length}`);
    console.log(`   Users ${DRY_RUN ? 'would be added' : 'added'}: ${totalAdded}`);
    console.log(`   Users already in orgs: ${totalSkipped}`);
    
    if (successful.length > 0) {
      console.log(`\n✅ Successful: ${successful.length}/${results.length}`);
      successful.forEach(r => {
        const status = r.usersAdded > 0 
          ? `+${r.usersAdded} users` 
          : 'no changes';
        console.log(`   - ${r.orgName} (${r.orgSlug}) - ${status} - ${r.duration}ms`);
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
      console.log('\n💡 To run the actual sync, use: npm run db:sync-users');
      process.exit(0);
    } else if (failed.length > 0) {
      console.log('\n⚠️  Some syncs failed. Please review the errors above.');
      process.exit(1);
    } else {
      console.log('\n🎉 All users synced successfully!');
      process.exit(0);
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  } finally {
    if (sharedPool) {
      await sharedPool.end();
    }
  }
}

// Run main function
main();
