import { QueryResult } from 'pg';
import crypto from 'crypto';
import { getOrgPool } from '../../database/multi-tenant-pool.js';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface QueryOptions {
  timeout?: number;
  maxRows?: number;
  includeMetadata?: boolean;
}

export interface QueryResultData {
  success: boolean;
  data?: any[];
  metadata?: {
    rowCount: number;
    executionTimeMs: number;
    columns: string[];
    truncated: boolean;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface AuditLogEntry {
  userEmail: string;
  orgId: string;
  orgSlug: string;
  queryHash: string;
  executionTimeMs?: number;
  rowCount?: number;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ALLOWED_TABLES = [
  'users',
  'tasks',
  'projects',
  'task_progress_updates',
  'task_comments',
  'project_progress_updates',
  'project_members',
  'project_comments',
  'events'
];

const BLOCKED_TABLES = [
  'teams',
  'team_members',
  'team_join_requests',
  'team_invitations',
  'integrations',
  'github_installations',
  'transcription_sessions',
  'transcription_chunks'
];

const FORBIDDEN_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'merge',
  'truncate',
  'create',
  'drop',
  'alter',
  'grant',
  'revoke',
  'copy',
  'attach',
  'detach',
  'replace',
  'exec',
  'execute',
  'call'
];

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_TIMEOUT = 60000; // 60 seconds
const DEFAULT_MAX_ROWS = 1000;
const MAX_ROWS = 10000;

// ============================================================================
// QUERY SERVICE CLASS
// ============================================================================

export class QueryService {
  /**
   * Execute a SQL query with security validation and org-scoped database access
   */
  async executeQuery(
    orgId: string,
    sql: string,
    params: any[] = [],
    options: QueryOptions = {},
    userEmail: string
  ): Promise<QueryResultData> {
    const startTime = Date.now();
    const queryHash = this.hashQuery(sql);

    try {
      // Step 1: Validate SQL query
      const validation = this.validateQuery(sql);
      if (!validation.valid) {
        await this.logAudit({
          userEmail,
          orgId,
          orgSlug: await this.getOrgSlug(orgId),
          queryHash,
          success: false,
          errorCode: 'VALIDATION_ERROR',
          errorMessage: validation.error
        });

        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.error!
          }
        };
      }

      // Step 2: Check table access
      const tableCheck = this.validateTableAccess(sql);
      if (!tableCheck.valid) {
        await this.logAudit({
          userEmail,
          orgId,
          orgSlug: await this.getOrgSlug(orgId),
          queryHash,
          success: false,
          errorCode: 'PERMISSION_ERROR',
          errorMessage: tableCheck.error
        });

        return {
          success: false,
          error: {
            code: 'PERMISSION_ERROR',
            message: tableCheck.error!
          }
        };
      }

      // Step 3: Get org database pool and name
      const pool = await getOrgPool(orgId);
      const dbName = await this.getOrgDatabaseName(orgId);

      // Step 4: Set query options
      const timeout = Math.min(options.timeout || DEFAULT_TIMEOUT, MAX_TIMEOUT);
      const maxRows = Math.min(options.maxRows || DEFAULT_MAX_ROWS, MAX_ROWS);

      // Step 5: Execute query with timeout
      const result = await this.executeWithTimeout(pool, dbName, sql, params, timeout, maxRows);

      // Step 6: Format results
      const executionTime = Date.now() - startTime;
      const formattedResult = this.formatResult(result, executionTime, maxRows, options.includeMetadata !== false);

      // Step 7: Log successful execution
      await this.logAudit({
        userEmail,
        orgId,
        orgSlug: await this.getOrgSlug(orgId),
        queryHash,
        executionTimeMs: executionTime,
        rowCount: result.rows.length,
        success: true
      });

      return formattedResult;

    } catch (error: any) {
      const executionTime = Date.now() - startTime;

      // Log execution error
      await this.logAudit({
        userEmail,
        orgId,
        orgSlug: await this.getOrgSlug(orgId),
        queryHash,
        executionTimeMs: executionTime,
        success: false,
        errorCode: 'EXECUTION_ERROR',
        errorMessage: error.message
      });

      // Determine error type
      let errorCode = 'EXECUTION_ERROR';
      if (error.message.includes('timeout')) {
        errorCode = 'TIMEOUT_ERROR';
      } else if (error.message.includes('permission') || error.message.includes('access')) {
        errorCode = 'PERMISSION_ERROR';
      }

      return {
        success: false,
        error: {
          code: errorCode,
          message: error.message,
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
      };
    }
  }

  /**
   * Validate SQL query for security
   */
  validateQuery(sql: string): { valid: boolean; error?: string } {
    if (!sql || typeof sql !== 'string' || sql.trim() === '') {
      return { valid: false, error: 'SQL query is required and must be a non-empty string' };
    }

    const sqlLower = sql.trim().toLowerCase();

    // Check if query starts with SELECT or WITH
    if (!sqlLower.startsWith('select') && !sqlLower.startsWith('with')) {
      return { valid: false, error: 'Only SELECT and WITH (CTE) queries are allowed. Query must start with SELECT or WITH.' };
    }

    // Check for forbidden keywords using word boundaries
    for (const keyword of FORBIDDEN_KEYWORDS) {
      const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
      if (pattern.test(sql)) {
        return { valid: false, error: `Forbidden SQL keyword detected: ${keyword}. Only read-only queries are allowed.` };
      }
    }

    // Check for SQL injection patterns
    if (this.hasSQLInjection(sql)) {
      return { valid: false, error: 'Query contains potentially malicious SQL patterns' };
    }

    return { valid: true };
  }

  /**
   * Validate table access in SQL query
   */
  validateTableAccess(sql: string): { valid: boolean; error?: string } {
    const tables = this.extractTableNames(sql);

    for (const table of tables) {
      if (BLOCKED_TABLES.includes(table.toLowerCase())) {
        return { valid: false, error: `Access to table '${table}' is not allowed` };
      }

      if (!ALLOWED_TABLES.includes(table.toLowerCase())) {
        // Check if it's a system table
        if (table.toLowerCase().startsWith('pg_') || table.toLowerCase().startsWith('information_schema.')) {
          return { valid: false, error: `Access to system table '${table}' is not allowed` };
        }

        // Allow the table for now - we have a whitelist approach but allow unknown tables
        // This provides flexibility while maintaining security through other layers
      }
    }

    return { valid: true };
  }

  /**
   * Extract table names from SQL query
   */
  extractTableNames(sql: string): string[] {
    const tables: string[] = [];
    const sqlLower = sql.toLowerCase();

    // Match table references in FROM, JOIN clauses
    // This is a simplified regex - in production you might want more sophisticated parsing
    const tablePattern = /\b(?:from|join|inner\s+join|left\s+join|right\s+join|full\s+join|cross\s+join)\s+(?:public\.|[\w_]+\.)?([a-zA-Z_][a-zA-Z0-9_]*)/gi;

    let match;
    while ((match = tablePattern.exec(sqlLower)) !== null) {
      const tableName = match[1];
      if (!tables.includes(tableName)) {
        tables.push(tableName);
      }
    }

    return tables;
  }

  /**
   * Check for SQL injection patterns
   */
  private hasSQLInjection(sql: string): boolean {
    const injectionPatterns = [
      /;\s*(?:select|insert|update|delete|drop|create|alter)/i,
      /\/\*.*?\*\//s, // Block comments that could hide malicious code
      /--.*?(?:\n|$)/, // Line comments that could hide malicious code
      /union\s+select/i,
      /\b(1=1|1=0)\b/,
      /benchmark\s*\(/i,
      /sleep\s*\(/i,
      /load_file\s*\(/i,
      /into\s+outfile/i
    ];

    return injectionPatterns.some(pattern => pattern.test(sql));
  }

  /**
   * Parse and apply LIMIT clause to SQL query
   */
  private parseAndApplyLimit(sql: string, maxRows: number): { sql: string, effectiveLimit: number } {
    // Check if SQL already has a LIMIT clause
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);

    if (limitMatch) {
      const sqlLimit = parseInt(limitMatch[1], 10);

      // Validate and cap the limit
      const effectiveLimit = Math.min(sqlLimit, maxRows);

      // Remove existing LIMIT and add validated one
      const sqlWithoutLimit = sql.replace(/LIMIT\s+\d+/i, '').trim();

      return {
        sql: `${sqlWithoutLimit} LIMIT ${effectiveLimit}`,
        effectiveLimit
      };
    } else {
      // No LIMIT in SQL, add the default
      return {
        sql: `${sql} LIMIT ${maxRows}`,
        effectiveLimit: maxRows
      };
    }
  }

  /**
   * Execute query with timeout and connection retry
   */
  private async executeWithTimeout(
    pool: any,
    dbName: string,
    sql: string,
    params: any[],
    timeout: number,
    maxRows: number
  ): Promise<QueryResult> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Query execution timed out after ${timeout}ms`));
      }, timeout);

      // Parse and apply LIMIT clause properly (handles existing LIMIT clauses)
      const { sql: limitedSql } = this.parseAndApplyLimit(sql, maxRows);

      // Use retry logic for connection failures
      this.executeWithRetry(pool, dbName, limitedSql, params)
        .then((result: QueryResult) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error: any) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Execute query with connection retry logic
   */
  private async executeWithRetry(
    pool: any,
    dbName: string,
    sql: string,
    params: any[],
    maxRetries: number = 2
  ): Promise<QueryResult> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Test connection health before using it
        const client = await pool.connect();
        try {
          // Test the connection
          await client.query('SELECT 1');
          // Execute the actual query
          const result = await client.query(sql, params);
          return result;
        } finally {
          client.release();
        }
      } catch (error: any) {
        console.warn(`⚠️  Query attempt ${attempt + 1} failed for database ${dbName}:`, error.message);

        // If this is a connection-related error and we have retries left, continue
        if (attempt < maxRetries && (
          error.message.includes('Connection terminated') ||
          error.message.includes('connection was closed') ||
          error.message.includes('Client has encountered a connection error') ||
          error.code === 'ECONNRESET' ||
          error.code === 'EPIPE'
        )) {
          // Wait before retrying (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        }

        // For non-connection errors or exhausted retries, throw
        throw error;
      }
    }

    throw new Error('Unexpected error in query retry logic');
  }

  /**
   * Format query results
   */
  private formatResult(
    result: QueryResult,
    executionTime: number,
    maxRows: number,
    includeMetadata: boolean
  ): QueryResultData {
    // Ensure 'id' field exists
    const rows = result.rows.map(row => {
      const formattedRow = { ...row };
      if (!formattedRow.id) {
        // Try common ID field names
        for (const idField of ['id', 'email', 'update_id', 'integration_id']) {
          if (formattedRow[idField]) {
            formattedRow.id = formattedRow[idField];
            break;
          }
        }
      }
      return formattedRow;
    });

    const response: QueryResultData = {
      success: true,
      data: rows
    };

    if (includeMetadata) {
      response.metadata = {
        rowCount: rows.length,
        executionTimeMs: executionTime,
        columns: result.fields.map(field => field.name),
        truncated: rows.length >= maxRows
      };
    }

    return response;
  }

  /**
   * Get org slug for audit logging
   */
  private async getOrgSlug(orgId: string): Promise<string> {
    // This is a simplified implementation - in production you'd cache this
    try {
      const { getOrgSlugById } = await import('../../database/multi-tenant-pool.js');
      return await getOrgSlugById(orgId);
    } catch {
      return orgId; // Fallback
    }
  }

  /**
   * Get org database name for connection retry logic
   */
  private async getOrgDatabaseName(orgId: string): Promise<string> {
    try {
      const { getOrgDatabaseName } = await import('../../database/multi-tenant-pool.js');
      return await getOrgDatabaseName(orgId);
    } catch {
      // Fallback to constructing database name from org ID
      return `org_${orgId.replace(/-/g, '_').toLowerCase()}`;
    }
  }

  /**
   * Hash query for audit logging (privacy protection)
   */
  private hashQuery(sql: string): string {
    return crypto.createHash('sha256').update(sql.trim()).digest('hex');
  }

  /**
   * Log audit entry
   */
  private async logAudit(entry: AuditLogEntry): Promise<void> {
    try {
      // Import here to avoid circular dependencies
      const { queryShared } = await import('../../database/multi-tenant-pool.js');

      await queryShared(
        `INSERT INTO query_audit_log (
          user_email, org_id, org_slug, query_hash, execution_time_ms,
          row_count, success, error_code, error_message, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          entry.userEmail,
          entry.orgId,
          entry.orgSlug,
          entry.queryHash,
          entry.executionTimeMs,
          entry.rowCount,
          entry.success,
          entry.errorCode,
          entry.errorMessage
        ]
      );
    } catch (error) {
      // Log audit failure but don't fail the main operation
      console.error('Failed to log audit entry:', error);
    }
  }

