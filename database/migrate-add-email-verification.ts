/**
 * Migration script to add email_verification_tokens table to the shared database.
 * 
 * Run with: npx tsx database/migrate-add-email-verification.ts
 */

import { getSharedPool } from './multi-tenant-pool.js';

async function migrate() {
  console.log('🚀 Starting migration: Add email_verification_tokens table');
  
  const pool = await getSharedPool();
  
  try {
    // Create the email_verification_tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
        used_at TIMESTAMP,
        UNIQUE(email, token)
      );
    `);
    console.log('✅ Created email_verification_tokens table');

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_email 
      ON email_verification_tokens(email);
    `);
    console.log('✅ Created index on email');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token 
      ON email_verification_tokens(token);
    `);
    console.log('✅ Created index on token');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expires 
      ON email_verification_tokens(expires_at);
    `);
    console.log('✅ Created index on expires_at');

    // Add comment
    await pool.query(`
      COMMENT ON TABLE email_verification_tokens IS 'Tokens for email verification during signup';
    `);
    console.log('✅ Added table comment');

    console.log('');
    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('📧 Email verification feature is now ready.');
    console.log('   - New users will receive verification emails on signup');
    console.log('   - Users must verify email before logging in');
    console.log('   - Verification links expire in 24 hours');

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error('Migration error:', error);
  process.exit(1);
});

