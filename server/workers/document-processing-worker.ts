/**
 * Document Processing Worker
 * 
 * Subscribes to document-processing Pub/Sub topic and processes documents
 * using the appropriate processor based on document type.
 */

import { Message } from '@google-cloud/pubsub';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getOrgPoolBySlug } from '../../database/multi-tenant-pool';
import { getStorageBucket, getCredentialPath, isDevEnvironment } from '../utils/env.js';
import {
  getDocumentProcessingPubSubClient,
  getDocumentProcessingSubscriptionName,
  getDocProcessingTopic,
  DocumentProcessingJob,
  publishDocumentProcessingStatus,
} from '../services/document-pubsub.js';
import { documentProcessorFactory } from '../services/processors/index.js';
import { DocumentType, FileMetadata } from '../services/document-processor.js';
import {
  ProcessingFailedError,
  MaxRetriesExceededError,
  isDocumentProcessingError,
} from '../utils/document-errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Initialize Firebase Admin SDK
 */
function initializeFirebaseAdmin(): void {
  if (getApps().length === 0) {
    const serviceAccountPath = join(__dirname, '../../', getCredentialPath());
    if (existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
      const storageBucket = serviceAccount.storage_bucket || getStorageBucket();
      try {
        initializeApp({
          credential: cert(serviceAccount),
          projectId: serviceAccount.project_id,
          storageBucket: storageBucket,
        });
        console.log('✅ Firebase Admin SDK initialized for document processing worker');
      } catch (error) {
        // If Firebase is already initialized, just use the existing instance
        console.log('ℹ️  Using existing Firebase Admin SDK instance');
      }
    } else {
      throw new Error('GCP credentials not found at: ' + serviceAccountPath);
    }
  } else {
    console.log('ℹ️  Firebase Admin SDK already initialized, using existing instance');
  }
}

// Configuration
const MAX_RETRIES = parseInt(process.env.DOC_PROCESSING_MAX_RETRIES || '3');
const ACK_DEADLINE = parseInt(process.env.DOC_PROCESSING_ACK_DEADLINE || '600'); // 10 minutes
const CONCURRENCY = parseInt(process.env.DOC_PROCESSING_CONCURRENCY || '5');

// Worker state
let isRunning = false;
let activeJobs = 0;

/**
 * Process a single document
 */
