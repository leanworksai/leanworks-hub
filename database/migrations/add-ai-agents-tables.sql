-- ============================================================================
-- AI AGENTS & TEAMS TABLES
-- ============================================================================

-- AI Agents table - Registry of available AI agents
CREATE TABLE IF NOT EXISTS ai_agents (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  agent_type VARCHAR(50) NOT NULL CHECK (agent_type IN ('webhook', 'api', 'mcp_server')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'error')),
  
  -- Configuration
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  auth_config JSONB DEFAULT '{}'::jsonb,
  capabilities JSONB DEFAULT '[]'::jsonb,
  
  -- Metadata
  avatar VARCHAR(10),
  created_by VARCHAR(255) NOT NULL,
  last_triggered_at TIMESTAMP,
  total_tasks_completed INTEGER DEFAULT 0,
  average_response_time_ms INTEGER,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE ai_agents IS 'Registry of AI agents available for task assignment';
COMMENT ON COLUMN ai_agents.agent_type IS 'Type: webhook (agent polls/receives webhooks), api (we call their API), mcp_server (MCP protocol)';
COMMENT ON COLUMN ai_agents.config IS 'Configuration JSON: {webhookUrl, callbackUrl, headers, timeout, etc.}';
COMMENT ON COLUMN ai_agents.auth_config IS 'References to secrets in Secret Manager: {secretName: "ai-agent-xyz-token"}';

CREATE INDEX IF NOT EXISTS idx_ai_agents_status ON ai_agents(status);
CREATE INDEX IF NOT EXISTS idx_ai_agents_type ON ai_agents(agent_type);
CREATE INDEX IF NOT EXISTS idx_ai_agents_created_by ON ai_agents(created_by);

-- AI Agent Teams - Logical grouping of agents
CREATE TABLE IF NOT EXISTS ai_agent_teams (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  team_id VARCHAR(50) REFERENCES teams(id) ON DELETE SET NULL,
  project_id VARCHAR(50) REFERENCES projects(id) ON DELETE SET NULL,
  avatar VARCHAR(10),
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE ai_agent_teams IS 'Logical grouping of AI agents for project/task assignment';

CREATE INDEX IF NOT EXISTS idx_ai_agent_teams_team ON ai_agent_teams(team_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_teams_project ON ai_agent_teams(project_id);

-- AI Agent Team Members - Many-to-many relationship
CREATE TABLE IF NOT EXISTS ai_agent_team_members (
  id SERIAL PRIMARY KEY,
  team_id VARCHAR(50) NOT NULL REFERENCES ai_agent_teams(id) ON DELETE CASCADE,
  agent_id VARCHAR(50) NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  role VARCHAR(100),
  priority INTEGER DEFAULT 0,
  added_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(team_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_team_members_team ON ai_agent_team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_team_members_agent ON ai_agent_team_members(agent_id);

-- Task AI Agent Assignments - Track which agents are assigned to tasks
CREATE TABLE IF NOT EXISTS task_ai_assignments (
  id VARCHAR(50) PRIMARY KEY,
  task_id VARCHAR(50) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id VARCHAR(50) REFERENCES ai_agents(id) ON DELETE CASCADE,
  agent_team_id VARCHAR(50) REFERENCES ai_agent_teams(id) ON DELETE CASCADE,
  
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  
  result JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  execution_logs JSONB DEFAULT '[]'::jsonb,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE task_ai_assignments IS 'Tracks AI agent assignments to tasks';
COMMENT ON COLUMN task_ai_assignments.result IS 'JSON result from agent execution';

CREATE INDEX IF NOT EXISTS idx_task_ai_assignments_task ON task_ai_assignments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_ai_assignments_agent ON task_ai_assignments(agent_id);
CREATE INDEX IF NOT EXISTS idx_task_ai_assignments_team ON task_ai_assignments(agent_team_id);
CREATE INDEX IF NOT EXISTS idx_task_ai_assignments_status ON task_ai_assignments(status);

-- AI Agent Activity - Activity feed for agent actions
CREATE TABLE IF NOT EXISTS ai_agent_activity (
  id VARCHAR(50) PRIMARY KEY,
  agent_id VARCHAR(50) NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  task_id VARCHAR(50) REFERENCES tasks(id) ON DELETE CASCADE,
  assignment_id VARCHAR(50) REFERENCES task_ai_assignments(id) ON DELETE CASCADE,
  
  activity_type VARCHAR(50) NOT NULL CHECK (activity_type IN ('assigned', 'started', 'progress_update', 'completed', 'failed', 'comment')),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_agent_activity IS 'Activity feed for AI agent actions and updates';

CREATE INDEX IF NOT EXISTS idx_ai_agent_activity_agent ON ai_agent_activity(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_activity_task ON ai_agent_activity(task_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_activity_assignment ON ai_agent_activity(assignment_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_activity_timestamp ON ai_agent_activity(timestamp DESC);

-- Extend tasks table with assignee_type column
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS assignee_type VARCHAR(20) DEFAULT 'human' CHECK (assignee_type IN ('human', 'ai_agent', 'ai_team'));

COMMENT ON COLUMN tasks.assignee_type IS 'Type of assignee: human (regular user), ai_agent (single AI agent), ai_team (team of AI agents)';

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_type ON tasks(assignee_type);

-- Add triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_ai_agents_updated_at ON ai_agents;
CREATE TRIGGER update_ai_agents_updated_at BEFORE UPDATE ON ai_agents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ai_agent_teams_updated_at ON ai_agent_teams;
CREATE TRIGGER update_ai_agent_teams_updated_at BEFORE UPDATE ON ai_agent_teams FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_task_ai_assignments_updated_at ON task_ai_assignments;
CREATE TRIGGER update_task_ai_assignments_updated_at BEFORE UPDATE ON task_ai_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
