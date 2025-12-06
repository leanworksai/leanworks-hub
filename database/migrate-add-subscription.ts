/**
 * Migration: Add subscription columns to shared.users table
 * Run with: npx tsx database/migrate-add-subscription.ts
 */

import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

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
  console.log('✅ Loaded .env file');
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
    console.log('✅ PostgreSQL password fetched from Secret Manager');
    return password;
  } catch (error) {
    console.error('❌ Failed to fetch password from Secret Manager:', error);
    return process.env.DB_PASSWORD || '';
  }
}

async function runMigration() {
  console.log('🚀 Starting subscription columns migration...\n');

  const password = await getPostgresPassword();
  const dbHost = process.env.DB_HOST || `/cloudsql/${projectId}:${region}:${instanceName}`;
  const dbPort = parseInt(process.env.DB_PORT || '5432');

  // Connect to the SHARED database (where global users are stored)
  const pool = new Pool({
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: 'shared', // The shared database contains global user accounts
    user: process.env.DB_USER || 'postgres',
    password: password,
    ssl: false,
  });

  try {
    const client = await pool.connect();
    console.log('✅ Connected to shared database\n');

    // Check current columns in users table
    console.log('📋 Checking current users table structure...');
    const columnsResult = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    
    const existingColumns = columnsResult.rows.map(r => r.column_name);
    console.log('   Existing columns:', existingColumns.join(', '));

    // Add subscription_plan column if it doesn't exist
    if (!existingColumns.includes('subscription_plan')) {
      console.log('\n📝 Adding subscription_plan column...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN subscription_plan VARCHAR(20) DEFAULT 'free';
      `);
      // Add check constraint separately (PostgreSQL doesn't support IF NOT EXISTS for constraints easily)
      try {
        await client.query(`
          ALTER TABLE users 
          ADD CONSTRAINT users_subscription_plan_check 
          CHECK (subscription_plan IN ('free', 'standard', 'pro'));
        `);
      } catch (e: any) {
        if (!e.message.includes('already exists')) throw e;
      }
      console.log('   ✅ subscription_plan column added');
    } else {
      console.log('\n✅ subscription_plan column already exists');
    }

    // Add stripe_customer_id column if it doesn't exist
    if (!existingColumns.includes('stripe_customer_id')) {
      console.log('📝 Adding stripe_customer_id column...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN stripe_customer_id VARCHAR(255);
      `);
      console.log('   ✅ stripe_customer_id column added');
    } else {
      console.log('✅ stripe_customer_id column already exists');
    }

    // Add stripe_subscription_id column if it doesn't exist
    if (!existingColumns.includes('stripe_subscription_id')) {
      console.log('📝 Adding stripe_subscription_id column...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN stripe_subscription_id VARCHAR(255);
      `);
      console.log('   ✅ stripe_subscription_id column added');
    } else {
      console.log('✅ stripe_subscription_id column already exists');
    }

    // Add ai_daily_usage column if it doesn't exist
    if (!existingColumns.includes('ai_daily_usage')) {
      console.log('📝 Adding ai_daily_usage column...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN ai_daily_usage INTEGER DEFAULT 0;
      `);
      console.log('   ✅ ai_daily_usage column added');
    } else {
      console.log('✅ ai_daily_usage column already exists');
    }

    // Add ai_usage_reset_date column if it doesn't exist
    if (!existingColumns.includes('ai_usage_reset_date')) {
      console.log('📝 Adding ai_usage_reset_date column...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN ai_usage_reset_date DATE DEFAULT CURRENT_DATE;
      `);
      console.log('   ✅ ai_usage_reset_date column added');
    } else {
      console.log('✅ ai_usage_reset_date column already exists');
    }

    // Add trial_ends_at column if it doesn't exist
    if (!existingColumns.includes('trial_ends_at')) {
      console.log('📝 Adding trial_ends_at column...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN trial_ends_at TIMESTAMP;
      `);
      console.log('   ✅ trial_ends_at column added');
    } else {
      console.log('✅ trial_ends_at column already exists');
    }

    // Create indexes
    console.log('\n📝 Creating indexes...');
    const indexQueries = [
      'CREATE INDEX IF NOT EXISTS idx_users_subscription_plan ON users(subscription_plan);',
      'CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);',
      'CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription_id ON users(stripe_subscription_id);',
    ];

    for (const query of indexQueries) {
      await client.query(query);
    }
    console.log('   ✅ Indexes created');

    // Set all existing users to free tier (they should already be 'free' due to default, but let's be explicit)
    console.log('\n📝 Setting all existing users to free tier...');
    const updateResult = await client.query(`
      UPDATE users 
      SET subscription_plan = 'free' 
      WHERE subscription_plan IS NULL;
    `);
    console.log(`   ✅ Updated ${updateResult.rowCount} users to free tier`);

    // Verify the migration
    console.log('\n📋 Verifying migration...');
    const verifyResult = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' 
        AND column_name IN ('subscription_plan', 'stripe_customer_id', 'stripe_subscription_id', 'ai_daily_usage', 'ai_usage_reset_date', 'trial_ends_at')
      ORDER BY ordinal_position;
    `);
    
    console.log('\n   Subscription columns:');
    for (const col of verifyResult.rows) {
      console.log(`   - ${col.column_name}: ${col.data_type} (default: ${col.column_default || 'none'})`);
    }

    // Show user count by plan
    const planCountResult = await client.query(`
      SELECT subscription_plan, COUNT(*) as count 
      FROM users 
      GROUP BY subscription_plan;
    `);
    console.log('\n   Users by subscription plan:');
    for (const row of planCountResult.rows) {
      console.log(`   - ${row.subscription_plan || 'null'}: ${row.count} users`);
    }

    client.release();
    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();

