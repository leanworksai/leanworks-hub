import { getPool } from './config.js';
import { QueryResult } from 'pg';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Execute a query with parameters
 */
export async function query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const pool = await getPool();
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`Slow query (${duration}ms):`, text.substring(0, 100));
    }
    return result;
  } catch (error) {
    console.error('Database query error:', error);
    console.error('Query:', text);
    console.error('Params:', params);
    throw error;
  }
}

/**
 * Execute a query and return first row or null
 */
export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] || null;
}

/**
 * Execute a query and return all rows
 */
export async function queryMany<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

/**
 * Begin a transaction
 */
export async function beginTransaction() {
  await query('BEGIN');
}

/**
 * Commit a transaction
 */
export async function commitTransaction() {
  await query('COMMIT');
}

/**
 * Rollback a transaction
 */
export async function rollbackTransaction() {
  await query('ROLLBACK');
}

/**
 * Execute function within a transaction
 */
export async function transaction<T>(callback: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// USER QUERIES
// ============================================================================

export const userQueries = {
  async getByEmail(email: string) {
    return queryOne(
      'SELECT email, first_name, last_name, job_title, responsibilities, domain, created_at FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
  },

  async getByDomain(domain: string) {
    return queryMany(
      'SELECT email, first_name, last_name, job_title, responsibilities, domain, created_at FROM users WHERE domain = $1 ORDER BY created_at DESC',
      [domain]
    );
  },

  async create(userData: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    responsibilities?: string;
    domain: string;
  }) {
    return query(
      `INSERT INTO users (email, password_hash, first_name, last_name, job_title, responsibilities, domain)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         job_title = EXCLUDED.job_title,
         responsibilities = EXCLUDED.responsibilities,
         updated_at = NOW()`,
      [userData.email.toLowerCase(), userData.passwordHash, userData.firstName, userData.lastName, userData.jobTitle, userData.responsibilities || null, userData.domain]
    );
  },

  async updateLastLogin(email: string) {
    return query(
      'UPDATE users SET last_login = NOW() WHERE email = $1',
      [email.toLowerCase()]
    );
  },
};

// ============================================================================
// TEAM QUERIES
// ============================================================================

export const teamQueries = {
  async getByDomain(domain: string) {
    const result = await queryMany(`
      SELECT 
        t.id, t.name, t.description, t.avatar, t.owner_email,
        ts.member_count as members,
        COALESCE(
          (SELECT COUNT(DISTINCT pm.project_id) 
           FROM team_members tm 
           JOIN project_members pm ON tm.user_email = pm.user_email 
           WHERE tm.team_id = t.id), 
          0
        ) as projects
      FROM teams t
      LEFT JOIN team_stats ts ON t.id = ts.team_id
      WHERE t.domain = $1
      ORDER BY t.created_at DESC
    `, [domain]);
    return result;
  },

  async getById(teamId: string, domain: string) {
    return queryOne(`
      SELECT 
        t.id, t.name, t.description, t.avatar, t.owner_email,
        json_agg(
          json_build_object(
            'name', tm_user.first_name || ' ' || tm_user.last_name,
            'email', tm.user_email,
            'role', tm.role,
            'avatar', tm.avatar
          )
        ) FILTER (WHERE tm.user_email IS NOT NULL) as members
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      LEFT JOIN users tm_user ON tm.user_email = tm_user.email
      WHERE t.id = $1 AND t.domain = $2
      GROUP BY t.id, t.name, t.description, t.avatar, t.owner_email
    `, [teamId, domain]);
  },

  async getByName(teamName: string, domain: string) {
    return queryOne(
      'SELECT id, name, description, avatar, owner_email FROM teams WHERE name = $1 AND domain = $2',
      [teamName, domain]
    );
  },

  async create(teamData: {
    id: string;
    name: string;
    description?: string;
    avatar?: string;
    domain: string;
    ownerEmail: string;
  }) {
    return query(
      `INSERT INTO teams (id, name, description, avatar, domain, owner_email)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         avatar = EXCLUDED.avatar,
         owner_email = EXCLUDED.owner_email,
         updated_at = NOW()`,
      [teamData.id, teamData.name, teamData.description || null, teamData.avatar || null, teamData.domain, teamData.ownerEmail]
    );
  },

  async update(teamId: string, updates: any) {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.avatar !== undefined) {
      setClauses.push(`avatar = $${paramIndex++}`);
      values.push(updates.avatar);
    }

    if (setClauses.length === 0) return;

    values.push(teamId);
    return query(
      `UPDATE teams SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex}`,
      values
    );
  },

  async delete(teamId: string) {
    return query('DELETE FROM teams WHERE id = $1', [teamId]);
  },

  async addMember(teamId: string, memberData: {
    userEmail: string;
    role?: string;
    avatar?: string;
  }) {
    return query(
      `INSERT INTO team_members (team_id, user_email, role, avatar)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (team_id, user_email) DO UPDATE SET
         role = EXCLUDED.role,
         avatar = EXCLUDED.avatar`,
      [teamId, memberData.userEmail, memberData.role || null, memberData.avatar || null]
    );
  },

  async removeMember(teamId: string, userEmail: string) {
    return query(
      'DELETE FROM team_members WHERE team_id = $1 AND user_email = $2',
      [teamId, userEmail]
    );
  },

  async isMember(teamId: string, userEmail: string): Promise<boolean> {
    const result = await queryOne(
      'SELECT 1 FROM team_members WHERE team_id = $1 AND user_email = $2',
      [teamId, userEmail]
    );
    return !!result;
  },
};

