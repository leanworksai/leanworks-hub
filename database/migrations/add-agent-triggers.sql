-- Migration: Add agent triggers table
-- Supports Phase 4: Direct execution from any entity

-- Agent triggers table (tracks agent invocations on any entity)
CREATE TABLE IF NOT EXISTS agent_triggers (
  id VARCHAR(50) PRIMARY KEY,
  agent_id VARCHAR(50) NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  trigger_type VARCHAR(50) NOT NULL,  -- 'task_assignment', 'direct_invocation', 'mention', 'subscription'
  entity_type VARCHAR(50) NOT NULL,  -- 'task', 'project', 'plan'
  entity_id VARCHAR(50) NOT NULL,
  triggered_by VARCHAR(255) NOT NULL,  -- user email, agent ID, or 'system'
  prompt TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  result JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_triggers_agent ON agent_triggers(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_entity ON agent_triggers(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_status ON agent_triggers(status);

COMMENT ON TABLE agent_triggers IS 'Tracks all agent trigger invocations across any entity type';

-- Add delegation columns to task_ai_assignments
ALTER TABLE task_ai_assignments
  ADD COLUMN IF NOT EXISTS delegated_by_agent_id VARCHAR(50) REFERENCES ai_agents(id),
  ADD COLUMN IF NOT EXISTS delegation_context TEXT;