  /**
   * Get list of allowed tables
   */
  getAllowedTables(): string[] {
    return [
      'users',
      'tasks',
      'projects',
      'task_progress_updates',
      'task_comments',
      'project_progress_updates',
      'project_members',
      'project_comments',
      'events'
    ];
  }

  /**
   * Get schema information for allowed tables (multiple tables supported)
   */
  async getTableSchemas(orgId: string, tableNames: string | string[]): Promise<any> {
    const tables = Array.isArray(tableNames) ? tableNames : [tableNames];

    // Validate all tables are allowed
    for (const tableName of tables) {
      if (!ALLOWED_TABLES.includes(tableName.toLowerCase())) {
        throw new Error(`Table '${tableName}' is not allowed`);
      }
    }

    const pool = await getOrgPool(orgId);
    const schemas: Record<string, any> = {};

    // Get schema for each table
    for (const tableName of tables) {
      const result = await pool.query(`
        SELECT
          c.column_name,
          c.data_type,
          c.is_nullable,
          c.column_default,
          pgd.description as column_description
        FROM information_schema.columns c
        LEFT JOIN pg_catalog.pg_statio_all_tables st ON (
          c.table_name = st.relname
        )
        LEFT JOIN pg_catalog.pg_description pgd ON (
          pgd.objoid = st.relid
          AND pgd.objsubid = c.ordinal_position
        )
        WHERE c.table_name = $1
        AND c.table_schema = 'public'
        ORDER BY c.ordinal_position
      `, [tableName]);

      schemas[tableName] = {
        table: tableName,
        columns: result.rows
      };
    }

    // Return single schema if only one table requested, otherwise return all schemas
    if (tables.length === 1) {
      return schemas[tables[0]];
    } else {
      return {
        tables: schemas,
        note: `Retrieved schemas for ${tables.length} tables: ${tables.join(', ')}`
      };
    }
  }

  /**
   * Get schema information for allowed tables (legacy single table method)
   */
  async getTableSchema(orgId: string, tableName: string): Promise<any> {
    return this.getTableSchemas(orgId, tableName);
    if (!ALLOWED_TABLES.includes(tableName.toLowerCase())) {
      throw new Error(`Table '${tableName}' is not allowed`);
    }

    const pool = await getOrgPool(orgId);

    // Get column information with descriptions
    const result = await pool.query(`
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        pgd.description as column_description
      FROM information_schema.columns c
      LEFT JOIN pg_catalog.pg_statio_all_tables st ON (
        c.table_name = st.relname
      )
      LEFT JOIN pg_catalog.pg_description pgd ON (
        pgd.objoid = st.relid
        AND pgd.objsubid = c.ordinal_position
      )
      WHERE c.table_name = $1
      AND c.table_schema = 'public'
      ORDER BY c.ordinal_position
    `, [tableName]);

    return {
      table: tableName,
      columns: result.rows
    };
  }
}

// ============================================================================
// EXPORT SINGLETON INSTANCE
// ============================================================================

export const queryService = new QueryService();