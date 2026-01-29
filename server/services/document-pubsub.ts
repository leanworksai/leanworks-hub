/**
 * Document Processing Pub/Sub Service
 * 
 * Publishes document processing jobs and status updates to Pub/Sub
 * for async processing by workers.
 */

import { PubSub } from '@google-cloud/pubsub';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DocumentType } from './document-processor.js';
import { JobQueueError } from '../utils/document-errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize client (lazy initialization)
let pubsubClient: PubSub | null = null;
let docProcessingTopic: any = null;

/**
 * Get project ID from credentials
 */
function getProjectId(): string {
  const serviceAccountPath = join(__dirname, '../../gcp_credential.json');
  if (existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    return serviceAccount.project_id;
  }
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || '';
}

/**
 * Initialize Pub/Sub client
 */
function getPubSubClient(): PubSub {
  if (!pubsubClient) {
    const projectId = getProjectId();
    const serviceAccountPath = join(__dirname, '../../gcp_credential.json');
    if (existsSync(serviceAccountPath)) {
      pubsubClient = new PubSub({
        projectId,
        keyFilename: serviceAccountPath,
      });
    } else {
      // Use default credentials (for GKE with Workload Identity)
      pubsubClient = new PubSub({ projectId });
    }
  }
  return pubsubClient;
}

/**
 * Get or create document-processing topic
 */
async function getDocProcessingTopic() {
  if (!docProcessingTopic) {
    const pubsub = getPubSubClient();
    const topicName = process.env.PUBSUB_DOC_PROCESSING_TOPIC || 'document-processing';
    docProcessingTopic = pubsub.topic(topicName);
    
    // Check if topic exists, create if not (in production, topics should be created via setup script)
    const [exists] = await docProcessingTopic.exists();
    if (!exists) {
      console.warn(`⚠️ Pub/Sub topic ${topicName} does not exist. Creating...`);
      await pubsub.createTopic(topicName);
      docProcessingTopic = pubsub.topic(topicName);
    }
  }
  return docProcessingTopic;
}

/**
 * Document processing job data
 */
export interface DocumentProcessingJob {
  jobId: string;
  docId: string;
  docType: DocumentType;
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  orgSlug: string;
  userId: string;
  projectId?: string;
  teamId?: string;
  retryCount?: number;
  correlationId?: string;
}

/**
 * Document processing status update
 */
export interface DocumentProcessingStatus {
  jobId: string;
  docId: string;
  status: 'processing' | 'ready' | 'error';
  progress?: number; // 0-100
  errorMessage?: string;
  errorCode?: string;
  completedAt?: number;
}

/**
 * Publish a document processing job to Pub/Sub
 */
export async function publishDocumentProcessingJob(
  job: DocumentProcessingJob
): Promise<string> {
  try {
    const topic = await getDocProcessingTopic();
    
    const message = {
      type: 'process_document',
      ...job,
      timestamp: Date.now(),
    };

    const messageId = await topic.publishMessage({
      json: message,
      attributes: {
        jobId: job.jobId,
        docId: job.docId,
        docType: job.docType,
        orgSlug: job.orgSlug,
      },
    });

    console.log(`📤 Published document processing job to Pub/Sub: ${job.docId} (${job.docType}) - messageId: ${messageId}`);
    
    return messageId;
  } catch (error: any) {
    console.error(`❌ Error publishing document processing job to Pub/Sub:`, error);
    throw new JobQueueError(
      'publish job',
      error.message || 'Unknown error'
    );
  }
}

/**
 * Publish a document processing status update to Pub/Sub
 */
export async function publishDocumentProcessingStatus(
  status: DocumentProcessingStatus
): Promise<string> {
  try {
    const topic = await getDocProcessingTopic();
    
    const message = {
      type: 'status_update',
      ...status,
      timestamp: Date.now(),
    };

    const messageId = await topic.publishMessage({
      json: message,
      attributes: {
        jobId: status.jobId,
        docId: status.docId,
        status: status.status,
      },
    });

    console.log(`📤 Published document processing status to Pub/Sub: ${status.docId} - ${status.status} - messageId: ${messageId}`);
    
    return messageId;
  } catch (error: any) {
    console.error(`❌ Error publishing document processing status to Pub/Sub:`, error);
    throw new JobQueueError(
      'publish status',
      error.message || 'Unknown error'
    );
  }
}

/**
 * Batch publish multiple jobs (for bulk uploads)
 */
export async function publishDocumentProcessingJobsBatch(
  jobs: DocumentProcessingJob[]
): Promise<string[]> {
  try {
    const topic = await getDocProcessingTopic();
    
    const messages = jobs.map(job => ({
      json: {
        type: 'process_document',
        ...job,
        timestamp: Date.now(),
      },
      attributes: {
        jobId: job.jobId,
        docId: job.docId,
        docType: job.docType,
        orgSlug: job.orgSlug,
      },
    }));

    const messageIds = await topic.publishMessage(messages);

    console.log(`📤 Published ${jobs.length} document processing jobs to Pub/Sub (batch)`);
    
    return messageIds;
  } catch (error: any) {
    console.error(`❌ Error publishing document processing jobs batch to Pub/Sub:`, error);
    throw new JobQueueError(
      'publish jobs batch',
      error.message || 'Unknown error'
    );
  }
}

/**
 * Get Pub/Sub client for direct use (e.g., in workers)
 */
export function getDocumentProcessingPubSubClient(): PubSub {
  return getPubSubClient();
}

/**
 * Get topic name
 */
export function getDocumentProcessingTopicName(): string {
  return process.env.PUBSUB_DOC_PROCESSING_TOPIC || 'document-processing';
}

/**
 * Get subscription name
 */
export function getDocumentProcessingSubscriptionName(): string {
  return process.env.PUBSUB_DOC_PROCESSING_SUBSCRIPTION || 'document-processing-sub';
}
