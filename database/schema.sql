-- Leanworks Hub PostgreSQL Schema
-- Database: leanworks-prod
-- Migration from Firestore to PostgreSQL

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Users table (replaces domains/{domain}/users)
CREATE TABLE IF NOT EXISTS users (
  email VARCHAR(255) PRIMARY KEY,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  job_title VARCHAR(100) NOT NULL,
  responsibilities TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- ============================================================================
-- TEAMS TABLES
-- ============================================================================

-- Teams table (replaces domains/{domain}/teams)
CREATE TABLE IF NOT EXISTS teams (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  avatar VARCHAR(10),
  owner_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_email);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);

-- Team members (normalized from teamDetails.members array)
CREATE TABLE IF NOT EXISTS team_members (
  id SERIAL PRIMARY KEY,
  team_id VARCHAR(50) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  role VARCHAR(100),
  avatar VARCHAR(10),
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(team_id, user_email)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_email);

-- Team join requests (replaces domains/{domain}/teamJoinRequests)
CREATE TABLE IF NOT EXISTS team_join_requests (
  id SERIAL PRIMARY KEY,
  team_id VARCHAR(50) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  user_name VARCHAR(255),
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  owner_email VARCHAR(255) NOT NULL REFERENCES users(email),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  processed_by VARCHAR(255) REFERENCES users(email),
  processed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_join_requests_status ON team_join_requests(status);
CREATE INDEX IF NOT EXISTS idx_team_join_requests_owner ON team_join_requests(owner_email);
CREATE INDEX IF NOT EXISTS idx_team_join_requests_team ON team_join_requests(team_id);

-- Team invitations (replaces domains/{domain}/teamInvitations)
CREATE TABLE IF NOT EXISTS team_invitations (
  id SERIAL PRIMARY KEY,
  team_id VARCHAR(50) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  team_description TEXT,
  invitee_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  inviter_email VARCHAR(255) NOT NULL REFERENCES users(email),
  inviter_name VARCHAR(255),
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_invitations_status ON team_invitations(status);
CREATE INDEX IF NOT EXISTS idx_team_invitations_invitee ON team_invitations(invitee_email);
CREATE INDEX IF NOT EXISTS idx_team_invitations_team ON team_invitations(team_id);

-- ============================================================================
-- PROJECTS TABLES
-- ============================================================================

-- Projects table (replaces domains/{domain}/projects)
CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  team_id VARCHAR(50) REFERENCES teams(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'active',
  priority VARCHAR(20) CHECK (priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
  start_date DATE,
  end_date DATE,
  due_date DATE,
  owner_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_email);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_priority ON projects(priority);

-- Project members (normalized from projects.members array)
CREATE TABLE IF NOT EXISTS project_members (
  id SERIAL PRIMARY KEY,
  project_id VARCHAR(50) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  role VARCHAR(100),
  avatar VARCHAR(10),
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, user_email)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_email);

-- Project progress updates (normalized from projects.progressUpdates array)
-- Project progress updates removed - use updates table with associated_tasks instead
-- Updates table (below) handles all project/task updates with proper task associations

-- Project comments (normalized from projects.comments array)
CREATE TABLE IF NOT EXISTS project_comments (
  id VARCHAR(50) PRIMARY KEY,
  project_id VARCHAR(50) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_name VARCHAR(255),
  member_avatar VARCHAR(10),
  date DATE,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_comments_project ON project_comments(project_id);

-- ============================================================================
-- TASKS TABLES
-- ============================================================================

-- Tasks table (replaces domains/{domain}/tasks)
CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) CHECK (status IN ('todo', 'in-progress', 'review', 'completed', 'blocked')),
  priority VARCHAR(20) CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee_id VARCHAR(255) REFERENCES users(email) ON DELETE SET NULL,
  assignee_name VARCHAR(255),
  assignee_avatar VARCHAR(10),
  project_id VARCHAR(50) REFERENCES projects(id) ON DELETE CASCADE,
  project_name VARCHAR(255),
  created_by VARCHAR(255) REFERENCES users(email) ON DELETE SET NULL,
  due_date DATE,
  created_date DATE,
  created_at BIGINT,
  estimated_hours DECIMAL(6,2),
  actual_hours DECIMAL(6,2),
  tags JSONB DEFAULT '[]'::jsonb,
  reason TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_tags ON tasks USING GIN (tags);

-- Task-Team association removed - tasks are associated with projects, which are associated with teams
-- Use: tasks.project_id -> projects.team_id to find team relationships

-- Task progress updates (normalized from tasks.progressUpdates array)
-- Task progress updates removed - use updates table with associated_tasks instead  
-- Updates table handles all task updates through associated_tasks JSONB array

-- Task comments (normalized from tasks.comments array)
CREATE TABLE IF NOT EXISTS task_comments (
  id VARCHAR(50) PRIMARY KEY,
  task_id VARCHAR(50) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  member_name VARCHAR(255),
  member_avatar VARCHAR(10),
  date DATE,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);

-- ============================================================================
-- UPDATES TABLES
-- ============================================================================

-- Task progress updates table (replaces domains/{domain}/updates)
CREATE TABLE IF NOT EXISTS task_progress_updates (
  id SERIAL PRIMARY KEY,
  update_id VARCHAR(50) UNIQUE,
  project_id VARCHAR(50) REFERENCES projects(id) ON DELETE CASCADE,
  user_id VARCHAR(255) REFERENCES users(email) ON DELETE SET NULL,
  associated_tasks JSONB DEFAULT '[]'::jsonb,
  date_id DATE,
  reason TEXT,
  update_text TEXT,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_progress_updates_project ON task_progress_updates(project_id);
CREATE INDEX IF NOT EXISTS idx_task_progress_updates_date ON task_progress_updates(date_id);
CREATE INDEX IF NOT EXISTS idx_task_progress_updates_user ON task_progress_updates(user_id);
CREATE INDEX IF NOT EXISTS idx_task_progress_updates_timestamp ON task_progress_updates(timestamp);

-- Project progress updates (replaces domains/{domain}/update_summaries)
CREATE TABLE IF NOT EXISTS project_progress_updates (
  id SERIAL PRIMARY KEY,
  project_id VARCHAR(50) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date_id DATE NOT NULL,
  update_summary TEXT,
  generated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, date_id)
);

CREATE INDEX IF NOT EXISTS idx_project_progress_updates_project_date ON project_progress_updates(project_id, date_id);

-- ============================================================================
-- INTEGRATIONS TABLES
-- ============================================================================

-- Integrations table (replaces domains/{domain}/integrations)
CREATE TABLE IF NOT EXISTS integrations (
  id SERIAL PRIMARY KEY,
  integration_id VARCHAR(50) NOT NULL UNIQUE,
  integration_name VARCHAR(100),
  connected BOOLEAN DEFAULT false,
  secret_name VARCHAR(255),
  connected_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW(),
  installation_id BIGINT,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_integrations_integration_id ON integrations(integration_id);

-- GitHub installations (replaces root-level github-installations collection)
CREATE TABLE IF NOT EXISTS github_installations (
  installation_id BIGINT PRIMARY KEY,
  setup_action VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- MESSAGES - FIRESTORE ONLY
-- ============================================================================

-- Messages are stored ONLY in Firestore for real-time messaging
-- Path: domains/{domain}/messages
-- No PostgreSQL table needed - Firestore handles all message storage
-- This ensures true real-time capabilities without sync complexity

-- ============================================================================
-- MATERIALIZED VIEWS FOR ANALYTICS
-- ============================================================================

-- Team statistics (for fast queries)
CREATE MATERIALIZED VIEW IF NOT EXISTS team_stats AS
SELECT 
  t.id AS team_id,
  t.name,
  COUNT(DISTINCT tm.user_email) AS member_count,
  COUNT(DISTINCT p.id) AS project_count,
  t.created_at,
  t.updated_at
FROM teams t
LEFT JOIN team_members tm ON t.id = tm.team_id
LEFT JOIN project_members pm ON tm.user_email = pm.user_email
LEFT JOIN projects p ON pm.project_id = p.id
GROUP BY t.id, t.name, t.created_at, t.updated_at;

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_stats_team_id ON team_stats(team_id);

-- Refresh function for team_stats
CREATE OR REPLACE FUNCTION refresh_team_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY team_stats;
END;
$$ LANGUAGE plpgsql;

-- Project statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS project_stats AS
SELECT 
  p.id AS project_id,
  p.name,
  COUNT(DISTINCT pm.user_email) AS member_count,
  COUNT(DISTINCT t.id) AS task_count,
  COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.id END) AS completed_tasks,
  COUNT(DISTINCT CASE WHEN t.status IN ('todo', 'in-progress', 'review') THEN t.id END) AS active_tasks,
  p.due_date,
  p.status
FROM projects p
LEFT JOIN project_members pm ON p.id = pm.project_id
LEFT JOIN tasks t ON p.id = t.project_id
GROUP BY p.id, p.name, p.due_date, p.status;

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_stats_project_id ON project_stats(project_id);

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

-- Apply to all tables with updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_teams_updated_at ON teams;
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- GRANTS (adjust as needed for your user)
-- ============================================================================

-- Grant permissions to the application user (adjust username as needed)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO leanworks_app;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO leanworks_app;

COMMENT ON DATABASE "leanworks-prod" IS 'Leanworks Hub - Migrated from Firestore';

