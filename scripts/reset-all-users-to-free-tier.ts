#!/usr/bin/env node
/**
 * Script to reset all users to free tier
 * 
 * This script:
 * 1. Updates all users' subscription_plan to 'free'
 * 2. Clears stripe_subscription_id for all users
 * 
 * Note: This script only updates the database. If you need to cancel
 * Stripe subscriptions, you should do that separately through Stripe's
 * dashboard or API, or use Stripe's bulk cancellation features.
 * 
 * Usage: 
 *   npx tsx scripts/reset-all-users-to-free-tier.ts
 *   npx tsx scripts/reset-all-users-to-free-tier.ts --dry-run
 */

import { getSharedPool } from '../database/multi-tenant-pool.js';

interface UserRow {
  email: string;
  subscription_plan: string;
  stripe_subscription_id: string | null;
}

async function resetAllUsersToFreeTier(dryRun: boolean = false) {
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made to the database\n');
  }
  console.log('🚀 Starting reset of all users to free tier...\n');

  try {
    const sharedPool = await getSharedPool();

    // Get all users with their subscription info
    const usersResult = await sharedPool.query<UserRow>(`
      SELECT 
        email,
        subscription_plan,
        stripe_subscription_id
      FROM users
      WHERE subscription_plan != 'free' OR stripe_subscription_id IS NOT NULL
      ORDER BY email
    `);

    const totalUsers = usersResult.rows.length;
    console.log(`📊 Found ${totalUsers} users to reset to free tier\n`);

    if (totalUsers === 0) {
      console.log('✅ No users need to be reset. All users are already on free tier.');
      return;
    }

    // Show preview of what will be changed
    const standardUsers = usersResult.rows.filter(u => u.subscription_plan === 'standard').length;
    const proUsers = usersResult.rows.filter(u => u.subscription_plan === 'pro').length;
    const usersWithStripe = usersResult.rows.filter(u => u.stripe_subscription_id !== null).length;
    
    console.log('📋 Preview:');
    console.log(`   - Users on Standard plan: ${standardUsers}`);
    console.log(`   - Users on Pro plan: ${proUsers}`);
    console.log(`   - Users with Stripe subscriptions: ${usersWithStripe}`);
    console.log('');

    // Show sample of users that would be affected (first 10)
    if (totalUsers > 0) {
      const sampleSize = Math.min(10, totalUsers);
      console.log(`📝 Sample of ${sampleSize} users that would be affected:`);
      usersResult.rows.slice(0, sampleSize).forEach((user, index) => {
        const changes: string[] = [];
        if (user.subscription_plan !== 'free') {
          changes.push(`plan: ${user.subscription_plan} → free`);
        }
        if (user.stripe_subscription_id) {
          changes.push(`stripe_subscription_id: cleared`);
        }
        console.log(`   ${index + 1}. ${user.email} (${changes.join(', ')})`);
      });
      if (totalUsers > sampleSize) {
        console.log(`   ... and ${totalUsers - sampleSize} more users`);
      }
      console.log('');
    }

    if (dryRun) {
      console.log('🔍 DRY RUN: Would update the following:');
      console.log(`   - Set subscription_plan = 'free' for ${totalUsers} users`);
      console.log(`   - Clear stripe_subscription_id for ${usersWithStripe} users`);
      console.log('\n💡 To actually perform the reset, run without --dry-run flag');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    // Update all users in a single query for efficiency
    try {
      const updateResult = await sharedPool.query(`
        UPDATE users 
        SET subscription_plan = 'free', 
            stripe_subscription_id = NULL
        WHERE subscription_plan != 'free' OR stripe_subscription_id IS NOT NULL
      `);

      successCount = updateResult.rowCount || 0;
      console.log(`✅ Successfully reset ${successCount} users to free tier`);
    } catch (error: any) {
      console.error('❌ Failed to reset users:', error.message);
      errorCount = totalUsers;
    }

    // Verify the update
    const verifyResult = await sharedPool.query(`
      SELECT COUNT(*) as count
      FROM users
      WHERE subscription_plan != 'free' OR stripe_subscription_id IS NOT NULL
    `);
    const remainingNonFree = parseInt(verifyResult.rows[0].count, 10);

    console.log('\n📈 Reset Summary:');
    console.log(`   Total users found: ${totalUsers}`);
    console.log(`   ✅ Successfully reset: ${successCount}`);
    if (errorCount > 0) {
      console.log(`   ❌ Failed: ${errorCount}`);
    }
    if (remainingNonFree > 0) {
      console.log(`   ⚠️  Warning: ${remainingNonFree} users still not on free tier`);
    }

    if (successCount === totalUsers && errorCount === 0 && remainingNonFree === 0) {
      console.log('\n🎉 All users successfully reset to free tier!');
    } else {
      console.log('\n⚠️  Reset completed. Please review the summary above.');
    }

    if (usersWithStripe > 0) {
      console.log('\n💡 Note: Stripe subscription IDs have been cleared from the database.');
      console.log('   If you need to cancel active Stripe subscriptions, do so through Stripe dashboard or API.');
    }
  } catch (error: any) {
    console.error('\n❌ Reset failed:', error);
    process.exit(1);
  }
}

// Parse command line arguments
const dryRun = process.argv.includes('--dry-run');

// Run reset
resetAllUsersToFreeTier(dryRun)
  .then(() => {
    console.log('\n✅ Reset script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Reset script failed:', error);
    process.exit(1);
  });
