-- Leanworks Hub Shared Database Schema
-- Database: shared (shared across all tenants)
-- Contains: users, organizations, org_members, org_invitations, demo_requests

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- USERS TABLE (Global Registry)
-- ============================================================================

-- Users table - global registry of all users across all organizations
CREATE TABLE IF NOT EXISTS users (
  email VARCHAR(255) PRIMARY KEY,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  job_title VARCHAR(100),
  timezone VARCHAR(100) DEFAULT 'America/Los_Angeles',
  responsibilities TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  -- Subscription fields
  subscription_plan VARCHAR(20) DEFAULT 'free' CHECK (subscription_plan IN ('free', 'standard', 'pro')),
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  ai_daily_usage INTEGER DEFAULT 0,
  ai_usage_reset_date DATE DEFAULT CURRENT_DATE,
  trial_ends_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_email_verified ON users(email_verified);
CREATE INDEX IF NOT EXISTS idx_users_subscription_plan ON users(subscription_plan);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription_id ON users(stripe_subscription_id);

-- ============================================================================
-- ORGANIZATIONS TABLE
-- ============================================================================

-- Organizations table - each org has its own database for data isolation
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,  -- Used for database naming: org_{slug}
  type VARCHAR(20) NOT NULL DEFAULT 'team' CHECK (type IN ('personal', 'team')),
  owner_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE RESTRICT,
  description TEXT,
  avatar VARCHAR(10),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_email);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations(type);

-- ============================================================================
-- ORG MEMBERS TABLE
-- ============================================================================

-- Org members - tracks which users belong to which organizations
CREATE TABLE IF NOT EXISTS org_members (
  id SERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, user_email)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_email);
CREATE INDEX IF NOT EXISTS idx_org_members_role ON org_members(role);

-- ============================================================================
-- ORG INVITATIONS TABLE
-- ============================================================================

-- Org invitations - pending invitations to join an organization
CREATE TABLE IF NOT EXISTS org_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invitee_email VARCHAR(255) NOT NULL,
  inviter_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  message TEXT,  -- Optional personal message from inviter
  token VARCHAR(255) UNIQUE,  -- Secure token for invitation link
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  responded_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_invitations_org ON org_invitations(org_id);
CREATE INDEX IF NOT EXISTS idx_org_invitations_invitee ON org_invitations(invitee_email);
CREATE INDEX IF NOT EXISTS idx_org_invitations_status ON org_invitations(status);
CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON org_invitations(token);
CREATE INDEX IF NOT EXISTS idx_org_invitations_expires ON org_invitations(expires_at);

-- ============================================================================
-- EMAIL VERIFICATION TOKENS TABLE
-- ============================================================================

-- Email verification tokens for signup email verification
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  used_at TIMESTAMP,
  UNIQUE(email, token)
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_email ON email_verification_tokens(email);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expires ON email_verification_tokens(expires_at);

-- ============================================================================
-- UNIFIED NOTIFICATIONS TABLE
-- ============================================================================

