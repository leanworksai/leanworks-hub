import { Pool, PoolConfig } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { getDbInstanceName, getCredentialPath } from '../server/utils/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file if it exists
const envPath = join(__dirname, '../.env');
if (existsSync(envPath)) {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = value;
        }
      }
    }
  });
}

const serviceAccountPath = join(__dirname, '../', getCredentialPath());
let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
  console.log('✅ Loaded GCP credentials for database from:', serviceAccountPath);
} catch (error) {
  console.error('❌ Failed to load GCP credentials from:', serviceAccountPath);
  console.error('Error:', error);
  throw error;
}

const secretManagerClient = new SecretManagerServiceClient({
  keyFilename: serviceAccountPath,
});

const projectId = serviceAccount.project_id;
const instanceName = getDbInstanceName();
const region = process.env.DB_REGION || 'us-west1';

// Shared database name (for users, organizations, invitations)
const SHARED_DB_NAME = 'shared';

// Cache for connection pools
const orgPools = new Map<string, Pool>();
const poolCreationPromises = new Map<string, Promise<Pool>>(); // Track in-progress pool creations
let sharedPool: Pool | null = null;
let sharedPoolPromise: Promise<Pool> | null = null; // Track in-progress shared pool creation
let cachedPassword: string | null = null;

// Cache for org slug lookups (org_id -> slug)
const orgSlugCache = new Map<string, string>();

// Fetch PostgreSQL password from Secret Manager (cached)
async function getPostgresPassword(): Promise<string> {
  if (cachedPassword) {
    return cachedPassword;
  }

  try {
    // Import isLocalDev at the function level to avoid circular dependencies
    const { isLocalDev } = await import('../server/utils/env.js');
    
    // Use dev-prefixed secret for local development
    const secretPrefix = isLocalDev() ? 'dev-' : '';
    const secretName = `projects/${projectId}/secrets/${secretPrefix}postgresdb-password/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
    cachedPassword = (version.payload?.data?.toString() || '').trim();
    console.log('✅ PostgreSQL password fetched from Secret Manager');
    return cachedPassword;
  } catch (error) {
    console.error('❌ Failed to fetch password from Secret Manager:', error);
    return process.env.DB_PASSWORD || '';
  }
}

// Use org slug directly for database naming (with org_ prefix)
// Database names will be quoted in SQL queries to handle special characters
export function sanitizeSlugForDb(slug: string): string {
  // Use slug directly with org_ prefix, no sanitization
  // PostgreSQL allows special characters in quoted identifiers
  return 'org_' + slug;
}

// Generate a unique slug from org name (using underscores for separations)
// Appends a unique ID to ensure uniqueness, similar to personal workspace slugs
export function generateOrgSlug(name: string): string {
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, '') // Keep only alphanumeric, spaces, and underscores
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/-+/g, '_') // Replace hyphens with underscores
    .replace(/_+/g, '_') // Replace multiple underscores with single underscore
    .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
  
  // Generate unique ID (similar to personal workspace format)
  const uniqueId = Date.now().toString(36);
  
  // Truncate base slug to leave room for unique ID (max 40 chars for base, + 1 for underscore + ~9 for ID = ~50 total)
  const truncatedBase = baseSlug.substring(0, 40);
  
  return `${truncatedBase}_${uniqueId}`;
}

// Generate personal workspace slug from email
export function generatePersonalSlug(email: string): string {
  const username = email.split('@')[0];
  const sanitized = username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 30);
  return `personal_${sanitized}_${Date.now().toString(36)}`;
}

// Initialize schema for a database
async function initializeSchemaForDatabase(
  pool: Pool,
  dbName: string,
  schemaFile: string = 'schema.sql'
): Promise<void> {
  try {
    // Check if schema is already initialized by checking if teams table exists (for org DBs)
    // or users table (for shared DB)
    const checkTable = schemaFile === 'shared-schema.sql' ? 'users' : 'teams';
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      );
    `, [checkTable]);

    if (!tableCheck.rows[0].exists) {
      console.log(`📋 Initializing schema for database "${dbName}" using ${schemaFile}...`);
      const schemaPath = join(__dirname, schemaFile);
      const schema = readFileSync(schemaPath, 'utf8');
      await pool.query(schema);
      console.log(`✅ Schema initialized successfully for database "${dbName}"`);
      return;
    }

    console.log(`✅ Schema already initialized for database "${dbName}"`);
  } catch (error) {
    console.error(`❌ Failed to initialize schema for database "${dbName}":`, error);
    throw error;
  }
}

