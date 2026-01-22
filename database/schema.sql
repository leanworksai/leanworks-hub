-- Leanworks Hub Per-Organization PostgreSQL Schema
-- Database: org_{slug} (one database per organization)
-- Contains: users, teams, projects, tasks, updates, integrations, notes, transcription_sessions
-- NOTE: Global user accounts are in the shared database (shared)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- NOTES ON ARCHITECTURE
-- ============================================================================
-- This schema is for per-organization databases.
-- Global user accounts are stored in the shared database (shared).
-- This org-level users table stores org-specific profile data.
-- Email references link to the global user registry in the shared DB.
-- The application layer is responsible for validating user membership.

-- ============================================================================
-- USERS TABLE (Organization-specific profiles)
-- ============================================================================

-- Users table - stores org-specific user profile data
-- Links to global user registry in shared DB via email
CREATE TABLE IF NOT EXISTS users (
  email VARCHAR(255) PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  job_title VARCHAR(100),
  responsibilities TEXT,
  avatar VARCHAR(10),
  timezone VARCHAR(100) DEFAULT 'America/Los_Angeles',
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  role VARCHAR(50) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON COLUMN users.email IS 'Primary key - User email address (links to global users table in shared database)';
COMMENT ON COLUMN users.first_name IS 'User first name';
COMMENT ON COLUMN users.last_name IS 'User last name';
COMMENT ON COLUMN users.job_title IS 'User job title or role description';
COMMENT ON COLUMN users.responsibilities IS 'Text description of user responsibilities';
COMMENT ON COLUMN users.avatar IS 'Avatar color code (VARCHAR 10)';
COMMENT ON COLUMN users.timezone IS 'User timezone (defaults to America/Los_Angeles)';
COMMENT ON COLUMN users.status IS 'User status: active, inactive, or pending';
COMMENT ON COLUMN users.role IS 'User role in organization: owner, admin, member, or viewer';
COMMENT ON COLUMN users.joined_at IS 'When user joined this organization';
COMMENT ON COLUMN users.last_active_at IS 'Timestamp of user last activity';
COMMENT ON COLUMN users.created_at IS 'Record creation time';
COMMENT ON COLUMN users.updated_at IS 'Last modification time (auto-updated by trigger)';

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_joined_at ON users(joined_at);

-- ============================================================================
-- TEAMS TABLES
-- ============================================================================

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  avatar VARCHAR(10),
  owner_email VARCHAR(255) NOT NULL,  -- References user in shared DB
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_email);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);

-- Team members (normalized from teamDetails.members array)
CREATE TABLE IF NOT EXISTS team_members (
  id SERIAL PRIMARY KEY,
  team_id VARCHAR(50) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_email VARCHAR(255) NOT NULL,  -- References user in shared DB
  role VARCHAR(100),
  avatar VARCHAR(10),
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(team_id, user_email)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_email);

