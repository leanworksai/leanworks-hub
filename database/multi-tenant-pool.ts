import { Pool, PoolConfig } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

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

const serviceAccountPath = join(__dirname, '../gcp_credential.json');
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
const instanceName = 'leanworks-prod';
const region = process.env.DB_REGION || 'us-west1';

// Shared database name (for users, organizations, invitations)
const SHARED_DB_NAME = 'shared';

// Cache for connection pools
const orgPools = new Map<string, Pool>();
let sharedPool: Pool | null = null;
let cachedPassword: string | null = null;

// Cache for org slug lookups (org_id -> slug)
const orgSlugCache = new Map<string, string>();

// Fetch PostgreSQL password from Secret Manager (cached)
async function getPostgresPassword(): Promise<string> {
  if (cachedPassword) {
    return cachedPassword;
  }

  try {
    const secretName = `projects/${projectId}/secrets/postgresdb-password/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
    cachedPassword = (version.payload?.data?.toString() || '').trim();
    console.log('✅ PostgreSQL password fetched from Secret Manager');
    return cachedPassword;
  } catch (error) {
    console.error('❌ Failed to fetch password from Secret Manager:', error);
    return process.env.DB_PASSWORD || '';
  }
}

// Sanitize org slug for database naming
export function sanitizeSlugForDb(slug: string): string {
  // Remove all special characters, keep only alphanumeric
  const sanitized = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Ensure database name doesn't start with a number (PostgreSQL requirement)
  if (sanitized && /^\d/.test(sanitized)) {
    return 'org_' + sanitized;
  }
  
  return 'org_' + sanitized;
}

// Generate a unique slug from org name
export function generateOrgSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
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
  const dbHost = process.env.DB_HOST || `/cloudsql/${projectId}:${region}:${instanceName}`;
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
  const dbHost = process.env.DB_HOST || `/cloudsql/${projectId}:${region}:${instanceName}`;
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
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: false,
  };

  const pool = new Pool(poolConfig);

  pool.on('error', (err) => {
    console.error(`❌ Error in pool for database ${dbName}:`, err);
  });

  return pool;
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

  console.log(`🔌 Creating connection pool for shared database: ${SHARED_DB_NAME}`);
  sharedPool = await createPool(SHARED_DB_NAME);
  
  // Initialize shared schema
  await initializeSchemaForDatabase(sharedPool, SHARED_DB_NAME, 'shared-schema.sql');
  
  console.log(`✅ Shared database pool created`);
  return sharedPool;
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

  console.log(`🔌 Creating connection pool for org database: ${dbName} (org: ${orgId})`);
  
  const pool = await createPool(dbName);
  
  // Initialize org schema
  await initializeSchemaForDatabase(pool, dbName, 'schema.sql');
  
  // Cache the pool
  orgPools.set(dbName, pool);
  console.log(`✅ Connection pool created for org: ${orgId} (db: ${dbName})`);

  return pool;
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

  console.log(`🔌 Creating connection pool for org database: ${dbName}`);
  
  const pool = await createPool(dbName);
  
  // Initialize org schema
  await initializeSchemaForDatabase(pool, dbName, 'schema.sql');
  
  // Cache the pool
  orgPools.set(dbName, pool);
  console.log(`✅ Connection pool created for org database: ${dbName}`);

  return pool;
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Execute a query on the shared database
 */
export async function queryShared<T = any>(
  text: string,
  params?: any[]
): Promise<T[]> {
  const pool = await getSharedPool();
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/**
 * Execute a query on an organization's database
 */
export async function queryOrg<T = any>(
  orgId: string,
  text: string,
  params?: any[]
): Promise<T[]> {
  const pool = await getOrgPool(orgId);
  const result = await pool.query<T>(text, params);
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
  return queryShared(`
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

/**
 * @deprecated Use getOrgPool(orgId) instead
 * Extract domain from email - kept for migration purposes only
 */
export function getDomainFromEmail(email: string): string {
  console.warn('⚠️ getDomainFromEmail is deprecated. Use getOrgPool(orgId) instead.');
  const domain = email.split('@')[1];
  if (!domain) {
    throw new Error(`Invalid email format: ${email}`);
  }
  const sanitized = domain.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (sanitized && /^\d/.test(sanitized)) {
    return 'db_' + sanitized;
  }
  return sanitized;
}

/**
 * @deprecated Use getOrgPool(orgId) instead
 * Get tenant pool by email domain - kept for migration purposes only
 */
export async function getTenantPool(userEmail: string): Promise<Pool> {
  console.warn('⚠️ getTenantPool is deprecated. Use getOrgPool(orgId) instead.');
  const domain = getDomainFromEmail(userEmail);
  
  if (orgPools.has(domain)) {
    return orgPools.get(domain)!;
  }

  console.log(`🔌 [DEPRECATED] Creating pool for domain: ${domain}`);
  const pool = await createPool(domain);
  await initializeSchemaForDatabase(pool, domain, 'schema.sql');
  orgPools.set(domain, pool);
  
  return pool;
}

/**
 * @deprecated Use getSharedPool() or getOrgPoolBySlug() instead
 */
export async function getTenantPoolByDbName(dbName: string): Promise<Pool> {
  console.warn('⚠️ getTenantPoolByDbName is deprecated.');
  
  if (dbName === SHARED_DB_NAME || dbName === 'shared') {
    return getSharedPool();
  }
  
  if (orgPools.has(dbName)) {
    return orgPools.get(dbName)!;
  }

  const pool = await createPool(dbName);
  await initializeSchemaForDatabase(pool, dbName, 'schema.sql');
  orgPools.set(dbName, pool);
  
  return pool;
}
