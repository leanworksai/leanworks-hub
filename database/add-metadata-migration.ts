/**
 * Migration script to add metadata column to docs table
 * Run this with: npx tsx database/add-metadata-migration.ts
 */

import { getOrgPool, getSharedPool } from './multi-tenant-pool.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function addMetadataColumn(pool: any, dbName: string) {
  try {
    // Check if column exists
    const checkResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'docs' 
      AND column_name = 'metadata'
    `);

    if (checkResult.rows.length > 0) {
      console.log(`✅ metadata column already exists in ${dbName}`);
      return;
    }

    // Add the column
    await pool.query(`
      ALTER TABLE docs ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb
    `);

    console.log(`✅ Added metadata column to docs table in ${dbName}`);
  } catch (error: any) {
    console.error(`❌ Error adding metadata column to ${dbName}:`, error.message);
    throw error;
  }
}

async function migrateAllDatabases() {
  try {
    // Get shared pool to list all orgs
    const sharedPool = await getSharedPool();
    
    // Get all organizations
    const orgsResult = await sharedPool.query(`
      SELECT id, slug FROM organizations
    `);

    console.log(`📋 Found ${orgsResult.rows.length} organizations to migrate\n`);

    // Migrate each org database
    for (const org of orgsResult.rows) {
      try {
        const pool = await getOrgPool(org.id);
        await addMetadataColumn(pool, `org_${org.slug}`);
      } catch (error: any) {
        console.error(`⚠️  Failed to migrate org ${org.slug}:`, error.message);
        // Continue with other orgs
      }
    }

    console.log('\n✅ Migration completed!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateAllDatabases()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Migration error:', error);
    process.exit(1);
  });