-- Team join requests
CREATE TABLE IF NOT EXISTS team_join_requests (
  id SERIAL PRIMARY KEY,
  team_id VARCHAR(50) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_email VARCHAR(255) NOT NULL,  -- References user in shared DB
  user_name VARCHAR(255),
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  owner_email VARCHAR(255) NOT NULL,  -- References user in shared DB
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  processed_by VARCHAR(255),  -- References user in shared DB
  processed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_join_requests_status ON team_join_requests(status);
CREATE INDEX IF NOT EXISTS idx_team_join_requests_owner ON team_join_requests(owner_email);
CREATE INDEX IF NOT EXISTS idx_team_join_requests_team ON team_join_requests(team_id);

-- Team invitations
CREATE TABLE IF NOT EXISTS team_invitations (
  id SERIAL PRIMARY KEY,
  team_id VARCHAR(50) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  team_description TEXT,
  invitee_email VARCHAR(255) NOT NULL,  -- References user in shared DB
  inviter_email VARCHAR(255) NOT NULL,  -- References user in shared DB
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

-- Projects table
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
  owner_email VARCHAR(255) NOT NULL,  -- References user in shared DB
  visibility VARCHAR(20) DEFAULT 'all_members' CHECK (visibility IN ('all_members', 'specific_members')),
  visible_to_members JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON COLUMN projects.id IS 'Primary key - Unique project identifier (VARCHAR 50)';
COMMENT ON COLUMN projects.name IS 'Project name/title';
COMMENT ON COLUMN projects.description IS 'Project description or overview';
COMMENT ON COLUMN projects.team_id IS 'References teams.id (SET NULL when team is deleted)';
COMMENT ON COLUMN projects.status IS 'Project status (e.g., active, completed, archived)';
COMMENT ON COLUMN projects.priority IS 'Project priority level: low, medium, high, or urgent';
COMMENT ON COLUMN projects.start_date IS 'Project planned start date';
COMMENT ON COLUMN projects.end_date IS 'Project planned end date';
COMMENT ON COLUMN projects.due_date IS 'Project due date';
COMMENT ON COLUMN projects.owner_email IS 'Email address of project owner (references global users table in shared database)';
COMMENT ON COLUMN projects.visibility IS 'Access control level: all_members (everyone in org) or specific_members (restricted to visible_to_members list)';
COMMENT ON COLUMN projects.visible_to_members IS 'JSONB array of user email strings who can access this project when visibility=specific_members';
COMMENT ON COLUMN projects.created_at IS 'Record creation time';
COMMENT ON COLUMN projects.updated_at IS 'Last modification time (auto-updated by trigger)';

CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_email);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_priority ON projects(priority);
CREATE INDEX IF NOT EXISTS idx_projects_visibility ON projects(visibility);
CREATE INDEX IF NOT EXISTS idx_projects_visible_to_members ON projects USING GIN (visible_to_members);

-- Project members (normalized from projects.members array)
CREATE TABLE IF NOT EXISTS project_members (
  id SERIAL PRIMARY KEY,
  project_id VARCHAR(50) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_email VARCHAR(255) NOT NULL,  -- References user in shared DB
  role VARCHAR(100),
  avatar VARCHAR(10),
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, user_email)
);

COMMENT ON COLUMN project_members.id IS 'Auto-incrementing primary key (SERIAL)';
COMMENT ON COLUMN project_members.project_id IS 'References projects.id (CASCADE delete when project is deleted)';
COMMENT ON COLUMN project_members.user_email IS 'Email address of user (references global users table in shared database)';
COMMENT ON COLUMN project_members.role IS 'User role in this project (e.g., member, admin, viewer)';
COMMENT ON COLUMN project_members.avatar IS 'Avatar color code for this user in this project';
COMMENT ON COLUMN project_members.joined_at IS 'When user joined this project';

CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_email);

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

COMMENT ON COLUMN project_comments.id IS 'Primary key - Unique comment identifier (VARCHAR 50)';
COMMENT ON COLUMN project_comments.project_id IS 'References projects.id (CASCADE delete when project is deleted)';
COMMENT ON COLUMN project_comments.member_name IS 'Display name of user who made the comment (denormalized for performance)';
COMMENT ON COLUMN project_comments.member_avatar IS 'Avatar color code of user who made the comment (denormalized for performance)';
COMMENT ON COLUMN project_comments.date IS 'Date when comment was made';
COMMENT ON COLUMN project_comments.comment IS 'Comment text content';
COMMENT ON COLUMN project_comments.created_at IS 'When this comment was created';

CREATE INDEX IF NOT EXISTS idx_project_comments_project ON project_comments(project_id);

-- ============================================================================
-- TASKS TABLES
-- ============================================================================

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) CHECK (status IN ('todo', 'in-progress', 'review', 'completed', 'blocked')),
  priority VARCHAR(20) CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee_id VARCHAR(255),  -- References user in shared DB (email)
  assignee_name VARCHAR(255),
  assignee_avatar VARCHAR(10),
  project_id VARCHAR(50) REFERENCES projects(id) ON DELETE CASCADE,
  project_name VARCHAR(255),
  created_by VARCHAR(255),  -- References user in shared DB (email)
  visibility VARCHAR(20) DEFAULT 'all_members' CHECK (visibility IN ('all_members', 'specific_members')),
  visible_to_members JSONB DEFAULT '[]'::jsonb,
  due_date DATE,
  created_date DATE,
  created_at BIGINT,
  estimated_hours DECIMAL(6,2),
  actual_hours DECIMAL(6,2),
  tags JSONB DEFAULT '[]'::jsonb,
  reason TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON COLUMN tasks.id IS 'Primary key - Unique task identifier (VARCHAR 50)';
