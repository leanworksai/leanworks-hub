/**
 * Check the status of a specific document
 */

import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

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
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = value;
        }
      }
    }
  });
}

// Read GCP credentials
const serviceAccountPath = join(__dirname, '../gcp_credential.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
const projectId = serviceAccount.project_id;

// Initialize Secret Manager client
const secretManagerClient = new SecretManagerServiceClient({
  keyFilename: serviceAccountPath,
});

// Fetch PostgreSQL password from Secret Manager
async function getPostgresPassword(): Promise<string> {
  try {
    const secretName = `projects/${projectId}/secrets/postgresdb-password/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
    const password = (version.payload?.data?.toString() || '').trim();
    console.log('✅ PostgreSQL password fetched from Secret Manager');
    return password;
  } catch (error) {
    console.error('❌ Failed to fetch password from Secret Manager:', error);
    // Fallback to environment variable
    return process.env.DB_PASSWORD || '';
  }
}

// Database configuration
const isLocalDev = process.env.NODE_ENV === 'development' || !process.env.DB_HOST;
const dbHost = process.env.DB_HOST || (isLocalDev ? 'localhost' : `/cloudsql/${projectId}:us-west1:${process.env.DB_INSTANCE_NAME || 'leanworks-prod'}`);
const dbPort = parseInt(process.env.DB_PORT || '5432');

// Get doc ID from command line arguments
const docId = process.argv[2] || 'fee0f57a-72c4-4eb8-960e-3664995ebedd';
const orgSlug = process.argv[3] || 'leanworksai_mj6bu7m8';

const dbName = `org_${orgSlug}`;

async function checkDocumentStatus(password: string) {
  console.log(`🔍 Checking document: ${docId} in org ${orgSlug} (${dbName})`);

  const pool = new Pool({
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: dbName,
    user: 'postgres',
    password: password,
    ssl: false,
  });

  try {
    // Check if document exists and its status
    const docResult = await pool.query(`
      SELECT id, title, doc_type, processing_status, file_size, mime_type,
             content, file_metadata, storage_path,
             created_at, updated_at
      FROM docs
      WHERE id = $1
    `, [docId]);

    if (docResult.rows.length === 0) {
      console.log('❌ Document not found');
      return;
    }

    const doc = docResult.rows[0];
    console.log('\n📄 Document Details:');
    console.log('='.repeat(50));
    console.log(`ID: ${doc.id}`);
    console.log(`Title: ${doc.title}`);
    console.log(`Doc Type: ${doc.doc_type}`);
    console.log(`Processing Status: ${doc.processing_status}`);
    console.log(`File Size: ${doc.file_size}`);
    console.log(`MIME Type: ${doc.mime_type}`);
    console.log(`Storage Path: ${doc.storage_path}`);
    console.log(`Created: ${doc.created_at}`);
    console.log(`Updated: ${doc.updated_at}`);

    console.log('\n📊 Content Analysis:');
    if (doc.content) {
      console.log(`Content Length: ${doc.content.length} characters`);
      console.log(`Content Preview: ${doc.content.substring(0, 200)}...`);

      try {
        const parsed = JSON.parse(doc.content);
        console.log('✅ Content is valid JSON');
        if (parsed.slides) {
          console.log(`   Slides: ${parsed.slides.length}`);
        }
      } catch (e) {
        console.log('❌ Content is not valid JSON');
      }
    } else {
      console.log('❌ No content in database');
    }

    console.log('\n📋 File Metadata:');
    if (doc.file_metadata) {
      console.log(JSON.stringify(doc.file_metadata, null, 2));
    } else {
      console.log('No file metadata');
    }

  } catch (error: any) {
    console.error('❌ Database error:', error.message);
  } finally {
    await pool.end();
  }
}

async function main() {
  console.log('🚀 Checking document status...\n');

  try {
    const password = await getPostgresPassword();
    if (!password) {
      throw new Error('Failed to get database password');
    }

    await checkDocumentStatus(password);
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();