import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { QueryService } from './query-service.js';

// Mock the multi-tenant-pool module
jest.mock('../../database/multi-tenant-pool.js', () => ({
  getOrgPool: jest.fn(),
  queryShared: jest.fn(),
  getOrgSlugById: jest.fn(),
}));

describe('QueryService', () => {
  let queryService: QueryService;

  beforeEach(() => {
    queryService = new QueryService();
    jest.clearAllMocks();
  });

  describe('validateQuery', () => {
    it('should accept valid SELECT queries', () => {
      const result = queryService.validateQuery('SELECT * FROM users');
      expect(result.valid).toBe(true);
    });

    it('should accept valid WITH queries', () => {
      const result = queryService.validateQuery('WITH cte AS (SELECT * FROM users) SELECT * FROM cte');
      expect(result.valid).toBe(true);
    });

    it('should reject INSERT queries', () => {
      const result = queryService.validateQuery('INSERT INTO users VALUES (1)');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Forbidden SQL keyword');
    });

    it('should reject UPDATE queries', () => {
      const result = queryService.validateQuery('UPDATE users SET name = "test"');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Forbidden SQL keyword');
    });

    it('should reject DELETE queries', () => {
      const result = queryService.validateQuery('DELETE FROM users WHERE id = 1');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Forbidden SQL keyword');
    });

    it('should reject DROP queries', () => {
      const result = queryService.validateQuery('DROP TABLE users');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Forbidden SQL keyword');
    });

    it('should reject CREATE queries', () => {
      const result = queryService.validateQuery('CREATE TABLE test (id INT)');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Forbidden SQL keyword');
    });

    it('should reject queries that do not start with SELECT or WITH', () => {
      const result = queryService.validateQuery('SHOW TABLES');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Only SELECT and WITH');
    });

    it('should reject empty queries', () => {
      const result = queryService.validateQuery('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required and must be a non-empty string');
    });

    it('should reject null queries', () => {
      const result = queryService.validateQuery(null as any);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be a non-empty string');
    });

    it('should reject queries with forbidden keywords in comments', () => {
      const result = queryService.validateQuery('SELECT * FROM users -- DROP TABLE users');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Forbidden SQL keyword');
    });

    it('should reject queries with SQL injection patterns', () => {
      const result = queryService.validateQuery('SELECT * FROM users; DROP TABLE users; --');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('potentially malicious SQL patterns');
    });

    it('should reject queries with UNION SELECT injection', () => {
      const result = queryService.validateQuery('SELECT * FROM users UNION SELECT password FROM admin');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('potentially malicious SQL patterns');
    });
  });

  describe('validateTableAccess', () => {
    it('should allow queries on allowed tables', () => {
      const result = queryService.validateTableAccess('SELECT * FROM users');
      expect(result.valid).toBe(true);
    });

    it('should allow queries on multiple allowed tables', () => {
      const result = queryService.validateTableAccess('SELECT u.name, t.title FROM users u JOIN tasks t ON u.email = t.assignee_id');
      expect(result.valid).toBe(true);
    });

    it('should reject queries on blocked tables', () => {
      const result = queryService.validateTableAccess('SELECT * FROM teams');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('should reject queries on system tables', () => {
      const result = queryService.validateTableAccess('SELECT * FROM pg_tables');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('system table');
    });

    it('should reject queries on information_schema tables', () => {
      const result = queryService.validateTableAccess('SELECT * FROM information_schema.tables');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('system table');
    });
  });

  describe('extractTableNames', () => {
    it('should extract table names from simple SELECT', () => {
      const tables = queryService.extractTableNames('SELECT * FROM users');
      expect(tables).toEqual(['users']);
    });

    it('should extract table names from JOIN queries', () => {
      const tables = queryService.extractTableNames('SELECT * FROM users u JOIN tasks t ON u.email = t.assignee_id');
      expect(tables).toEqual(['users', 'tasks']);
    });

    it('should extract table names from multiple JOINs', () => {
      const tables = queryService.extractTableNames('SELECT * FROM users u JOIN tasks t ON u.email = t.assignee_id JOIN projects p ON t.project_id = p.id');
      expect(tables).toEqual(['users', 'tasks', 'projects']);
    });

    it('should handle schema-qualified table names', () => {
      const tables = queryService.extractTableNames('SELECT * FROM public.users');
      expect(tables).toEqual(['users']);
    });

    it('should handle table aliases', () => {
      const tables = queryService.extractTableNames('SELECT * FROM users AS u');
      expect(tables).toEqual(['users']);
    });

    it('should return unique table names', () => {
      const tables = queryService.extractTableNames('SELECT * FROM users u JOIN users u2 ON u.email = u2.email');
      expect(tables).toEqual(['users']);
    });

    it('should handle complex queries with subqueries', () => {
      const tables = queryService.extractTableNames('SELECT * FROM users WHERE email IN (SELECT assignee_id FROM tasks)');
      expect(tables).toEqual(['users', 'tasks']);
    });
  });

  describe('getAllowedTables', () => {
    it('should return the list of allowed tables', () => {
      const tables = queryService.getAllowedTables();
      expect(tables).toEqual([
        'users',
        'tasks',
        'projects',
        'task_progress_updates',
        'task_comments',
        'project_progress_updates',
        'project_members',
        'project_comments',
        'events'
      ]);
    });
  });

  describe('hashQuery', () => {
    it('should generate consistent SHA-256 hashes', () => {
      const query = 'SELECT * FROM users';
      const hash1 = (queryService as any).hashQuery(query);
      const hash2 = (queryService as any).hashQuery(query);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate different hashes for different queries', () => {
      const hash1 = (queryService as any).hashQuery('SELECT * FROM users');
      const hash2 = (queryService as any).hashQuery('SELECT * FROM tasks');
      expect(hash1).not.toBe(hash2);
    });

    it('should trim whitespace before hashing', () => {
      const hash1 = (queryService as any).hashQuery('  SELECT * FROM users  ');
      const hash2 = (queryService as any).hashQuery('SELECT * FROM users');
      expect(hash1).toBe(hash2);
    });
  });

  // Integration tests would require mocking the database pool
  // These would test the full executeQuery flow
  describe('executeQuery integration tests', () => {
    it('should execute valid queries successfully', async () => {
      // TODO: Implement with mocked database pool
      // This would test the full flow including validation, execution, and formatting
    });

    it('should handle database errors gracefully', async () => {
      // TODO: Implement with mocked database pool
      // This would test error handling and audit logging
    });

    it('should enforce query timeouts', async () => {
      // TODO: Implement with mocked database pool
      // This would test timeout enforcement
    });

    it('should enforce row limits', async () => {
      // TODO: Implement with mocked database pool
      // This would test row limit enforcement
    });
  });
});