// ============================================================================
// PROJECT QUERIES
// ============================================================================

export const projectQueries = {
  async getByDomain(domain: string) {
    return queryMany(`
      SELECT 
        p.*,
        json_agg(
          DISTINCT jsonb_build_object(
            'id', pm.user_email,
            'name', u.first_name || ' ' || u.last_name,
            'role', pm.role,
            'avatar', pm.avatar
          )
        ) FILTER (WHERE pm.user_email IS NOT NULL) as members
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id
      LEFT JOIN users u ON pm.user_email = u.email
      WHERE p.domain = $1
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, [domain]);
  },

  async getById(projectId: string, domain: string) {
    return queryOne(`
      SELECT 
        p.*,
        json_agg(
          DISTINCT jsonb_build_object(
            'id', pm.user_email,
            'name', u.first_name || ' ' || u.last_name,
            'role', pm.role,
            'avatar', pm.avatar
          )
        ) FILTER (WHERE pm.user_email IS NOT NULL) as members,
        (SELECT json_agg(json_build_object(
          'id', upd.update_id,
          'memberName', COALESCE(u.first_name || ' ' || u.last_name, upd.user_id),
          'memberAvatar', COALESCE(
            CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
              THEN UPPER(SUBSTRING(u.first_name, 1, 1) || SUBSTRING(u.last_name, 1, 1))
              ELSE UPPER(SUBSTRING(upd.user_id, 1, 2))
            END,
            'U'
          ),
          'date', upd.date_id,
          'update', upd.update_text
        ) ORDER BY upd.timestamp DESC) FROM task_progress_updates upd 
        LEFT JOIN users u ON upd.user_id = u.email
        WHERE upd.project_id = p.id) as "progressUpdates",
        (SELECT json_agg(json_build_object(
          'id', pc.id,
          'memberName', pc.member_name,
          'memberAvatar', pc.member_avatar,
          'date', pc.date,
          'comment', pc.comment
        ) ORDER BY pc.created_at DESC) FROM project_comments pc WHERE pc.project_id = p.id) as comments
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id
      LEFT JOIN users u ON pm.user_email = u.email
      WHERE p.id = $1 AND p.domain = $2
      GROUP BY p.id
    `, [projectId, domain]);
  },

  async create(projectData: any) {
    return query(
      `INSERT INTO projects (
        id, name, description, detailed_description, status, status_color,
        domain, team_count, due_date, created_date, created_at,
        summary_accomplishment, summary_decision, summary_risk, summary_direction
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        updated_at = NOW()`,
      [
        projectData.id, projectData.name, projectData.description || null,
        projectData.detailedDescription || null, projectData.status || null,
        projectData.statusColor || null, projectData.domain, projectData.team || 0,
        projectData.dueDate || null, projectData.createdDate || null,
        projectData.createdAt || null, projectData.summary?.accomplishment || null,
        projectData.summary?.decision || null, projectData.summary?.risk || null,
        projectData.summary?.direction || null
      ]
    );
  },

  async update(projectId: string, updates: any) {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      detailedDescription: 'detailed_description',
      status: 'status',
      statusColor: 'status_color',
      team: 'team_count',
      dueDate: 'due_date',
    };

    for (const [key, dbField] of Object.entries(fieldMap)) {
      if (updates[key] !== undefined) {
        setClauses.push(`${dbField} = $${paramIndex++}`);
        values.push(updates[key]);
      }
    }

    // Handle summary object
    if (updates.summary) {
      if (updates.summary.accomplishment !== undefined) {
        setClauses.push(`summary_accomplishment = $${paramIndex++}`);
        values.push(updates.summary.accomplishment);
      }
      if (updates.summary.decision !== undefined) {
        setClauses.push(`summary_decision = $${paramIndex++}`);
        values.push(updates.summary.decision);
      }
      if (updates.summary.risk !== undefined) {
        setClauses.push(`summary_risk = $${paramIndex++}`);
        values.push(updates.summary.risk);
      }
      if (updates.summary.direction !== undefined) {
        setClauses.push(`summary_direction = $${paramIndex++}`);
        values.push(updates.summary.direction);
      }
    }

    if (setClauses.length === 0) return;

    values.push(projectId);
    return query(
      `UPDATE projects SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex}`,
      values
    );
  },

  async delete(projectId: string) {
    return query('DELETE FROM projects WHERE id = $1', [projectId]);
  },

  async addMember(projectId: string, memberData: {
    userEmail: string;
    role?: string;
    avatar?: string;
  }) {
    return query(
      `INSERT INTO project_members (project_id, user_email, role, avatar)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, user_email) DO UPDATE SET
         role = EXCLUDED.role,
         avatar = EXCLUDED.avatar`,
      [projectId, memberData.userEmail, memberData.role || null, memberData.avatar || null]
    );
  },
};

// ============================================================================
// TASK QUERIES
// ============================================================================

export const taskQueries = {
  async getByDomain(domain: string) {
    return queryMany(`
      SELECT 
        t.*,
        p.team_id
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.domain = $1
      ORDER BY t.created_at DESC
    `, [domain]);
  },

  async getById(taskId: string, domain: string) {
    return queryOne(`
      SELECT 
        t.*,
        p.team_id,
        (SELECT json_agg(json_build_object(
          'id', tc.id,
          'memberName', tc.member_name,
          'memberAvatar', tc.member_avatar,
          'date', tc.date,
          'comment', tc.comment
        ) ORDER BY tc.created_at DESC) FROM task_comments tc WHERE tc.task_id = t.id) as comments
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.id = $1 AND t.domain = $2
    `, [taskId, domain]);
  },

  async getByProject(projectId: string, domain: string) {
    return queryMany(`
      SELECT 
        t.*,
        p.team_id
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.project_id = $1 AND t.domain = $2
      ORDER BY t.created_at DESC
    `, [projectId, domain]);
  },

  async create(taskData: any, domain: string) {
    return query(
      `INSERT INTO tasks (
        id, title, description, status, priority, assignee_id, assignee_name,
        assignee_avatar, project_id, project_name, domain, created_by,
        due_date, created_date, created_at, estimated_hours, actual_hours,
        tags, reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        taskData.id, taskData.title, taskData.description || null,
        taskData.status || 'todo', taskData.priority || 'medium',
        taskData.assigneeId || null, taskData.assignee || null,
        taskData.assigneeAvatar || null, taskData.projectId || null,
        taskData.project || null, domain, taskData.createdBy || null,
        taskData.dueDate || null, taskData.createdDate || null,
        taskData.createdAt || null, taskData.estimatedHours || null,
        taskData.actualHours || null, JSON.stringify(taskData.tags || []),
        taskData.reason || null
      ]
    );
  },

  async update(taskId: string, updates: any) {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, string> = {
      title: 'title',
      description: 'description',
      status: 'status',
      priority: 'priority',
      assigneeId: 'assignee_id',
      assignee: 'assignee_name',
      assigneeAvatar: 'assignee_avatar',
      projectId: 'project_id',
      project: 'project_name',
      dueDate: 'due_date',
      estimatedHours: 'estimated_hours',
      actualHours: 'actual_hours',
      reason: 'reason',
    };

    for (const [key, dbField] of Object.entries(fieldMap)) {
      if (updates[key] !== undefined) {
        setClauses.push(`${dbField} = $${paramIndex++}`);
        values.push(updates[key]);
      }
    }

    if (updates.tags !== undefined) {
      setClauses.push(`tags = $${paramIndex++}`);
      values.push(JSON.stringify(updates.tags));
    }

    if (setClauses.length === 0) return;

    values.push(taskId);
    return query(
      `UPDATE tasks SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex}`,
      values
    );
  },

  async delete(taskId: string) {
    return query('DELETE FROM tasks WHERE id = $1', [taskId]);
  },
};

