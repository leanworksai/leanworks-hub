-- Migration: Add collaboration threads tables
-- Supports Phase 7: Agent Collaboration Protocol

-- Collaboration threads (multi-agent + human discussion on any entity)
CREATE TABLE IF NOT EXISTS collaboration_threads (
  id VARCHAR(50) PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(50) NOT NULL,
  title VARCHAR(255),
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'closed')),
  created_by_type VARCHAR(20) NOT NULL CHECK (created_by_type IN ('human', 'ai_agent')),
  created_by_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_collab_threads_entity ON collaboration_threads(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_collab_threads_status ON collaboration_threads(status);

-- Collaboration messages
CREATE TABLE IF NOT EXISTS collaboration_messages (
  id VARCHAR(50) PRIMARY KEY,
  thread_id VARCHAR(50) NOT NULL REFERENCES collaboration_threads(id) ON DELETE CASCADE,
  author_type VARCHAR(20) NOT NULL CHECK (author_type IN ('human', 'ai_agent')),
  author_id VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  mentions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collab_messages_thread ON collaboration_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_collab_messages_author ON collaboration_messages(author_type, author_id);

COMMENT ON TABLE collaboration_threads IS 'Structured collaboration threads for multi-agent and human discussion on any entity';
COMMENT ON TABLE collaboration_messages IS 'Messages within collaboration threads';
