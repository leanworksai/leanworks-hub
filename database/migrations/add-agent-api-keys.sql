-- Migration: Add agent API keys table and comment author columns
-- Supports Phase 2 (Agent API) and Phase 6 (Developer Portal)

-- Add api_key_hash column to ai_agents for simple key auth
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS api_key_hash VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_ai_agents_api_key_hash ON ai_agents(api_key_hash);

-- Agent API keys table (supports multiple keys per agent)
CREATE TABLE IF NOT EXISTS agent_api_keys (
  id VARCHAR(50) PRIMARY KEY,
  agent_id VARCHAR(50) NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  key_hash VARCHAR(128) NOT NULL,
  key_prefix VARCHAR(20) NOT NULL,  -- first ~18 chars for identification
  label VARCHAR(100),
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_agent_api_keys_hash ON agent_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_agent ON agent_api_keys(agent_id);

COMMENT ON TABLE agent_api_keys IS 'API keys for AI agent authentication (supports multiple keys per agent)';
COMMENT ON COLUMN agent_api_keys.key_hash IS 'SHA-256 hash of the API key (plaintext never stored)';
COMMENT ON COLUMN agent_api_keys.key_prefix IS 'First ~18 chars of the key for identification in UI';

-- Add author_type and agent_id to task_comments
ALTER TABLE task_comments
  ADD COLUMN IF NOT EXISTS author_type VARCHAR(20) DEFAULT 'human'
    CHECK (author_type IN ('human', 'ai_agent')),
  ADD COLUMN IF NOT EXISTS agent_id VARCHAR(50) REFERENCES ai_agents(id) ON DELETE SET NULL;

-- Add author_type and agent_id to project_comments
ALTER TABLE project_comments
  ADD COLUMN IF NOT EXISTS author_type VARCHAR(20) DEFAULT 'human'
    CHECK (author_type IN ('human', 'ai_agent')),
  ADD COLUMN IF NOT EXISTS agent_id VARCHAR(50) REFERENCES ai_agents(id) ON DELETE SET NULL;

-- Extend ai_agent_activity check constraint to include 'api_call' type
-- (PostgreSQL doesn't support ALTER CHECK easily, so we drop and recreate)
ALTER TABLE ai_agent_activity DROP CONSTRAINT IF EXISTS ai_agent_activity_activity_type_check;
ALTER TABLE ai_agent_activity ADD CONSTRAINT ai_agent_activity_activity_type_check
  CHECK (activity_type IN ('assigned', 'started', 'progress_update', 'completed', 'failed', 'comment', 'api_call', 'triggered', 'mention'));
