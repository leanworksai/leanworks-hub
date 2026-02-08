-- ============================================================================
-- Plans Tables Migration
-- Adds plans-related tables for strategic planning features
-- ============================================================================

-- Plans table
CREATE TABLE IF NOT EXISTS plans (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'at-risk', 'completed')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_budget DECIMAL(15,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  spent_to_date DECIMAL(15,2) DEFAULT 0,
  owner_email VARCHAR(255) NOT NULL,
  owner_name VARCHAR(255),
  team_size INTEGER DEFAULT 0,
  health_score INTEGER DEFAULT 100 CHECK (health_score >= 0 AND health_score <= 100),
  health_trend VARCHAR(20) DEFAULT 'stable' CHECK (health_trend IN ('up', 'down', 'stable')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plans_owner ON plans(owner_email);
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_start_date ON plans(start_date);
CREATE INDEX IF NOT EXISTS idx_plans_end_date ON plans(end_date);
CREATE INDEX IF NOT EXISTS idx_plans_created_at ON plans(created_at DESC);

-- Plan objectives
CREATE TABLE IF NOT EXISTS plan_objectives (
  id VARCHAR(50) PRIMARY KEY,
  plan_id VARCHAR(50) NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  text VARCHAR(255) NOT NULL,
  target_value DECIMAL(15,2) NOT NULL,
  current_value DECIMAL(15,2) DEFAULT 0,
  unit VARCHAR(50) NOT NULL CHECK (unit IN ('percentage', 'count', 'currency')),
  due_date DATE,
  status VARCHAR(50) DEFAULT 'on-track' CHECK (status IN ('on-track', 'at-risk', 'completed')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_objectives_plan ON plan_objectives(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_objectives_status ON plan_objectives(status);

-- Plan budget categories
CREATE TABLE IF NOT EXISTS plan_budget_categories (
  id VARCHAR(50) PRIMARY KEY,
  plan_id VARCHAR(50) NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  allocated_amount DECIMAL(15,2) NOT NULL,
  spent_amount DECIMAL(15,2) DEFAULT 0,
  project_id VARCHAR(50) REFERENCES projects(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_budget_categories_plan ON plan_budget_categories(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_budget_categories_project ON plan_budget_categories(project_id);

-- Plan resource allocations
CREATE TABLE IF NOT EXISTS plan_resource_allocations (
  id VARCHAR(50) PRIMARY KEY,
  plan_id VARCHAR(50) NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_email VARCHAR(255) NOT NULL,
  user_name VARCHAR(255),
  allocation_percentage INTEGER CHECK (allocation_percentage >= 0 AND allocation_percentage <= 100),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  role VARCHAR(255),
  hourly_rate DECIMAL(10,2),
  normalized_hours DECIMAL(8,2),
  project_id VARCHAR(50) REFERENCES projects(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_resource_allocations_plan ON plan_resource_allocations(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_resource_allocations_user ON plan_resource_allocations(user_email);
CREATE INDEX IF NOT EXISTS idx_plan_resource_allocations_project ON plan_resource_allocations(project_id);

-- Plan milestones
CREATE TABLE IF NOT EXISTS plan_milestones (
  id VARCHAR(50) PRIMARY KEY,
  plan_id VARCHAR(50) NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'at-risk')),
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_milestones_plan ON plan_milestones(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_milestones_due_date ON plan_milestones(due_date);
CREATE INDEX IF NOT EXISTS idx_plan_milestones_status ON plan_milestones(status);

-- Plan activity events
CREATE TABLE IF NOT EXISTS plan_activity_events (
  id VARCHAR(50) PRIMARY KEY,
  plan_id VARCHAR(50) NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('project_update', 'budget_change', 'milestone', 'resource_change')),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  user_id VARCHAR(255),
  user_name VARCHAR(255),
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_activity_events_plan ON plan_activity_events(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_activity_events_timestamp ON plan_activity_events(timestamp DESC);

-- Plan projects join table
CREATE TABLE IF NOT EXISTS plan_projects (
  id SERIAL PRIMARY KEY,
  plan_id VARCHAR(50) NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  project_id VARCHAR(50) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  linked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(plan_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_projects_plan ON plan_projects(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_projects_project ON plan_projects(project_id);

-- Update triggers for new tables (requires update_updated_at_column() already present)
DROP TRIGGER IF EXISTS update_plans_updated_at ON plans;
CREATE TRIGGER update_plans_updated_at BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_plan_objectives_updated_at ON plan_objectives;
CREATE TRIGGER update_plan_objectives_updated_at BEFORE UPDATE ON plan_objectives FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_plan_budget_categories_updated_at ON plan_budget_categories;
CREATE TRIGGER update_plan_budget_categories_updated_at BEFORE UPDATE ON plan_budget_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_plan_resource_allocations_updated_at ON plan_resource_allocations;
CREATE TRIGGER update_plan_resource_allocations_updated_at BEFORE UPDATE ON plan_resource_allocations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_plan_milestones_updated_at ON plan_milestones;
CREATE TRIGGER update_plan_milestones_updated_at BEFORE UPDATE ON plan_milestones FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