async function processDocument(job: DocumentProcessingJob): Promise<void> {
  const { docId, docType, storagePath, fileName, fileSize, mimeType, orgSlug } = job;
  
  console.log(`🔄 Processing document: ${docId} (${docType}) - ${fileName}`);

  try {
    // Update status to processing
    await publishDocumentProcessingStatus({
      jobId: job.jobId,
      docId,
      status: 'processing',
      progress: 10,
    });

    // Download file from GCS
    const bucket = getStorage().bucket();
    const file = bucket.file(storagePath);
    
    const [fileBuffer] = await file.download();
    console.log(`📥 Downloaded file from GCS: ${storagePath} (${fileBuffer.length} bytes)`);

    // Update progress
    await publishDocumentProcessingStatus({
      jobId: job.jobId,
      docId,
      status: 'processing',
      progress: 30,
    });

    // Get appropriate processor
    const processor = documentProcessorFactory.getProcessor(docType as DocumentType);

    // Create file metadata
    const metadata: FileMetadata = {
      fileName,
      fileSize,
      mimeType,
      docType: docType as DocumentType,
      uploadedAt: new Date(),
      userId: job.userId,
      orgSlug,
    };

    // Process the document
    const processedDoc = await processor.process(fileBuffer, metadata);
    console.log(`✅ Document processed: ${docId} - extracted ${processedDoc.content.length} characters`);

    // Update progress
    await publishDocumentProcessingStatus({
      jobId: job.jobId,
      docId,
      status: 'processing',
      progress: 70,
    });

    // Handle PDF buffer for PPT files (upload to GCS)
    let pdfStoragePath: string | undefined;
    if (processedDoc.pdfBuffer && docType === 'pptx') {
      console.log(`📤 Uploading PDF for PPT file: ${fileName}`);

      // Generate PDF storage path
      pdfStoragePath = `orgs/${orgSlug}/doc-files/${docId}/${docId}.pdf`;

      // Upload PDF to GCS
      const bucket = getStorage().bucket();
      const pdfFile = bucket.file(pdfStoragePath);

      await pdfFile.save(processedDoc.pdfBuffer, {
        metadata: {
          contentType: 'application/pdf',
          metadata: {
            originalName: `${fileName.replace(/\.(pptx?|ppt)$/i, '')}.pdf`,
            uploadedBy: job.userId,
            docId,
            docType: 'pdf',
            convertedFrom: docType,
          },
        },
      });

      console.log(`✅ PDF uploaded to GCS: ${pdfStoragePath}`);
    } else if (docType === 'pptx') {
      console.log(`ℹ️  PPT file processed without PDF conversion: ${fileName}`);
    }

    // Update database with processed content
    const pool = await getOrgPoolBySlug(orgSlug);

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
          ...(docType === 'pptx' ? {
            pdfStoragePath,
            conversionSuccessful: !!pdfStoragePath,
          } : {}),
        }),
        docId,
      ]
    );

    console.log(`💾 Updated database for document: ${docId}`);

    // Update job status to completed
    await pool.query(
      `UPDATE doc_processing_jobs 
       SET 
         status = 'completed',
         completed_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      [job.jobId]
    );

    // Publish final status
    await publishDocumentProcessingStatus({
      jobId: job.jobId,
      docId,
      status: 'ready',
      progress: 100,
      completedAt: Date.now(),
    });

    console.log(`✅ Document processing completed: ${docId}`);
  } catch (error: any) {
    console.error(`❌ Error processing document ${docId}:`, error);

    // Determine if we should retry
    const retryCount = job.retryCount || 0;
    const shouldRetry = retryCount < MAX_RETRIES;

    // Get error details
    const errorMessage = isDocumentProcessingError(error)
      ? error.message
      : error.message || 'Unknown error';
    const errorCode = isDocumentProcessingError(error)
      ? error.code
      : 'PROCESSING_ERROR';

    // Update database
    const pool = await getOrgPoolBySlug(orgSlug);
    
    if (shouldRetry) {
      // Update job for retry
      await pool.query(
        `UPDATE doc_processing_jobs 
         SET 
           status = 'pending',
           retry_count = retry_count + 1,
           error_message = $1,
           updated_at = NOW()
         WHERE id = $2`,
        [errorMessage, job.jobId]
      );

      // Update doc status
      await pool.query(
        `UPDATE docs 
         SET 
           processing_status = 'error',
           updated_at = NOW()
         WHERE id = $1`,
        [docId]
      );

      console.log(`🔄 Will retry document processing: ${docId} (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      
      // Throw error to trigger Pub/Sub retry
      throw error;
    } else {
      // Max retries exceeded, mark as failed
      await pool.query(
        `UPDATE doc_processing_jobs 
         SET 
           status = 'failed',
           error_message = $1,
           completed_at = NOW(),
           updated_at = NOW()
         WHERE id = $2`,
        [errorMessage, job.jobId]
      );

      await pool.query(
        `UPDATE docs 
         SET 
           processing_status = 'error',
           updated_at = NOW()
         WHERE id = $1`,
        [docId]
      );

      // Publish error status
      await publishDocumentProcessingStatus({
        jobId: job.jobId,
        docId,
        status: 'error',
        errorMessage,
        errorCode,
        completedAt: Date.now(),
      });

      console.error(`❌ Document processing failed after ${MAX_RETRIES} retries: ${docId}`);
      
      // Don't throw - we've handled the error, ack the message
    }
  }
}

/**
 * Handle incoming Pub/Sub message
 */