// ============================================================================
// MESSAGES - FIRESTORE ONLY
// ============================================================================

// Messages are stored ONLY in Firestore for real-time capabilities
// No PostgreSQL queries needed - all message operations use Firestore directly
// Path: domains/{domain}/messages
// This ensures true real-time messaging without sync complexity

// ============================================================================
// INTEGRATION QUERIES
// ============================================================================

export const integrationQueries = {
  async getByDomain(domain: string) {
    return queryMany(
      `SELECT domain, integration_id, integration_name, connected, 
              secret_name, connected_at, installation_id, metadata
       FROM integrations 
       WHERE domain = $1`,
      [domain]
    );
  },

  async getByIntegrationId(domain: string, integrationId: string) {
    return queryOne(
      `SELECT domain, integration_id, integration_name, connected, 
              secret_name, connected_at, installation_id, metadata
       FROM integrations 
       WHERE domain = $1 AND integration_id = $2`,
      [domain, integrationId]
    );
  },

  async upsert(domain: string, integrationData: {
    integrationId: string;
    integrationName: string;
    connected: boolean;
    secretName?: string;
    installationId?: number;
  }) {
    return query(
      `INSERT INTO integrations (
        domain, integration_id, integration_name, connected,
        secret_name, installation_id, connected_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (domain, integration_id) DO UPDATE SET
        integration_name = EXCLUDED.integration_name,
        connected = EXCLUDED.connected,
        secret_name = EXCLUDED.secret_name,
        installation_id = EXCLUDED.installation_id,
        updated_at = NOW()`,
      [
        domain,
        integrationData.integrationId,
        integrationData.integrationName,
        integrationData.connected,
        integrationData.secretName || null,
        integrationData.installationId || null
      ]
    );
  },

  async delete(domain: string, integrationId: string) {
    return query(
      'DELETE FROM integrations WHERE domain = $1 AND integration_id = $2',
      [domain, integrationId]
    );
  },
};

