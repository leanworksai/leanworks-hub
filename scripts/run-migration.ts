/**
 * Run a database migration on the shared database
 * Usage: tsx scripts/run-migration.ts <migration-file>
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSharedPool } from '../database/multi-tenant-pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration(migrationFile: string) {
  try {
    const migrationPath = join(__dirname, '../database/migrations', migrationFile);
    console.log(`📋 Running migration: ${migrationFile}`);
    console.log(`   Path: ${migrationPath}`);
    
    const migrationSQL = readFileSync(migrationPath, 'utf8');
    const pool = await getSharedPool();
    
    console.log('📝 Executing migration SQL...');
    await pool.query(migrationSQL);
    
    console.log('✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error('Usage: tsx scripts/run-migration.ts <migration-file>');
  console.error('Example: tsx scripts/run-migration.ts add-system-notifications.sql');
  process.exit(1);
}

runMigration(migrationFile);