// Check if a database exists (without creating it)
export async function checkDatabaseExists(dbName: string): Promise<boolean> {
  const password = await getPostgresPassword();
  // For local development, use localhost (Cloud SQL Proxy)
  // For production, use Unix socket path
  const isLocalDev = process.env.NODE_ENV === 'development' || !process.env.DB_HOST;
  const dbHost = process.env.DB_HOST || (isLocalDev 
    ? 'localhost'  // Local development: use Cloud SQL Proxy on localhost
    : `/cloudsql/${projectId}:${region}:${instanceName}`);  // Production: use Unix socket
  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  
  const { Client } = await import('pg');

  // Try to connect to the target database
  const testClient = new Client({
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: dbName,
    user: 'postgres',
    password: password,
    ssl: false,
  });

  try {
    await testClient.connect();
    await testClient.end();
    return true; // Database exists
  } catch (error: any) {
    // If database doesn't exist (error code 3D000), return false
    if (error.code === '3D000') {
      return false; // Database does not exist
    }
    // For other errors, rethrow
    throw error;
  }
}

// Auto-create database if it doesn't exist
async function ensureDatabaseExists(
  password: string,
  dbName: string,
  dbHost: string,
  dbPort: number
): Promise<boolean> {
  const { Client } = await import('pg');

  // Try to connect to the target database
  const testClient = new Client({
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: dbName,
    user: 'postgres',
    password: password,
    ssl: false,
  });

  try {
    await testClient.connect();
    await testClient.end();
    console.log(`✅ Database "${dbName}" exists`);
    return false; // Database already existed
  } catch (error: any) {
    // If database doesn't exist (error code 3D000), create it
    if (error.code === '3D000') {
      console.log(`📝 Creating database "${dbName}"...`);

      const adminClient = new Client({
        host: dbHost,
        ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
        database: 'postgres',
        user: 'postgres',
        password: password,
        ssl: false,
      });

      try {
        await adminClient.connect();
        await adminClient.query(`CREATE DATABASE "${dbName}"`);
        await adminClient.end();
        console.log(`✅ Database "${dbName}" created successfully`);
        return true; // Database was just created
      } catch (createError) {
        console.error(`❌ Failed to create database "${dbName}":`, createError);
        throw createError;
      }
    } else {
      throw error;
    }
  }
}

// Create a connection pool for a specific database
async function createPool(dbName: string): Promise<Pool> {
  const password = await getPostgresPassword();
  // For local development, use localhost (Cloud SQL Proxy)
  // For production, use Unix socket path
  const isLocalDev = process.env.NODE_ENV === 'development' || !process.env.DB_HOST;
  const dbHost = process.env.DB_HOST || (isLocalDev 
    ? 'localhost'  // Local development: use Cloud SQL Proxy on localhost
    : `/cloudsql/${projectId}:${region}:${instanceName}`);  // Production: use Unix socket
  const dbPort = parseInt(process.env.DB_PORT || '5432');

  // Ensure database exists
  await ensureDatabaseExists(password, dbName, dbHost, dbPort);

  const poolConfig: PoolConfig = {
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: dbName,
    user: process.env.DB_USER || 'postgres',
    password: password,
    max: 10,
    idleTimeoutMillis: 300000, // 5 minutes (increased from 30 seconds)
    connectionTimeoutMillis: 20000, // 20 seconds (increased from 10 seconds)
    allowExitOnIdle: true, // Allow pool to exit when idle
    ssl: false,
  };

  const pool = new Pool(poolConfig);

  pool.on('error', (err) => {
    console.error(`❌ Error in pool for database ${dbName}:`, err);
  });

  return pool;
}

// ============================================================================
// CONNECTION HEALTH CHECKING
// ============================================================================

/**
 * Test if a connection is still alive
 */
async function testConnection(pool: Pool, dbName: string): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    console.warn(`⚠️  Connection test failed for database ${dbName}:`, error.message);
    return false;
  }
}

/**
 * Get a healthy connection from the pool, with retry logic
 */
async function getHealthyConnection(pool: Pool, dbName: string, maxRetries: number = 2): Promise<import('pg').PoolClient> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();

      // Test the connection with a simple query
      await client.query('SELECT 1');

      return client;
    } catch (error) {
      console.warn(`⚠️  Connection attempt ${attempt + 1} failed for database ${dbName}:`, error.message);

      if (attempt === maxRetries) {
        throw new Error(`Failed to get healthy connection after ${maxRetries + 1} attempts: ${error.message}`);
      }

      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  throw new Error('Unexpected error in connection retry logic');
}

