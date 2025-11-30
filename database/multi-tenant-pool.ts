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

// Cache for connection pools per tenant
const tenantPools = new Map<string, Pool>();
let cachedPassword: string | null = null;

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

// Extract domain from email (part after @)
export function getDomainFromEmail(email: string): string {
  const domain = email.split('@')[1];
  if (!domain) {
    throw new Error(`Invalid email format: ${email}`);
  }
  // Sanitize domain name for database naming
  // Remove all special characters (dots, hyphens, etc.)
  const sanitized = domain.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Ensure database name doesn't start with a number (PostgreSQL requirement)
  if (sanitized && /^\d/.test(sanitized)) {
    return 'db_' + sanitized;
  }
  
  return sanitized;
}

// Auto-create database if it doesn't exist
async function ensureDatabaseExists(
  password: string,
  dbName: string,
  dbHost: string,
  dbPort: number
): Promise<void> {
  const { Client } = await import('pg');

  // Try to connect to the target database
  const testClient = new Client({
    host: dbHost,
    // Don't specify port for Unix socket connections
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
    return;
  } catch (error: any) {
    // If database doesn't exist (error code 3D000), create it
    if (error.code === '3D000') {
      console.log(`📝 Creating database "${dbName}" for new tenant...`);

      // Connect to default postgres database to create new database
      const adminClient = new Client({
        host: dbHost,
        // Don't specify port for Unix socket connections
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
        
        // Run schema on the newly created database
        try {
          console.log(`📋 Running schema on database "${dbName}"...`);
          const schemaClient = new Client({
            host: dbHost,
            port: dbPort,
            database: dbName,
            user: 'postgres',
            password: password,
            ssl: false,
          });
          
          await schemaClient.connect();
          const { readFileSync } = await import('fs');
          const { join, dirname } = await import('path');
          const { fileURLToPath } = await import('url');
          const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');
          const schema = readFileSync(schemaPath, 'utf8');
          await schemaClient.query(schema);
          await schemaClient.end();
          console.log(`✅ Schema initialized for database "${dbName}"`);
        } catch (schemaError) {
          console.error(`⚠️  Failed to run schema on "${dbName}":`, schemaError);
          // Don't throw - database exists, schema can be run manually if needed
        }
      } catch (createError) {
        console.error(`❌ Failed to create database "${dbName}":`, createError);
        throw createError;
      }
    } else {
      // Other connection errors
      throw error;
    }
  }
}

// Get or create connection pool for a specific tenant
export async function getTenantPool(userEmail: string): Promise<Pool> {
  const domain = getDomainFromEmail(userEmail);
  const dbName = domain; // Database name is the domain

  // Return cached pool if exists
  if (tenantPools.has(dbName)) {
    return tenantPools.get(dbName)!;
  }

  console.log(`🔌 Creating connection pool for tenant: ${dbName} (from ${userEmail})`);

  const password = await getPostgresPassword();
  const dbHost = process.env.DB_HOST || `/cloudsql/${projectId}:${region}:${instanceName}`;
  const dbPort = parseInt(process.env.DB_PORT || '5432');

  // Ensure database exists
  await ensureDatabaseExists(password, dbName, dbHost, dbPort);

  // Create new pool for this tenant
  const poolConfig: PoolConfig = {
    host: dbHost,
    // Don't specify port for Unix socket connections
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: dbName,
    user: process.env.DB_USER || 'postgres',
    password: password,
    max: 10, // Smaller pool per tenant
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: false,
  };

  const pool = new Pool(poolConfig);

  pool.on('error', (err) => {
    console.error(`❌ Error in pool for tenant ${dbName}:`, err);
  });

  // Cache the pool
  tenantPools.set(dbName, pool);
  console.log(`✅ Connection pool created for tenant: ${dbName}`);

  return pool;
}

// Get a client from the tenant's pool
export async function getTenantClient(userEmail: string) {
  const pool = await getTenantPool(userEmail);
  return await pool.connect();
}

// Execute a query for a specific tenant
export async function queryTenant<T = any>(
  userEmail: string,
  text: string,
  params?: any[]
): Promise<T[]> {
  const pool = await getTenantPool(userEmail);
  const result = await pool.query<T>(text, params);
  return result.rows;
}

// Close all tenant pools (for graceful shutdown)
export async function closeAllPools(): Promise<void> {
  console.log('🔌 Closing all tenant connection pools...');
  for (const [tenant, pool] of tenantPools.entries()) {
    await pool.end();
    console.log(`  ✅ Closed pool for tenant: ${tenant}`);
  }
  tenantPools.clear();
  console.log('✅ All pools closed');
}

// Graceful shutdown
process.on('SIGTERM', closeAllPools);
process.on('SIGINT', closeAllPools);

