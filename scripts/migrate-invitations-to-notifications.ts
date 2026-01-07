#!/usr/bin/env node
/**
 * Migration script to migrate pending org invitations from org_invitations table
 * to the unified notifications table.
 * 
 * This script:
 * 1. Finds all pending invitations that don't have corresponding notifications
 * 2. Creates notifications for each invitation with proper metadata
 * 3. Logs the migration progress
 * 
 * Usage: npx tsx scripts/migrate-invitations-to-notifications.ts
 */

import { getSharedPool } from '../database/multi-tenant-pool.js';

interface InvitationRow {
  id: string;
  org_id: string;
  invitee_email: string;
  inviter_email: string;
  message: string | null;
  created_at: Date;
  expires_at: Date;
  org_name: string;
  org_slug: string;
  inviter_first_name: string | null;
  inviter_last_name: string | null;
}

async function migrateInvitations() {
  console.log('🚀 Starting invitation migration to notifications table...\n');

  try {
    const sharedPool = await getSharedPool();

    // Find all pending invitations that don't have corresponding notifications
    const invitationsToMigrate = await sharedPool.query<InvitationRow>(`
      SELECT 
        oi.id,
        oi.org_id,
        oi.invitee_email,
        oi.inviter_email,
        oi.message,
        oi.created_at,
        oi.expires_at,
        o.name as org_name,
        o.slug as org_slug,
        u.first_name as inviter_first_name,
        u.last_name as inviter_last_name
      FROM org_invitations oi
      INNER JOIN organizations o ON oi.org_id = o.id
      LEFT JOIN users u ON oi.inviter_email = u.email
      LEFT JOIN notifications n ON 
        n.type = 'org_invitation' AND 
        n.user_email = oi.invitee_email AND
        n.metadata->>'invitation_id' = oi.id::text
      WHERE oi.status = 'pending' 
        AND oi.expires_at > NOW()
        AND n.id IS NULL
      ORDER BY oi.created_at ASC
    `);

    const totalCount = invitationsToMigrate.rows.length;
    console.log(`📊 Found ${totalCount} pending invitations to migrate\n`);

    if (totalCount === 0) {
      console.log('✅ No invitations to migrate. All pending invitations already have notifications.');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const invitation of invitationsToMigrate.rows) {
      try {
        // Build inviter name
        const inviterName = invitation.inviter_first_name && invitation.inviter_last_name
          ? `${invitation.inviter_first_name} ${invitation.inviter_last_name}`
          : invitation.inviter_first_name || invitation.inviter_last_name || invitation.inviter_email.split('@')[0];

        const notificationMetadata = JSON.stringify({
          invitation_id: invitation.id,
          org_id: invitation.org_id,
          inviter_email: invitation.inviter_email,
          inviter_name: inviterName,
          org_name: invitation.org_name,
          org_slug: invitation.org_slug,
          expires_at: invitation.expires_at
        });

        // Create notification
        await sharedPool.query(`
          INSERT INTO notifications (
            user_email,
            org_id,
            type,
            title,
            message,
            status,
            metadata,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        `, [
          invitation.invitee_email,
          invitation.org_id,
          'org_invitation',
          `${inviterName} invited you to join ${invitation.org_name}`,
          invitation.message || `You have been invited to join ${invitation.org_name}`,
          'unread',
          notificationMetadata,
          invitation.created_at
        ]);

        successCount++;
        console.log(`✅ Migrated invitation ${invitation.id} for ${invitation.invitee_email} → ${invitation.org_name}`);
      } catch (error: any) {
        errorCount++;
        console.error(`❌ Failed to migrate invitation ${invitation.id}:`, error.message);
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log(`   Total invitations: ${totalCount}`);
    console.log(`   ✅ Successfully migrated: ${successCount}`);
    console.log(`   ❌ Failed: ${errorCount}`);

    if (successCount === totalCount) {
      console.log('\n🎉 Migration completed successfully!');
    } else {
      console.log('\n⚠️  Migration completed with errors. Please review the errors above.');
    }
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateInvitations()
  .then(() => {
    console.log('\n✅ Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration script failed:', error);
    process.exit(1);
  });

