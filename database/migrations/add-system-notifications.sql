-- Migration: Add system_notifications table
-- Created: 2025-12-14
-- Description: Adds system_notifications table for storing system-generated notifications like deployment completion

-- System notifications - for system-generated notifications like deployment completion
CREATE TABLE IF NOT EXISTS system_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- e.g., 'deployment_complete', 'deployment_error'
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'dismissed')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  read_at TIMESTAMP,
  dismissed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_system_notifications_user ON system_notifications(user_email);
CREATE INDEX IF NOT EXISTS idx_system_notifications_status ON system_notifications(status);
CREATE INDEX IF NOT EXISTS idx_system_notifications_org ON system_notifications(org_id);
CREATE INDEX IF NOT EXISTS idx_system_notifications_created ON system_notifications(created_at DESC);
