/**
 * Manually trigger document processing
 */

import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { publishDocumentProcessingJob } from '../server/services/document-pubsub.js';

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
const dbHost = process.env.DB_HOST || (isLocalDev ? 'localhost' : `/cloudsql/${projectId}:us-west1:leanworks-prod`);
const dbPort = parseInt(process.env.DB_PORT || '5432');

// Get doc ID from command line arguments
const docId = process.argv[2] || 'fee0f57a-72c4-4eb8-960e-3664995ebedd';
const orgSlug = process.argv[3] || 'leanworksai_mj6bu7m8';

const dbName = `org_${orgSlug}`;

async function triggerDocumentProcessing(password: string) {
  console.log(`🔄 Triggering document processing for ${docId} in org ${orgSlug}`);

  const pool = new Pool({
    host: dbHost,
    ...(dbHost.startsWith('/') ? {} : { port: dbPort }),
    database: dbName,
    user: 'postgres',
    password: password,
    ssl: false,
  });

  try {
    // Get document details
    const docResult = await pool.query(`
      SELECT id, title, doc_type, storage_path, mime_type
      FROM docs
      WHERE id = $1
    `, [docId]);

    if (docResult.rows.length === 0) {
      console.log('❌ Document not found');
      return;
    }

    const doc = docResult.rows[0];
    console.log(`📄 Found document: ${doc.title} (${doc.doc_type})`);

    // Create processing job
    const jobResult = await pool.query(`
      INSERT INTO doc_processing_jobs (
        doc_id, job_type, status, priority, created_at, updated_at
      ) VALUES (
        $1, 'process_document', 'pending', 0, NOW(), NOW()
      )
      RETURNING id
    `, [docId]);

    const jobId = jobResult.rows[0].id;
    console.log(`✅ Created processing job: ${jobId}`);

    // Publish to Pub/Sub (this would normally be done by the upload endpoint)
    // For now, let's just mark the job as processing and simulate the processing

    console.log('🚀 Processing document...');

    // Import and run the processor directly
    const { documentProcessorFactory } = await import('../server/services/processors/index.js');

    // Get file from GCS
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getStorage } = await import('firebase-admin/storage');

    if (getApps().length === 0) {
      initializeApp({
        credential: cert(serviceAccount),
        projectId: projectId,
        storageBucket: 'leanworks-prod',
      });
    }

    const storage = getStorage();
    const bucket = storage.bucket();
    const file = bucket.file(doc.storage_path);

    console.log(`📁 Downloading file from: ${doc.storage_path}`);
    const [fileBuffer] = await file.download();
    console.log(`✅ Downloaded ${fileBuffer.length} bytes`);

    // Process the document
    const processor = documentProcessorFactory.getProcessor(doc.doc_type as any);
    const metadata = {
      fileName: doc.title,
      fileSize: fileBuffer.length,
      mimeType: doc.mime_type,
      docType: doc.doc_type as any,
      uploadedAt: new Date(),
    };

    console.log(`🔄 Processing with ${processor.constructor.name}...`);
    const processedDoc = await processor.process(fileBuffer, metadata);

    console.log(`✅ Processing complete. Content length: ${processedDoc.content.length}`);

    // Update document in database
    await pool.query(
      `UPDATE docs
       SET
         content = $1,
         file_metadata = $2,
         processing_status = 'ready',
         updated_at = NOW()
       WHERE id = $3`,
      [
        processedDoc.content,
        JSON.stringify({
          ...processedDoc.metadata,
          thumbnails: processedDoc.thumbnails,
          htmlContent: processedDoc.htmlContent,
          previewData: processedDoc.previewData,
        }),
        docId,
      ]
    );

    // Mark job as completed
    await pool.query(
      `UPDATE doc_processing_jobs
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [jobId]
    );

    console.log('✅ Document processing completed successfully!');

  } catch (error: any) {
    console.error('❌ Processing error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

async function main() {
  console.log('🚀 Triggering document processing...\n');

  try {
    const password = await getPostgresPassword();
    if (!password) {
      throw new Error('Failed to get database password');
    }

    await triggerDocumentProcessing(password);
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();