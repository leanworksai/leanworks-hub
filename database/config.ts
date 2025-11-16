import { Pool, PoolConfig } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file if it exists (for local development)
const envPath = join(__dirname, '../.env');
if (existsSync(envPath)) {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        // Only set if not already set
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = value;
        }
      }
    }
  });
  console.log('✅ Loaded .env file for local development');
}

// Read GCP credentials to get project ID
const serviceAccountPath = join(__dirname, '../gcp_credential.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

// Initialize Secret Manager client
const secretManagerClient = new SecretManagerServiceClient({
  keyFilename: serviceAccountPath,
});

// PostgreSQL connection configuration for Cloud SQL
const projectId = serviceAccount.project_id; // leanworks-474204
const instanceName = 'leanworks-prod';
const region = process.env.DB_REGION || 'us-west1';

// Fetch PostgreSQL password from Secret Manager
async function getPostgresPassword(): Promise<string> {
  try {
    const secretName = `projects/${projectId}/secrets/postgresdb-password/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
    const password = version.payload?.data?.toString() || '';
    console.log('✅ PostgreSQL password fetched from Secret Manager');
    return password;
  } catch (error) {
    console.error('❌ Failed to fetch password from Secret Manager:', error);
    // Fallback to environment variable
    return process.env.DB_PASSWORD || '';
  }
}

// Pool configuration (will be initialized after fetching password)
let pool: Pool;

// Auto-create database if it doesn't exist
async function ensureDatabaseExists(password: string, targetDb: string, dbHost: string, dbPort: number): Promise<void> {
  const { Client } = await import('pg');
  
  // Try to connect to the target database
  const testClient = new Client({
    host: dbHost,
    port: dbPort,
    database: targetDb,
    user: 'postgres',
    password: password,
    ssl: false,
  });
  
  try {
    await testClient.connect();
    await testClient.end();
    console.log(`✅ Database "${targetDb}" exists`);
    return;
  } catch (error: any) {
    // If database doesn't exist (error code 3D000), create it
    if (error.code === '3D000') {
      console.log(`📝 Database "${targetDb}" does not exist, creating...`);
      
      // Connect to default postgres database to create new database
      const adminClient = new Client({
        host: dbHost,
        port: dbPort,
        database: 'postgres',
        user: 'postgres',
        password: password,
        ssl: false,
      });
      
      try {
        await adminClient.connect();
        await adminClient.query(`CREATE DATABASE "${targetDb}"`);
        await adminClient.end();
        console.log(`✅ Database "${targetDb}" created successfully`);
      } catch (createError) {
        console.error(`❌ Failed to create database "${targetDb}":`, createError);
        throw createError;
      }
    } else {
      // Other connection errors
      throw error;
    }
  }
}

// Initialize the connection pool with Secret Manager password
async function initializePool(): Promise<Pool> {
  if (pool) {
    return pool;
  }

  const password = await getPostgresPassword();
  const dbHost = process.env.DB_HOST || `/cloudsql/${projectId}:${region}:${instanceName}`;
  const dbPort = parseInt(process.env.DB_PORT || '5432');
  const targetDb = process.env.DB_NAME || 'leanworks-prod';

  // Ensure database exists before creating pool
  await ensureDatabaseExists(password, targetDb, dbHost, dbPort);

  const poolConfig: PoolConfig = {
    // For Cloud SQL with Unix socket (recommended for GCP deployments)
    // Format: /cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
    host: dbHost,
    
    // For local development with Cloud SQL Proxy, use:
    // host: process.env.DB_HOST || '127.0.0.1',
    
    port: dbPort,
    
    database: targetDb,
    user: process.env.DB_USER || 'postgres',
    password: password,
    
    // Connection pool settings
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection could not be established
    
    // SSL settings (not needed for Unix socket connections)
    ssl: false,
  };

  pool = new Pool(poolConfig);
  
  return pool;
}

// Export a promise that resolves to the pool
export const poolPromise = initializePool();

// Export pool getter
export async function getPool(): Promise<Pool> {
  return await poolPromise;
}

// Setup event listeners after pool initialization
poolPromise.then((p) => {
  p.on('connect', () => {
    console.log('✅ PostgreSQL client connected');
  });

  p.on('error', (err) => {
    console.error('❌ Unexpected PostgreSQL client error:', err);
    process.exit(-1);
  });
});

// Helper function to test database connection
export async function testConnection(): Promise<boolean> {
  try {
    const p = await getPool();
    const client = await p.connect();
    const result = await client.query('SELECT NOW()');
    console.log('🗄️  PostgreSQL connection test successful:', result.rows[0].now);
    client.release();
    return true;
  } catch (error) {
    console.error('❌ PostgreSQL connection test failed:', error);
    return false;
  }
}

// Helper function to execute the schema file
export async function initializeSchema(): Promise<void> {
  try {
    const p = await getPool();
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    
    console.log('📋 Executing PostgreSQL schema...');
    await p.query(schema);
    console.log('✅ PostgreSQL schema initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize PostgreSQL schema:', error);
    throw error;
  }
}

// Helper function to get a client from the pool
export async function getClient() {
  const p = await getPool();
  return await p.connect();
}

// Graceful shutdown
export async function closePool(): Promise<void> {
  const p = await getPool();
  await p.end();
  console.log('🔌 PostgreSQL connection pool closed');
}

// Close pool on process termination
process.on('SIGTERM', closePool);
process.on('SIGINT', closePool);

// Export default (async getter)
export default getPool;