async function handleMessage(message: Message): Promise<void> {
  activeJobs++;
  
  try {
    const data = message.data ? JSON.parse(message.data.toString()) : {};
    
    // Check message type
    if (data.type !== 'process_document') {
      console.log(`⏭️  Skipping non-processing message: ${data.type}`);
      message.ack();
      return;
    }

    // Extract job data
    const job: DocumentProcessingJob = {
      jobId: data.jobId,
      docId: data.docId,
      docType: data.docType,
      storagePath: data.storagePath,
      fileName: data.fileName,
      fileSize: data.fileSize,
      mimeType: data.mimeType,
      orgSlug: data.orgSlug,
      userId: data.userId,
      projectId: data.projectId,
      teamId: data.teamId,
      retryCount: data.retryCount || 0,
      correlationId: data.correlationId,
    };

    // Process the document
    await processDocument(job);

    // Acknowledge the message
    message.ack();
  } catch (error: any) {
    console.error(`❌ Error handling message:`, error);
    
    // Nack the message to trigger retry (Pub/Sub will redeliver)
    message.nack();
  } finally {
    activeJobs--;
  }
}

/**
 * Start the document processing worker
 */
export async function startDocumentProcessingWorker(): Promise<void> {
  if (isRunning) {
    console.log('⚠️  Document processing worker is already running');
    return;
  }

  // Initialize Firebase Admin SDK
  initializeFirebaseAdmin();

  console.log('🚀 Starting document processing worker...');
  console.log(`   Max retries: ${MAX_RETRIES}`);
  console.log(`   Ack deadline: ${ACK_DEADLINE}s`);
  console.log(`   Concurrency: ${CONCURRENCY}`);

  try {
    const pubsub = getDocumentProcessingPubSubClient();
    const subscriptionName = getDocumentProcessingSubscriptionName();
    const subscription = pubsub.subscription(subscriptionName);

    // Check if subscription exists, create if not (in dev environments)
    const [exists] = await subscription.exists();
    if (!exists) {
      if (isDevEnvironment()) {
        console.warn(`⚠️ Pub/Sub subscription ${subscriptionName} does not exist. Creating...`);

        const topic = await getDocProcessingTopic();
        await topic.createSubscription(subscriptionName, {
          ackDeadlineSeconds: ACK_DEADLINE,
          messageRetentionDuration: { seconds: 604800 }, // 7 days
          maxDeliveryAttempts: 5,
        });
        console.log(`✅ Pub/Sub subscription ${subscriptionName} created`);
      } else {
        throw new Error(`Subscription ${subscriptionName} does not exist. Please run setup script.`);
      }
    }

    // Configure subscription
    subscription.setOptions({
      flowControl: {
        maxMessages: CONCURRENCY,
      },
      ackDeadline: ACK_DEADLINE,
    });

    // Set up message handler
    subscription.on('message', handleMessage);

    // Set up error handler
    subscription.on('error', (error: Error) => {
      console.error('❌ Subscription error:', error);
    });

    isRunning = true;
    console.log(`✅ Document processing worker started - listening on subscription: ${subscriptionName}`);
  } catch (error: any) {
    console.error('❌ Failed to start document processing worker:', error);
    throw error;
  }
}

/**
 * Stop the document processing worker
 */
export async function stopDocumentProcessingWorker(): Promise<void> {
  if (!isRunning) {
    console.log('⚠️  Document processing worker is not running');
    return;
  }

  console.log('🛑 Stopping document processing worker...');

  // Wait for active jobs to complete (with timeout)
  const timeout = 30000; // 30 seconds
  const startTime = Date.now();
  
  while (activeJobs > 0 && Date.now() - startTime < timeout) {
    console.log(`⏳ Waiting for ${activeJobs} active jobs to complete...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (activeJobs > 0) {
    console.warn(`⚠️  Stopping worker with ${activeJobs} active jobs still running`);
  }

  isRunning = false;
  console.log('✅ Document processing worker stopped');
}

/**
 * Get worker status
 */
export function getWorkerStatus() {
  return {
    isRunning,
    activeJobs,
    maxConcurrency: CONCURRENCY,
    maxRetries: MAX_RETRIES,
    ackDeadline: ACK_DEADLINE,
  };
}