-- Unified notifications - for all notification types (org invitations, system messages, etc.)
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

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_email);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(org_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notifications(user_email, status);

-- ============================================================================
-- DEMO REQUESTS TABLE
-- ============================================================================

-- Demo requests table (for public demo request form submissions)
CREATE TABLE IF NOT EXISTS demo_requests (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  company VARCHAR(255),
  message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_requests_email ON demo_requests(email);
CREATE INDEX IF NOT EXISTS idx_demo_requests_created_at ON demo_requests(created_at);

-- ============================================================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- ============================================================================

-- Update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to tables with updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at 
  BEFORE UPDATE ON users 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations;
CREATE TRIGGER update_organizations_updated_at 
  BEFORE UPDATE ON organizations 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_org_members_updated_at ON org_members;
CREATE TRIGGER update_org_members_updated_at 
  BEFORE UPDATE ON org_members 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_org_invitations_updated_at ON org_invitations;
CREATE TRIGGER update_org_invitations_updated_at 
  BEFORE UPDATE ON org_invitations 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to generate secure invitation token
CREATE OR REPLACE FUNCTION generate_invitation_token()
RETURNS VARCHAR(255) AS $$
BEGIN
  RETURN encode(gen_random_bytes(32), 'hex');
END;
$$ LANGUAGE plpgsql;

-- Function to check if invitation is expired
CREATE OR REPLACE FUNCTION is_invitation_expired(invitation_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  exp_time TIMESTAMP;
BEGIN
  SELECT expires_at INTO exp_time FROM org_invitations WHERE id = invitation_id;
  RETURN exp_time < NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to get user's organizations
CREATE OR REPLACE FUNCTION get_user_organizations(user_email_param VARCHAR(255))
RETURNS TABLE (
  org_id UUID,
  org_name VARCHAR(255),
  org_slug VARCHAR(100),
  org_type VARCHAR(20),
  user_role VARCHAR(20),
  is_owner BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id,
    o.name,
    o.slug,
    o.type,
    om.role,
    o.owner_email = user_email_param
  FROM organizations o
  INNER JOIN org_members om ON o.id = om.org_id
  WHERE om.user_email = user_email_param
  ORDER BY o.type ASC, o.created_at ASC;  -- Personal workspace first
END;
$$ LANGUAGE plpgsql;

-- Function to check org membership
CREATE OR REPLACE FUNCTION check_org_membership(
  org_id_param UUID, 
  user_email_param VARCHAR(255)
)
RETURNS TABLE (
  is_member BOOLEAN,
  member_role VARCHAR(20)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    TRUE,
    om.role
  FROM org_members om
  WHERE om.org_id = org_id_param AND om.user_email = user_email_param;
  
  -- If no rows returned, return false
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::VARCHAR(20);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- View for organization details with member count
CREATE OR REPLACE VIEW organization_details AS
SELECT 
  o.id,
  o.name,
  o.slug,
  o.type,
  o.owner_email,
  o.description,
  o.avatar,
  o.created_at,
  COUNT(om.id) as member_count,
  (SELECT COUNT(*) FROM org_invitations oi 
   WHERE oi.org_id = o.id AND oi.status = 'pending') as pending_invitations
FROM organizations o
LEFT JOIN org_members om ON o.id = om.org_id
GROUP BY o.id, o.name, o.slug, o.type, o.owner_email, o.description, o.avatar, o.created_at;

-- ============================================================================
-- COMMENTS
-- ============================================================================

-- ============================================================================
-- QUERY AUDIT LOG TABLE (For Query API security auditing)
-- ============================================================================

-- Query audit log - tracks all SQL query executions for security monitoring
CREATE TABLE IF NOT EXISTS query_audit_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  user_email VARCHAR(255) NOT NULL,
  org_id VARCHAR(50) NOT NULL,
  org_slug VARCHAR(100) NOT NULL,
  query_hash VARCHAR(64) NOT NULL,  -- SHA-256 hash of the query for privacy
  execution_time_ms INTEGER,
  row_count INTEGER,
  success BOOLEAN NOT NULL,
  error_code VARCHAR(50),
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN query_audit_log.id IS 'Auto-incrementing primary key (SERIAL)';
COMMENT ON COLUMN query_audit_log.timestamp IS 'When the query was executed (use for ordering and time-based queries)';
COMMENT ON COLUMN query_audit_log.user_email IS 'Email address of user who executed the query (references global users table)';
COMMENT ON COLUMN query_audit_log.org_id IS 'Unique identifier of the organization where query was executed';
COMMENT ON COLUMN query_audit_log.org_slug IS 'URL-safe slug of the organization (used for database naming)';
COMMENT ON COLUMN query_audit_log.execution_time_ms IS 'Query execution time in milliseconds (performance metric)';
COMMENT ON COLUMN query_audit_log.row_count IS 'Number of rows returned by the query (if applicable)';
COMMENT ON COLUMN query_audit_log.success IS 'Whether the query executed successfully (true) or failed (false)';
COMMENT ON COLUMN query_audit_log.error_code IS 'Database error code if query failed (NULL for successful queries)';
COMMENT ON COLUMN query_audit_log.error_message IS 'Error message if query failed (NULL for successful queries)';
COMMENT ON COLUMN query_audit_log.created_at IS 'When this audit log entry was created';

CREATE INDEX IF NOT EXISTS idx_query_audit_timestamp ON query_audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_query_audit_user ON query_audit_log(user_email);
CREATE INDEX IF NOT EXISTS idx_query_audit_org ON query_audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_query_audit_success ON query_audit_log(success);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE users IS 'Global registry of all users across all organizations';
COMMENT ON TABLE organizations IS 'Organizations - each org has its own isolated database';
COMMENT ON TABLE org_members IS 'Membership records linking users to organizations';
COMMENT ON TABLE org_invitations IS 'Pending invitations to join organizations';
COMMENT ON TABLE email_verification_tokens IS 'Tokens for email verification during signup';
COMMENT ON TABLE demo_requests IS 'Public demo request form submissions';
COMMENT ON TABLE query_audit_log IS 'Audit log for Query API executions - tracks security and usage';

COMMENT ON COLUMN organizations.type IS 'personal = auto-created personal workspace, team = user-created org';
COMMENT ON COLUMN organizations.slug IS 'URL-safe identifier used for database naming (org_{slug})';
COMMENT ON COLUMN org_invitations.token IS 'Secure token for invitation acceptance link';
COMMENT ON COLUMN query_audit_log.query_hash IS 'SHA-256 hash of the executed query for privacy and security monitoring';