COMMENT ON COLUMN tasks.title IS 'Task title/name';
COMMENT ON COLUMN tasks.description IS 'Task description or details';
COMMENT ON COLUMN tasks.status IS 'Task status: todo, in-progress, review, completed, or blocked';
COMMENT ON COLUMN tasks.priority IS 'Task priority level: low, medium, high, or urgent';
COMMENT ON COLUMN tasks.assignee_id IS 'Email address of assigned user (references global users table in shared database)';
COMMENT ON COLUMN tasks.assignee_name IS 'Display name of assigned user (denormalized for performance)';
COMMENT ON COLUMN tasks.assignee_avatar IS 'Avatar color code of assigned user (denormalized for performance)';
COMMENT ON COLUMN tasks.project_id IS 'References projects.id (CASCADE delete when project is deleted)';
COMMENT ON COLUMN tasks.project_name IS 'Project name (denormalized for performance)';
COMMENT ON COLUMN tasks.created_by IS 'Email address of user who created this task (references global users table in shared database)';
COMMENT ON COLUMN tasks.visibility IS 'Access control level: all_members (everyone in org) or specific_members (restricted to visible_to_members list)';
COMMENT ON COLUMN tasks.visible_to_members IS 'JSONB array of user email strings who can access this task when visibility=specific_members';
COMMENT ON COLUMN tasks.due_date IS 'Task due date';
COMMENT ON COLUMN tasks.created_date IS 'Date task was created';
COMMENT ON COLUMN tasks.created_at IS 'Task creation timestamp (BIGINT, likely Unix timestamp)';
COMMENT ON COLUMN tasks.estimated_hours IS 'Estimated hours to complete task (decimal)';
COMMENT ON COLUMN tasks.actual_hours IS 'Actual hours spent on task (decimal)';
COMMENT ON COLUMN tasks.tags IS 'JSONB array of tag strings for categorization and filtering';
COMMENT ON COLUMN tasks.reason IS 'Optional reason or context for the task';
COMMENT ON COLUMN tasks.updated_at IS 'Last modification time (auto-updated by trigger)';

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_tags ON tasks USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_tasks_visibility ON tasks(visibility);
CREATE INDEX IF NOT EXISTS idx_tasks_visible_to_members ON tasks USING GIN (visible_to_members);

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

COMMENT ON COLUMN task_comments.id IS 'Primary key - Unique comment identifier (VARCHAR 50)';
COMMENT ON COLUMN task_comments.task_id IS 'References tasks.id (CASCADE delete when task is deleted)';
COMMENT ON COLUMN task_comments.member_name IS 'Display name of user who made the comment (denormalized for performance)';
COMMENT ON COLUMN task_comments.member_avatar IS 'Avatar color code of user who made the comment (denormalized for performance)';
COMMENT ON COLUMN task_comments.date IS 'Date when comment was made';
COMMENT ON COLUMN task_comments.comment IS 'Comment text content';
COMMENT ON COLUMN task_comments.created_at IS 'When this comment was created';

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);

-- ============================================================================
-- EVENTS TABLES
-- ============================================================================

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  all_day BOOLEAN DEFAULT false,
  location VARCHAR(255),
  attendees JSONB DEFAULT '[]'::jsonb, -- Array of user emails
  created_by VARCHAR(255) NOT NULL,  -- References user in shared DB (email)
  visibility VARCHAR(20) DEFAULT 'all_members' CHECK (visibility IN ('all_members', 'specific_members')),
  visible_to_members JSONB DEFAULT '[]'::jsonb,
  created_at BIGINT,
  updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON COLUMN events.id IS 'Primary key - Unique event identifier (VARCHAR 50)';