// ============================================================================
// UPDATE SUMMARIES QUERIES
// ============================================================================

export const updateSummaryQueries = {
  async getByProjectId(projectId: string, domain: string) {
    return queryOne(
      `SELECT project_id, date_id, update_summary 
       FROM project_progress_updates 
       WHERE project_id = $1 
       ORDER BY date_id DESC 
       LIMIT 1`,
      [projectId]
    );
  },

  async getLatestByDomain(domain: string) {
    const result = await queryMany(
      `SELECT DISTINCT ON (project_id) 
        project_id, date_id, update_summary 
       FROM project_progress_updates 
       ORDER BY project_id, date_id DESC`,
      []
    );
    
    // Convert to object format
    const summaries: Record<string, { dateId: string; updateSummary: string }> = {};
    result.forEach((row: any) => {
      summaries[row.project_id] = {
        dateId: row.date_id,
        updateSummary: row.update_summary
      };
    });
    return summaries;
  },
};

// ============================================================================
// GITHUB INSTALLATION QUERIES
// ============================================================================

export const githubInstallationQueries = {
  async getByInstallationId(installationId: number) {
    return queryOne(
      'SELECT installation_id, domain, setup_action, created_at FROM github_installations WHERE installation_id = $1',
      [installationId]
    );
  },

  async upsert(installationData: {
    installationId: number;
    domain: string;
    setupAction?: string;
  }) {
    return query(
      `INSERT INTO github_installations (installation_id, domain, setup_action)
       VALUES ($1, $2, $3)
       ON CONFLICT (installation_id) DO UPDATE SET
         domain = EXCLUDED.domain,
         setup_action = EXCLUDED.setup_action,
         updated_at = NOW()`,
      [installationData.installationId, installationData.domain, installationData.setupAction || null]
    );
  },

  async delete(installationId: number) {
    return query('DELETE FROM github_installations WHERE installation_id = $1', [installationId]);
  },
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Refresh materialized views
 */
export async function refreshMaterializedViews() {
  await query('SELECT refresh_team_stats()');
  await query('REFRESH MATERIALIZED VIEW CONCURRENTLY project_stats');
}

/**
 * Convert PostgreSQL result to Firestore-like format
 * (for backward compatibility with existing client code)
 */
export function convertToFirestoreFormat(data: any): any {
  if (!data) return null;
  
  // Convert snake_case to camelCase
  const converted: any = {};
  for (const [key, value] of Object.entries(data)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    converted[camelKey] = value;
  }
  
  // Handle special cases
  if (converted.summaryAccomplishment !== undefined) {
    converted.summary = {
      accomplishment: converted.summaryAccomplishment || '',
      decision: converted.summaryDecision || '',
      risk: converted.summaryRisk || '',
      direction: converted.summaryDirection || ''
    };
    delete converted.summaryAccomplishment;
    delete converted.summaryDecision;
    delete converted.summaryRisk;
    delete converted.summaryDirection;
  }
  
  // Parse JSON fields
  if (converted.members && typeof converted.members === 'string') {
    converted.members = JSON.parse(converted.members);
  }
  if (converted.tags && typeof converted.tags === 'string') {
    converted.tags = JSON.parse(converted.tags);
  }
  if (converted.progressUpdates && typeof converted.progressUpdates === 'string') {
    converted.progressUpdates = JSON.parse(converted.progressUpdates);
  }
  if (converted.comments && typeof converted.comments === 'string') {
    converted.comments = JSON.parse(converted.comments);
  }
  
  // Ensure arrays default to empty arrays
  converted.progressUpdates = converted.progressUpdates || [];
  converted.comments = converted.comments || [];
  converted.tags = converted.tags || [];
  converted.teams = converted.teams || [];
  converted.members = converted.members || [];
  
  return converted;
}

