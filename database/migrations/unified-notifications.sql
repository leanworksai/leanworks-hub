-- Migration: Unified Notifications Table
-- Created: 2025-12-14
-- Description: Creates a unified notifications table to replace system_notifications
--              and support all notification types (org invitations, system messages, etc.)

-- Drop the old system_notifications table if it exists (we'll migrate data first)
-- Note: We'll create a backup table first

-- Step 1: Create backup of existing system_notifications
CREATE TABLE IF NOT EXISTS system_notifications_backup AS 
SELECT * FROM system_notifications WHERE 1=0;

-- Copy existing data to backup
INSERT INTO system_notifications_backup 
SELECT * FROM system_notifications;

-- Step 2: Create unified notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'org_invitation', 'team_invitation', 'deployment_complete', 'deployment_error', etc.
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'dismissed')),
  metadata JSONB, -- Store type-specific data (inviter_email, inviter_name, org_name, token, etc.)
  action_url VARCHAR(500), -- Optional action link (e.g., invitation accept link)
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  read_at TIMESTAMP,
  dismissed_at TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_email);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(org_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notifications(user_email, status);

-- Step 3: Migrate existing system_notifications data
INSERT INTO notifications (
  id,
  user_email,
  org_id,
  type,
  title,
  message,
  status,
  created_at,
  read_at,
  dismissed_at
)
SELECT 
  id,
  user_email,
  org_id,
  type,
  title,
  message,
  status,
  created_at,
  read_at,
  dismissed_at
FROM system_notifications_backup
ON CONFLICT (id) DO NOTHING;

-- Step 4: Create notifications for existing pending org invitations
-- Only create notifications for users that exist in the users table
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
SELECT 
  oi.invitee_email,
  oi.org_id,
  'org_invitation',
  COALESCE(u.first_name || ' ' || u.last_name, u.email, oi.inviter_email) || ' invited you to join ' || o.name,
  COALESCE(oi.message, 'You have been invited to join ' || o.name),
  CASE 
    WHEN oi.status = 'pending' THEN 'unread'
    WHEN oi.status = 'accepted' THEN 'read'
    WHEN oi.status = 'declined' THEN 'dismissed'
    ELSE 'read'
  END,
  jsonb_build_object(
    'invitation_id', oi.id,
    'inviter_email', oi.inviter_email,
    'inviter_name', COALESCE(u.first_name || ' ' || u.last_name, u.email),
    'org_name', o.name,
    'org_slug', o.slug,
    'role', oi.role,
    'expires_at', oi.expires_at
  ),
  oi.created_at
FROM org_invitations oi
INNER JOIN organizations o ON oi.org_id = o.id
LEFT JOIN users u ON oi.inviter_email = u.email
INNER JOIN users invitee_user ON oi.invitee_email = invitee_user.email
WHERE oi.status IN ('pending', 'accepted', 'declined')
ON CONFLICT DO NOTHING;

-- Step 5: Drop old system_notifications table (after migration is verified)
-- Note: We'll keep the backup table for now, can be dropped later
-- DROP TABLE IF EXISTS system_notifications;