COMMENT ON COLUMN events.title IS 'Event title/name';
COMMENT ON COLUMN events.description IS 'Event description or agenda';
COMMENT ON COLUMN events.start_date IS 'Event start date and time';
COMMENT ON COLUMN events.end_date IS 'Event end date and time';
COMMENT ON COLUMN events.all_day IS 'Whether this is an all-day event (true) or has specific times (false)';
COMMENT ON COLUMN events.location IS 'Event location or meeting link';
COMMENT ON COLUMN events.attendees IS 'JSONB array of user email strings invited to this event';
COMMENT ON COLUMN events.created_by IS 'Email address of user who created this event (references global users table in shared database)';
COMMENT ON COLUMN events.visibility IS 'Access control level: all_members (everyone in org) or specific_members (restricted to visible_to_members list)';
COMMENT ON COLUMN events.visible_to_members IS 'JSONB array of user email strings who can access this event when visibility=specific_members';
COMMENT ON COLUMN events.created_at IS 'Event creation timestamp (BIGINT, likely Unix timestamp)';
COMMENT ON COLUMN events.updated_at IS 'Last modification time (auto-updated by trigger)';

CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date);
CREATE INDEX IF NOT EXISTS idx_events_end_date ON events(end_date);
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events(created_by);
CREATE INDEX IF NOT EXISTS idx_events_visibility ON events(visibility);
CREATE INDEX IF NOT EXISTS idx_events_visible_to_members ON events USING GIN (visible_to_members);
CREATE INDEX IF NOT EXISTS idx_events_attendees ON events USING GIN (attendees);

-- ============================================================================
-- UPDATES TABLES
-- ============================================================================

-- Task progress updates table
CREATE TABLE IF NOT EXISTS task_progress_updates (
  id SERIAL PRIMARY KEY,
  update_id VARCHAR(50) UNIQUE,
  project_id VARCHAR(50) REFERENCES projects(id) ON DELETE CASCADE,
  user_id VARCHAR(255),  -- References user in shared DB (email)
  associated_tasks JSONB DEFAULT '[]'::jsonb,
  date_id DATE,
  reason TEXT,
  update_text TEXT,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN task_progress_updates.id IS 'Auto-incrementing primary key (SERIAL)';
COMMENT ON COLUMN task_progress_updates.update_id IS 'Unique identifier for this update (VARCHAR 50)';
COMMENT ON COLUMN task_progress_updates.project_id IS 'References projects.id (CASCADE delete when project is deleted)';
COMMENT ON COLUMN task_progress_updates.user_id IS 'Email address of user who created the update (references global users table in shared database)';
COMMENT ON COLUMN task_progress_updates.associated_tasks IS 'JSONB array of task ID strings this update relates to (use JSONB operators like ? or @> to query)';
COMMENT ON COLUMN task_progress_updates.date_id IS 'Date this update is associated with';
COMMENT ON COLUMN task_progress_updates.reason IS 'Optional category or reason for the update (e.g., "completed", "blocked")';
COMMENT ON COLUMN task_progress_updates.update_text IS 'Main content/body of the progress update';
COMMENT ON COLUMN task_progress_updates.timestamp IS 'When this update was created (use for ordering, not created_at)';

CREATE INDEX IF NOT EXISTS idx_task_progress_updates_project ON task_progress_updates(project_id);
CREATE INDEX IF NOT EXISTS idx_task_progress_updates_date ON task_progress_updates(date_id);
CREATE INDEX IF NOT EXISTS idx_task_progress_updates_user ON task_progress_updates(user_id);
CREATE INDEX IF NOT EXISTS idx_task_progress_updates_timestamp ON task_progress_updates(timestamp);

-- Project progress updates (update summaries)
CREATE TABLE IF NOT EXISTS project_progress_updates (
  id SERIAL PRIMARY KEY,
  project_id VARCHAR(50) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date_id DATE NOT NULL,
  update_summary TEXT,
  generated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, date_id)
);

COMMENT ON COLUMN project_progress_updates.id IS 'Auto-incrementing primary key (SERIAL)';
COMMENT ON COLUMN project_progress_updates.project_id IS 'References projects.id (CASCADE delete when project is deleted)';
COMMENT ON COLUMN project_progress_updates.date_id IS 'Date this progress update is for';
COMMENT ON COLUMN project_progress_updates.update_summary IS 'Auto-generated summary of project progress for this date';
COMMENT ON COLUMN project_progress_updates.generated_at IS 'When this summary was generated';

