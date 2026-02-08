-- Migration: Add agent event subscriptions and delivery log tables
-- Supports Phase 3: Agent Self-Subscription

-- Agent event subscriptions
CREATE TABLE IF NOT EXISTS agent_event_subscriptions (
  id VARCHAR(50) PRIMARY KEY,
  agent_id VARCHAR(50) NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  event_pattern VARCHAR(200) NOT NULL,  -- e.g. "task.*", "project.commented", "*.mention"
  filter_criteria JSONB DEFAULT '{}'::jsonb,  -- e.g. {"projectId": "proj-123"}
  delivery_method VARCHAR(20) NOT NULL CHECK (delivery_method IN ('webhook', 'sse')),
  webhook_url VARCHAR(500),  -- required if delivery_method = 'webhook'
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(agent_id, event_pattern, filter_criteria)
);

CREATE INDEX IF NOT EXISTS idx_agent_subscriptions_active ON agent_event_subscriptions(is_active, event_pattern);
CREATE INDEX IF NOT EXISTS idx_agent_subscriptions_agent ON agent_event_subscriptions(agent_id);

COMMENT ON TABLE agent_event_subscriptions IS 'Agent subscriptions to platform events for webhook/SSE delivery';
COMMENT ON COLUMN agent_event_subscriptions.event_pattern IS 'Glob-style event pattern: task.*, *.commented, plan.milestone_reached';

-- Event delivery log
CREATE TABLE IF NOT EXISTS event_delivery_log (
  id VARCHAR(50) PRIMARY KEY,
  subscription_id VARCHAR(50) REFERENCES agent_event_subscriptions(id) ON DELETE CASCADE,
  event_id VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'delivered', 'failed', 'retrying')),
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_delivery_log_sub ON event_delivery_log(subscription_id);
CREATE INDEX IF NOT EXISTS idx_event_delivery_log_event ON event_delivery_log(event_id);

COMMENT ON TABLE event_delivery_log IS 'Tracks delivery attempts for agent event subscriptions';

-- Add triggers
DROP TRIGGER IF EXISTS update_agent_event_subscriptions_updated_at ON agent_event_subscriptions;
CREATE TRIGGER update_agent_event_subscriptions_updated_at BEFORE UPDATE ON agent_event_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