// ============================================================================
// SHARED DATABASE POOL
// ============================================================================

/**
 * Get the shared database pool (for users, organizations, invitations)
 */
export async function getSharedPool(): Promise<Pool> {
  if (sharedPool) {
    return sharedPool;
  }

  // If pool creation is in progress, wait for it
  if (sharedPoolPromise) {
    return sharedPoolPromise;
  }

  // Start pool creation and track the promise
  sharedPoolPromise = (async () => {
    console.log(`🔌 Creating connection pool for shared database: ${SHARED_DB_NAME}`);
    const pool = await createPool(SHARED_DB_NAME);
    
    // Initialize shared schema
    await initializeSchemaForDatabase(pool, SHARED_DB_NAME, 'shared-schema.sql');
    
    sharedPool = pool;
    sharedPoolPromise = null; // Clear promise once done
    console.log(`✅ Shared database pool created`);
    return pool;
  })();

  return sharedPoolPromise;
}

// ============================================================================
// ORGANIZATION DATABASE POOL
// ============================================================================

/**
 * Get org slug from org ID (with caching)
 */
export async function getOrgSlugById(orgId: string): Promise<string> {
  // Check cache first
  if (orgSlugCache.has(orgId)) {
    return orgSlugCache.get(orgId)!;
  }

  // Query shared DB for org slug
  const shared = await getSharedPool();
  const result = await shared.query(
    'SELECT slug FROM organizations WHERE id = $1',
    [orgId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Organization not found: ${orgId}`);
  }

  const slug = result.rows[0].slug;
  orgSlugCache.set(orgId, slug);
  return slug;
}

/**
 * Get org database name from org ID
 */
export async function getOrgDatabaseName(orgId: string): Promise<string> {
  const slug = await getOrgSlugById(orgId);
  return sanitizeSlugForDb(slug);
}

/**
 * Get org ID from org slug (reverse lookup)
 */
export async function getOrgIdBySlug(orgSlug: string): Promise<string> {
  // Check reverse cache first (if we have one)
  // For now, we'll query the database
  const shared = await getSharedPool();
  const result = await shared.query(
    'SELECT id FROM organizations WHERE slug = $1',
    [orgSlug]
  );

  if (result.rows.length === 0) {
    throw new Error(`Organization not found: ${orgSlug}`);
  }

  const orgId = result.rows[0].id;
  // Cache the reverse mapping
  orgSlugCache.set(orgId, orgSlug);
  return orgId;
}

/**
 * Get or create connection pool for an organization's database
 * @param orgId - Organization UUID
 */
export async function getOrgPool(orgId: string): Promise<Pool> {
  // Get org slug for database naming
  const slug = await getOrgSlugById(orgId);
  const dbName = sanitizeSlugForDb(slug);

  // Return cached pool if exists
  if (orgPools.has(dbName)) {
    return orgPools.get(dbName)!;
  }

  // If pool creation is in progress, wait for it
  if (poolCreationPromises.has(dbName)) {
    return poolCreationPromises.get(dbName)!;
  }

  // Start pool creation and track the promise
  const creationPromise = (async () => {
    console.log(`🔌 Creating connection pool for org database: ${dbName} (org: ${orgId})`);
    
    const pool = await createPool(dbName);
    
    // Initialize org schema
    await initializeSchemaForDatabase(pool, dbName, 'schema.sql');
    
    // Cache the pool
    orgPools.set(dbName, pool);
    poolCreationPromises.delete(dbName); // Clear promise once done
    console.log(`✅ Connection pool created for org: ${orgId} (db: ${dbName})`);

    return pool;
  })();

  poolCreationPromises.set(dbName, creationPromise);
  return creationPromise;
}

/**
 * Get org pool by slug directly (used during org creation before ID is known)
 */
export async function getOrgPoolBySlug(slug: string): Promise<Pool> {
  const dbName = sanitizeSlugForDb(slug);

  // Return cached pool if exists
  if (orgPools.has(dbName)) {
    return orgPools.get(dbName)!;
  }

  // If pool creation is in progress, wait for it
  if (poolCreationPromises.has(dbName)) {
    return poolCreationPromises.get(dbName)!;
  }

  // Start pool creation and track the promise
  const creationPromise = (async () => {
    console.log(`🔌 Creating connection pool for org database: ${dbName}`);
    
    const pool = await createPool(dbName);
    
    // Initialize org schema
    await initializeSchemaForDatabase(pool, dbName, 'schema.sql');
    
    // Cache the pool
    orgPools.set(dbName, pool);
    poolCreationPromises.delete(dbName); // Clear promise once done
    console.log(`✅ Connection pool created for org database: ${dbName}`);

    return pool;
  })();

  poolCreationPromises.set(dbName, creationPromise);
  return creationPromise;
}

// ============================================================================
// QUERY HELPERS WITH RETRY LOGIC
// ============================================================================

/**
 * Execute a query with automatic retry on connection failures
 */
export async function queryWithRetry(
  pool: Pool,
  dbName: string,
  sql: string,
  params: any[] = [],
  maxRetries: number = 2
): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let client: import('pg').PoolClient | null = null;

    try {
      client = await getHealthyConnection(pool, dbName, 0); // Get connection, don't retry here
      const result = await client.query(sql, params);
      return result;
    } catch (error) {
      console.warn(`⚠️  Query attempt ${attempt + 1} failed for database ${dbName}:`, error.message);

      // If this is a connection-related error and we have retries left, continue
      if (attempt < maxRetries && (
        error.message.includes('Connection terminated') ||
        error.message.includes('connection was closed') ||
        error.message.includes('Client has encountered a connection error')
      )) {
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        continue;
      }

      // For non-connection errors or exhausted retries, throw
      throw error;
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  throw new Error('Unexpected error in query retry logic');
}

/**
 * Execute a query on the shared database with retry logic
 */
export async function queryShared<T = any>(
  text: string,
  params?: any[]
): Promise<T[]> {
  const pool = await getSharedPool();
  const result = await queryWithRetry(pool, SHARED_DB_NAME, text, params);
  return result.rows;
}

/**
 * Execute a query on an organization's database with retry logic
 */
export async function queryOrg<T = any>(
  orgId: string,
  text: string,
  params?: any[]
): Promise<T[]> {
  const pool = await getOrgPool(orgId);
  const dbName = await getOrgDatabaseName(orgId);
  const result = await queryWithRetry(pool, dbName, text, params);
  return result.rows;
}

// ============================================================================
// USER/ORG LOOKUP HELPERS
// ============================================================================

/**
 * Get user from shared database
 */
export async function getUser(email: string): Promise<any | null> {
  const result = await queryShared(
    'SELECT * FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  return result[0] || null;
}

/**
 * Get user's organizations with membership info
 */
export async function getUserOrganizations(email: string): Promise<any[]> {
  return queryShared(`
    SELECT 
      o.id,
      o.name,
      o.slug,
      o.type,
      o.owner_email,
      o.description,
      o.avatar,
      o.created_at,
      om.role,
      om.joined_at
    FROM organizations o
    INNER JOIN org_members om ON o.id = om.org_id
    WHERE om.user_email = $1
    ORDER BY o.type ASC, o.created_at ASC
  `, [email.toLowerCase()]);
}

/**
 * Get user's personal workspace
 */
export async function getPersonalWorkspace(email: string): Promise<any | null> {
  const result = await queryShared(`
    SELECT o.*, om.role, om.joined_at
    FROM organizations o
    INNER JOIN org_members om ON o.id = om.org_id
    WHERE om.user_email = $1 AND o.type = 'personal'
    LIMIT 1
  `, [email.toLowerCase()]);
  return result[0] || null;
}

/**
 * Check if user is member of an organization
 */
export async function checkOrgMembership(
  orgId: string,
  email: string
): Promise<{ isMember: boolean; role: string | null }> {
  const result = await queryShared(
    'SELECT role FROM org_members WHERE org_id = $1 AND user_email = $2',
    [orgId, email.toLowerCase()]
  );
  
  if (result.length === 0) {
    return { isMember: false, role: null };
  }
  
  return { isMember: true, role: result[0].role };
}

/**
 * Check if user is owner of an organization
 */
export async function isOrgOwner(orgId: string, email: string): Promise<boolean> {
  const result = await queryShared(
    'SELECT 1 FROM organizations WHERE id = $1 AND owner_email = $2',
    [orgId, email.toLowerCase()]
  );
  return result.length > 0;
}

/**
 * Get organization members
 */
export async function getOrgMembers(orgId: string): Promise<any[]> {
  console.log(`🔍 getOrgMembers called with orgId: ${orgId}`);
  
  const results = await queryShared(`
    SELECT
      om.user_email as email,
      om.role,
      om.joined_at,
      u.first_name,
      u.last_name,
      u.job_title,
      u.timezone
    FROM org_members om
    INNER JOIN users u ON om.user_email = u.email
    WHERE om.org_id = $1
    ORDER BY
      CASE om.role WHEN 'owner' THEN 0 ELSE 1 END,
      om.joined_at ASC
  `, [orgId]);
  
  console.log(`🔍 getOrgMembers returned ${results.length} results for orgId: ${orgId}`);
  return results;
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Clear org slug cache (useful when org is updated/deleted)
 */
export function clearOrgSlugCache(orgId?: string): void {
  if (orgId) {
    orgSlugCache.delete(orgId);
  } else {
    orgSlugCache.clear();
  }
}

/**
 * Close all connection pools (for graceful shutdown)
 */
/**
 * Close and remove connection pool for a specific org database
 */
export async function closeOrgPool(dbName: string): Promise<void> {
  if (orgPools.has(dbName)) {
    const pool = orgPools.get(dbName)!;
    console.log(`🔌 Closing connection pool for ${dbName}`);
    await pool.end();
    orgPools.delete(dbName);
    poolCreationPromises.delete(dbName);
    console.log(`✅ Connection pool closed for ${dbName}`);
  }
}

export async function closeAllPools(): Promise<void> {
  console.log('🔌 Closing all connection pools...');
  
  // Close org pools
  for (const [dbName, pool] of orgPools.entries()) {
    await pool.end();
    console.log(`  ✅ Closed pool for org database: ${dbName}`);
  }
  orgPools.clear();
  
  // Close shared pool
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
    console.log(`  ✅ Closed shared database pool`);
  }
  
  console.log('✅ All pools closed');
}

// Graceful shutdown
process.on('SIGTERM', closeAllPools);
process.on('SIGINT', closeAllPools);

// ============================================================================
// USER DATA HELPERS (for cross-database queries)
// ============================================================================

/**
 * Batch fetch user info from shared database
 * @param emails - Array of email addresses to look up
 * @returns Map of email -> {firstName, lastName, name, jobTitle}
 */
export async function getUserInfoBatch(emails: string[]): Promise<Map<string, {
  firstName: string;
  lastName: string;
  name: string;
  jobTitle?: string;
}>> {
  if (!emails || emails.length === 0) {
    return new Map();
  }

  const uniqueEmails = [...new Set(emails.filter(e => e))];
  if (uniqueEmails.length === 0) {
    return new Map();
  }

  try {
    const pool = await getSharedPool();
    const result = await pool.query(
      `SELECT email, first_name, last_name, job_title 
       FROM users 
       WHERE email = ANY($1)`,
      [uniqueEmails]
    );

    const userMap = new Map<string, { firstName: string; lastName: string; name: string; jobTitle?: string }>();
    for (const row of result.rows) {
      userMap.set(row.email, {
        firstName: row.first_name || '',
        lastName: row.last_name || '',
        name: row.first_name && row.last_name 
          ? `${row.first_name} ${row.last_name}` 
          : row.first_name || row.last_name || row.email,
        jobTitle: row.job_title,
      });
    }
    return userMap;
  } catch (error) {
    console.error('Failed to batch fetch user info:', error);
    return new Map();
  }
}

/**
 * Enrich an array of objects with user names from shared database
 * @param items - Array of objects containing user email references
 * @param emailFields - Array of field names that contain emails to look up
 * @param nameFields - Corresponding field names to set with user names
 */
export async function enrichWithUserNames<T extends Record<string, any>>(
  items: T[],
  emailFields: string[],
  nameFields: string[]
): Promise<T[]> {
  if (!items || items.length === 0) return items;

  // Collect all unique emails
  const allEmails: string[] = [];
  for (const item of items) {
    for (const field of emailFields) {
      if (item[field]) {
        allEmails.push(item[field]);
      }
    }
  }

  // Batch fetch user info
  const userInfo = await getUserInfoBatch(allEmails);

  // Enrich items
  return items.map(item => {
    const enriched = { ...item };
    for (let i = 0; i < emailFields.length; i++) {
      const email = item[emailFields[i]];
      if (email && userInfo.has(email)) {
        const user = userInfo.get(email)!;
        enriched[nameFields[i]] = user.name;
      }
    }
    return enriched;
  });
}

// ============================================================================
// DEPRECATED - For backward compatibility during migration
// ============================================================================