CREATE INDEX IF NOT EXISTS idx_project_progress_updates_project_date ON project_progress_updates(project_id, date_id);

-- ============================================================================
-- INTEGRATIONS TABLES
-- ============================================================================

-- Integrations table
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

-- GitHub installations
CREATE TABLE IF NOT EXISTS github_installations (
  installation_id BIGINT PRIMARY KEY,
  setup_action VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- DOCS TABLES
-- ============================================================================

-- Docs table
CREATE TABLE IF NOT EXISTS docs (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,  -- TipTap JSON document format (stringified JSON, was: Rich text content HTML)
  owner_email VARCHAR(255) NOT NULL,  -- References user in shared DB
  project_id VARCHAR(50) REFERENCES projects(id) ON DELETE SET NULL,
  team_id VARCHAR(50) REFERENCES teams(id) ON DELETE SET NULL,
  tags JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  visibility VARCHAR(20) DEFAULT 'all_members' CHECK (visibility IN ('all_members', 'specific_members')),
  visible_to_members JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docs_owner ON docs(owner_email);
CREATE INDEX IF NOT EXISTS idx_docs_project ON docs(project_id);
CREATE INDEX IF NOT EXISTS idx_docs_team ON docs(team_id);
CREATE INDEX IF NOT EXISTS idx_docs_created_at ON docs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_docs_visibility ON docs(visibility);
CREATE INDEX IF NOT EXISTS idx_docs_visible_to_members ON docs USING GIN (visible_to_members);

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

DROP TRIGGER IF EXISTS update_docs_updated_at ON docs;
CREATE TRIGGER update_docs_updated_at BEFORE UPDATE ON docs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_events_updated_at ON events;
CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- TRANSCRIPTION TABLES (Voice Call Transcription)
-- ============================================================================

-- Transcription sessions table
-- Stores session metadata and final transcripts for voice calls
CREATE TABLE IF NOT EXISTS transcription_sessions (
  call_id VARCHAR(255) PRIMARY KEY,
  room_name VARCHAR(255) NOT NULL,
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'processing', 'completed', 'failed')),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  transcripts JSONB DEFAULT '{}'::jsonb, -- {participantEmail: [transcript strings]}
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcription_sessions_status ON transcription_sessions(status);
CREATE INDEX IF NOT EXISTS idx_transcription_sessions_room_name ON transcription_sessions(room_name);
CREATE INDEX IF NOT EXISTS idx_transcription_sessions_started_at ON transcription_sessions(started_at);

-- Transcription chunks table
-- Tracks individual audio chunks that have been processed
CREATE TABLE IF NOT EXISTS transcription_chunks (
  id SERIAL PRIMARY KEY,
  call_id VARCHAR(255) NOT NULL,
  participant_email VARCHAR(255) NOT NULL,
  chunk_index INTEGER NOT NULL,
  storage_url VARCHAR(500), -- GCS URL where audio chunk is stored
  processed_at TIMESTAMP,
  transcript TEXT,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (call_id) REFERENCES transcription_sessions(call_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transcription_chunks_call_id ON transcription_chunks(call_id);
CREATE INDEX IF NOT EXISTS idx_transcription_chunks_participant ON transcription_chunks(call_id, participant_email);
CREATE INDEX IF NOT EXISTS idx_transcription_chunks_processed ON transcription_chunks(processed_at);

-- Add updated_at trigger for transcription_sessions
CREATE OR REPLACE FUNCTION update_transcription_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transcription_sessions_updated_at ON transcription_sessions;
CREATE TRIGGER transcription_sessions_updated_at
  BEFORE UPDATE ON transcription_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_transcription_sessions_updated_at();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE users IS 'Organization-specific user profiles (links to global users in shared DB)';
COMMENT ON TABLE teams IS 'Teams within this organization';
COMMENT ON TABLE projects IS 'Projects within this organization';
COMMENT ON TABLE tasks IS 'Tasks within this organization';
COMMENT ON TABLE docs IS 'Docs within this organization';
COMMENT ON TABLE integrations IS 'Third-party integrations for this organization';
COMMENT ON TABLE transcription_sessions IS 'Voice call transcription sessions for this organization';
COMMENT ON TABLE transcription_chunks IS 'Individual audio chunks processed for transcription';
