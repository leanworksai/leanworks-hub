-- Migration: Add platform events table for the unified event bus
-- This table stores all platform events for history, replay, and querying.

-- Platform events table
CREATE TABLE IF NOT EXISTS platform_events (
  id VARCHAR(50) PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(50) NOT NULL,
  actor_type VARCHAR(20) NOT NULL,
  actor_id VARCHAR(255) NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  mentions JSONB DEFAULT '[]'::jsonb,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_events_entity ON platform_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_platform_events_type ON platform_events(event_type);
CREATE INDEX IF NOT EXISTS idx_platform_events_timestamp ON platform_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_platform_events_actor ON platform_events(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_platform_events_mentions ON platform_events USING GIN (mentions);

COMMENT ON TABLE platform_events IS 'Unified event bus - stores all platform events for history, replay, and agent delivery';
COMMENT ON COLUMN platform_events.event_type IS 'Dot-notation event type, e.g. task.created, project.commented';
COMMENT ON COLUMN platform_events.entity_type IS 'Entity type: task, project, plan, discussion, agent';
COMMENT ON COLUMN platform_events.actor_type IS 'Who triggered the event: human, ai_agent, or system';
COMMENT ON COLUMN platform_events.mentions IS 'JSONB array of @mentioned user emails or agent IDs extracted from content';
