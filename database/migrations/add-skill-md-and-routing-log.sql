-- Migration: Add SKILL.md support and Lean routing log
-- Adds skill_md, skill_summary, skill_version columns to ai_agents
-- Creates lean_routing_log table for tracking Lean orchestrator decisions

-- ============================================================================
-- 1. Add SKILL.md columns to ai_agents
-- ============================================================================

ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS skill_md TEXT;
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS skill_summary VARCHAR(500);
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS skill_version VARCHAR(20);

COMMENT ON COLUMN ai_agents.skill_md IS 'Full SKILL.md content describing when/how to use this agent (natural language)';
COMMENT ON COLUMN ai_agents.skill_summary IS 'Auto-extracted one-line summary from SKILL.md for lightweight discovery';
COMMENT ON COLUMN ai_agents.skill_version IS 'Version from SKILL.md frontmatter';

-- Index for querying agents with skills
CREATE INDEX IF NOT EXISTS idx_ai_agents_has_skill ON ai_agents(status) WHERE skill_md IS NOT NULL;

-- ============================================================================
-- 2. Create lean_routing_log table
-- ============================================================================

CREATE TABLE IF NOT EXISTS lean_routing_log (
  id VARCHAR(50) PRIMARY KEY,
  event_id VARCHAR(50),
  event_type VARCHAR(100) NOT NULL,
  agent_id VARCHAR(50) NOT NULL,
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('triggered', 'skipped')),
  reasoning TEXT,
  confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  context_passed JSONB DEFAULT '{}'::jsonb,
  latency_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE lean_routing_log IS 'Log of Lean orchestrator routing decisions for observability';
COMMENT ON COLUMN lean_routing_log.reasoning IS 'Lean natural-language explanation of why it triggered or skipped this agent';
COMMENT ON COLUMN lean_routing_log.confidence IS 'LLM confidence score for the routing decision (0.00 to 1.00)';

CREATE INDEX IF NOT EXISTS idx_lean_routing_log_agent ON lean_routing_log(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lean_routing_log_event_type ON lean_routing_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lean_routing_log_event_id ON lean_routing_log(event_id);
