/**
 * Audio Recorder Service
 * Streams audio chunks directly to Cloud Storage (async, non-blocking)
 * Publishes metadata to Pub/Sub for async processing
 */

import { Storage } from '@google-cloud/storage';
import { PubSub } from '@google-cloud/pubsub';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Firestore } from 'firebase-admin/firestore';
import { Writable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize clients (lazy initialization)
let storageClient: Storage | null = null;
let pubsubClient: PubSub | null = null;
let audioChunksTopic: any = null;
let firestoreDb: Firestore | null = null;

// Set Firestore instance (called from server setup)
export function setFirestoreDb(db: Firestore): void {
  firestoreDb = db;
}

// Streaming session per participant
interface StreamingSession {
  callId: string;
  participantEmail: string;
  orgSlug: string;
  orgId?: string;
  writeStream: Writable;
  file: any; // GCS File object
  storagePath: string;
  startTime: number;
  totalBytes: number;
  chunkCount: number;
  lastPublishTime: number; // Last time we published metadata
  segmentIndex: number; // Incremental segment index for Pub/Sub messages
}

const streamingSessions = new Map<string, StreamingSession>();
const sessionCreationLocks = new Map<string, Promise<StreamingSession>>(); // Track in-progress session creations to prevent duplicates
const orgSlugCache = new Map<string, string>(); // Cache org-slug by callId
const orgIdCache = new Map<string, string>(); // Cache orgId by callId

// Get project ID from credentials
function getProjectId(): string {
  const serviceAccountPath = join(__dirname, '../../gcp_credential.json');
  if (existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    return serviceAccount.project_id;
  }
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || '';
}

// Initialize Cloud Storage client
function getStorageClient(): Storage {
  if (!storageClient) {
    const serviceAccountPath = join(__dirname, '../../gcp_credential.json');
    const retryOptions = {
      autoRetry: true,
      maxRetries: 8, // Increased from 5 to 8 for better stability
      retryDelayMultiplier: 2,
      totalTimeout: 900000, // 15 minutes total timeout (increased for stability)
      maxRetryDelay: 120000, // Max 2 minutes between retries (increased for stability)
    };
    
    if (existsSync(serviceAccountPath)) {
      storageClient = new Storage({
        keyFilename: serviceAccountPath,
        retryOptions,
      });
    } else {
      // Use default credentials (for GKE with Workload Identity)
      storageClient = new Storage({
        retryOptions,
      });
    }
  }
  return storageClient;
}

// Initialize Pub/Sub client
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

// Get or create audio chunks topic
async function getAudioChunksTopic() {
  if (!audioChunksTopic) {
    const pubsub = getPubSubClient();
    const topicName = process.env.PUBSUB_AUDIO_CHUNKS_TOPIC || 'audio-chunks';
    audioChunksTopic = pubsub.topic(topicName);
    
    // Check if topic exists, create if not (in production, topics should be created via setup script)
    const [exists] = await audioChunksTopic.exists();
    if (!exists) {
      console.warn(`⚠️ Pub/Sub topic ${topicName} does not exist. Creating...`);
      await pubsub.createTopic(topicName);
      audioChunksTopic = pubsub.topic(topicName);
    }
  }
  return audioChunksTopic;
}

// Get storage bucket
function getStorageBucket() {
  const storage = getStorageClient();
  const bucketName = process.env.AUDIO_STORAGE_BUCKET || 'leanworks-prod';
  return storage.bucket(bucketName);
}

/**
 * Get org-slug and orgId for a callId (with caching)
 */
async function getOrgInfoForCall(callId: string): Promise<{ orgSlug: string; orgId?: string }> {
  // Check cache first
  if (orgSlugCache.has(callId)) {
    const orgSlug = orgSlugCache.get(callId)!;
    const orgId = orgIdCache.get(callId);
    return { orgSlug, orgId };
  }

  // Try to look up from Firestore call document
  if (firestoreDb) {
    try {
      // Search across all orgs/calls collections by looking for documents with matching ID
      const callsQuery = firestoreDb.collectionGroup('calls').limit(100);
      const snapshot = await callsQuery.get();
      
      // Find the document with matching callId
      for (const doc of snapshot.docs) {
        if (doc.id === callId) {
          const ref = doc.ref;
          const data = doc.data();
          // Extract org-slug from path: orgs/{orgSlug}/calls/{callId}
          const pathParts = ref.path.split('/');
          if (pathParts.length >= 2 && pathParts[0] === 'orgs') {
            const orgSlug = pathParts[1];
            const orgId = data.orgId || data.organizationId; // Try different field names
            orgSlugCache.set(callId, orgSlug);
            if (orgId) {
              orgIdCache.set(callId, orgId);
            }
            return { orgSlug, orgId };
          }
        }
      }
    } catch (error: any) {
      console.warn(`⚠️ Failed to look up org info for call ${callId}:`, error.message);
    }
  }

  // Fallback to 'default'
  const defaultSlug = 'default';
  orgSlugCache.set(callId, defaultSlug);
  return { orgSlug: defaultSlug };
}

/**
 * Create a streaming session for a participant
 */
async function createStreamingSession(
  callId: string,
  participantEmail: string,
  orgSlug?: string
): Promise<StreamingSession> {
  // Get org info if not provided
  const orgInfo = orgSlug ? { orgSlug, orgId: undefined } : await getOrgInfoForCall(callId);
  
  // Cache orgId if we found it
  if (orgInfo.orgId) {
    orgIdCache.set(callId, orgInfo.orgId);
  }
  
  // Generate storage path with org-slug prefix and date/time folder
  const timestamp = Date.now();
  const resolvedOrgSlug = orgInfo.orgSlug || 'default';
  
  // Create date/time folder (YYYY-MM-DD format)
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateFolder = `${year}-${month}-${day}`;
  
  const storagePath = `orgs/${resolvedOrgSlug}/recordings/${dateFolder}/${callId}/${participantEmail}/${timestamp}.pcm`;
  
  // Create GCS file and write stream
  const bucket = getStorageBucket();
  const file = bucket.file(storagePath);
  
  const writeStream = file.createWriteStream({
    resumable: true, // Use resumable uploads for reliability
    timeout: 600000, // 10 minutes timeout per request (increased for stability)
    metadata: {
      contentType: 'audio/pcm',
      metadata: {
        callId,
        participantEmail,
        timestamp: timestamp.toString(),
      },
    },
    validation: false, // Skip MD5 validation for faster uploads
  });
  
  const session: StreamingSession = {
    callId,
    participantEmail,
    orgSlug: resolvedOrgSlug,
    orgId: orgInfo.orgId,
    writeStream,
    file,
    storagePath,
    startTime: Date.now(),
    totalBytes: 0,
    chunkCount: 0,
    lastPublishTime: Date.now(),
    segmentIndex: 0,
  };
  
  // Handle stream errors (async, non-blocking)
  writeStream.on('error', (error: any) => {
    const isRetryable = error.code === 'ECONNRESET' || 
                       error.code === 'ETIMEDOUT' || 
                       error.code === 'EPIPE' ||
                       error.code === 408 ||
                       error.code === 429 ||
                       (error.code >= 500 && error.code < 600);
    
    if (isRetryable) {
      // For 408 timeout errors, check if retry limit was exceeded
      if (error.code === 408 && error.message?.includes('Retry limit exceeded')) {
        console.error(`❌ GCS upload session expired for ${participantEmail} (408 timeout, retry limit exceeded). This usually means the upload took too long or had too many gaps.`);
        // The GCS client has already exhausted retries, so this is a non-recoverable error
        // The stream will be closed, and we'll need to handle this at a higher level
      } else {
        console.warn(`⚠️ Retryable error in stream for ${participantEmail}: ${error.code || error.message}`);
        // Resumable streams handle retries automatically
      }
    } else {
      console.error(`❌ Non-retryable error in stream for ${participantEmail}:`, error);
    }
  });
  
  return session;
}

/**
 * Publish audio chunk metadata to Pub/Sub (async, non-blocking)
 * Called periodically during streaming and when stream closes
 */
async function publishChunkMetadata(session: StreamingSession, isFinal: boolean = false): Promise<void> {
  try {
    const storageUrl = `gs://${getStorageBucket().name}/${session.storagePath}`;
    const topic = await getAudioChunksTopic();
    
    // Increment segmentIndex BEFORE publishing to ensure unique segment numbers
    const currentSegmentIndex = session.segmentIndex;
    if (!isFinal) {
      session.segmentIndex++;
      session.lastPublishTime = Date.now();
    }
    
    const message = {
      callId: session.callId,
      participantEmail: session.participantEmail,
      storageUrl,
      timestamp: session.startTime,
      size: session.totalBytes,
      segmentIndex: currentSegmentIndex, // Use current segment index (before increment)
      chunkIndex: currentSegmentIndex, // Also include for backward compatibility
      chunkCount: session.chunkCount,
      orgId: session.orgId,
      isFinal, // Indicate if this is the final message for this stream
    };
    
    const messageId = await topic.publishMessage({ json: message });
    console.log(`📤 Published audio chunk metadata to Pub/Sub: ${messageId} (segment ${currentSegmentIndex}, ${session.totalBytes} bytes, ${session.chunkCount} chunks${isFinal ? ', final' : ''})`);
  } catch (error: any) {
    console.error(`❌ Error publishing chunk metadata for ${session.participantEmail}:`, error);
  }
}

/**
 * Record an audio chunk
 * Streams directly to Cloud Storage (async, non-blocking)
 */
export async function recordChunk(
  callId: string,
  participantEmail: string,
  audioData: Buffer,
  orgSlug?: string // Optional: if provided, will be used; otherwise looked up
): Promise<void> {
  try {
    const sessionKey = `${callId}:${participantEmail}`;
    
    // Get or create streaming session
    let session = streamingSessions.get(sessionKey);
    
    // Check if session exists but stream is closed/destroyed
    if (session && (session.writeStream.destroyed || session.writeStream.writableEnded)) {
      console.warn(`⚠️ Stream closed for ${participantEmail}, removing session and creating new one`);
      streamingSessions.delete(sessionKey);
      sessionCreationLocks.delete(sessionKey); // Also clear any lock
      session = null;
    }
    
    if (!session) {
      // Check if session creation is already in progress (prevent duplicate creation)
      if (sessionCreationLocks.has(sessionKey)) {
        // Wait for the existing creation to complete
        try {
          session = await sessionCreationLocks.get(sessionKey)!;
          // Verify the session is still valid after waiting
          if (session && (session.writeStream.destroyed || session.writeStream.writableEnded)) {
            // Session was created but is already closed, create a new one
            streamingSessions.delete(sessionKey);
            sessionCreationLocks.delete(sessionKey);
            session = null;
          } else if (session) {
            // Session is valid, use it
            console.log(`📡 Reusing streaming session for ${participantEmail} in call ${callId} (waited for creation)`);
          }
        } catch (error: any) {
          // Creation failed, clear lock and try again
          console.warn(`⚠️ Session creation failed, retrying:`, error.message);
          sessionCreationLocks.delete(sessionKey);
          session = null;
        }
      }
      
      // If still no session, create a new one with a lock
      if (!session) {
        // Create a lock promise to prevent concurrent creation
        const creationPromise = createStreamingSession(callId, participantEmail, orgSlug)
          .then((newSession) => {
            // Check if another session was created while we were creating this one
            const existing = streamingSessions.get(sessionKey);
            if (existing && existing !== newSession) {
              // Duplicate detected - close the new one and use the existing
              console.warn(`⚠️ Duplicate session detected for ${participantEmail}, closing new session and using existing`);
              newSession.writeStream.destroy();
              sessionCreationLocks.delete(sessionKey);
              return existing;
            }
            
            // Store the session
            streamingSessions.set(sessionKey, newSession);
            sessionCreationLocks.delete(sessionKey); // Clear lock when done
            console.log(`📡 Created streaming session for ${participantEmail} in call ${callId}`);
            return newSession;
          })
          .catch((error: any) => {
            // Clear lock on error
            sessionCreationLocks.delete(sessionKey);
            console.error(`❌ Error creating streaming session for ${participantEmail}:`, error);
            throw error;
          });
        
        // Store the lock promise
        sessionCreationLocks.set(sessionKey, creationPromise);
        
        // Wait for creation to complete
        session = await creationPromise;
      }
    }
    
    // Check if stream is still writable before writing
    if (session.writeStream.destroyed || session.writeStream.writableEnded) {
      console.warn(`⚠️ Cannot write to closed stream for ${participantEmail}, skipping chunk`);
      return;
    }
    
    // Write chunk to stream (async, non-blocking)
    const canWrite = session.writeStream.write(audioData, (error?: Error | null) => {
      if (error) {
        // Handle write-after-end errors gracefully
        if ((error as any).code === 'ERR_STREAM_WRITE_AFTER_END') {
          console.warn(`⚠️ Stream already closed for ${participantEmail}, removing session`);
          streamingSessions.delete(sessionKey);
          sessionCreationLocks.delete(sessionKey); // Clean up any lock
          return;
        }
        
        const isRetryable = (error as any).code === 'ECONNRESET' || 
                           (error as any).code === 'ETIMEDOUT' || 
                           (error as any).code === 'EPIPE';
        if (!isRetryable) {
          console.error(`❌ Error writing chunk for ${participantEmail}:`, error);
        }
      }
    });
    
    // Update session stats
    session.totalBytes += audioData.length;
    session.chunkCount++;
    
    // If stream is backpressured, wait for drain (but don't block the caller)
    if (!canWrite) {
      session.writeStream.once('drain', () => {
        // Stream is ready for more data
      });
    }
    
    // Publish metadata periodically (every ~10 seconds) to allow incremental transcription
    const timeSinceLastPublish = Date.now() - session.lastPublishTime;
    const PUBLISH_INTERVAL_MS = 10000; // Publish every 10 seconds
    if (timeSinceLastPublish >= PUBLISH_INTERVAL_MS) {
      // Publish asynchronously (don't await)
      publishChunkMetadata(session, false).catch((error) => {
        console.error(`❌ Error publishing periodic metadata:`, error);
      });
    }
    
    // Log periodically (every ~5 seconds worth of audio at 16kHz)
    const timeElapsed = Date.now() - session.startTime;
    if (timeElapsed > 0 && session.chunkCount % 200 === 0) {
      const bytesPerSecond = (session.totalBytes / timeElapsed) * 1000;
      console.log(`🎤 Streaming audio: ${session.chunkCount} chunks, ${session.totalBytes} bytes (${Math.round(bytesPerSecond)} bytes/s) for ${participantEmail}`);
    }
  } catch (error: any) {
    console.error(`❌ Error recording audio chunk for ${participantEmail}:`, error);
    // Don't throw - we don't want to break the WebSocket connection
  }
}

/**
 * Close streaming session and publish final metadata
 * Waits for GCS upload to complete (up to 5 minutes) before publishing final metadata
 */
async function closeStreamingSession(sessionKey: string, session: StreamingSession): Promise<void> {
  return new Promise((resolve) => {
    // Check if stream is already closed
    if (session.writeStream.destroyed || session.writeStream.writableEnded) {
      console.log(`✅ Stream already closed for ${session.participantEmail}`);
      // Still publish final metadata
      publishChunkMetadata(session, true).then(() => {
        resolve();
      }).catch((error) => {
        console.error(`❌ Error publishing final metadata:`, error);
        resolve();
      });
      return;
    }
    
    let uploadCompleted = false;
    let timeoutFired = false;
    
    // Wait for the GCS upload to complete (finish event)
    session.writeStream.on('finish', () => {
      if (timeoutFired) {
        // Timeout already fired, don't do anything
        return;
      }
      uploadCompleted = true;
      console.log(`✅ GCS upload completed for ${session.participantEmail}: ${session.totalBytes} bytes, ${session.chunkCount} chunks`);
      
      // Publish final metadata after upload is complete
      publishChunkMetadata(session, true).then(() => {
        resolve();
      }).catch((error) => {
        console.error(`❌ Error publishing final metadata:`, error);
        resolve(); // Resolve anyway to not block cleanup
      });
    });
    
    // Close the write stream
    session.writeStream.end(() => {
      console.log(`✅ Closed streaming session for ${session.participantEmail}: ${session.totalBytes} bytes, ${session.chunkCount} chunks`);
      // Note: 'finish' event will fire when upload completes
    });
    
    // Handle stream errors during close
    session.writeStream.on('error', (error: any) => {
      // Ignore write-after-end errors during close
      if ((error as any).code !== 'ERR_STREAM_WRITE_AFTER_END') {
        console.error(`❌ Error closing stream for ${session.participantEmail}:`, error);
      }
      
      // If upload hasn't completed and timeout hasn't fired, publish metadata anyway
      if (!uploadCompleted && !timeoutFired) {
        publishChunkMetadata(session, true).then(() => {
          resolve();
        }).catch(() => {
          resolve();
        });
      }
    });
    
    // Timeout after 5 minutes (300000ms) - still publish final metadata even if upload incomplete
    setTimeout(() => {
      if (!uploadCompleted) {
        timeoutFired = true;
        console.warn(`⚠️ Timeout waiting for GCS upload for ${session.participantEmail} (5 min), publishing final metadata anyway`);
        publishChunkMetadata(session, true).then(() => {
          resolve();
        }).catch((error) => {
          console.error(`❌ Error publishing final metadata after timeout:`, error);
          resolve();
        });
      }
    }, 300000); // 5 minutes = 300000ms
  });
}

/**
 * Clean up buffers for a participant (when they disconnect)
 */
export async function cleanupParticipantBuffer(callId: string, participantEmail: string): Promise<void> {
  const sessionKey = `${callId}:${participantEmail}`;
  const session = streamingSessions.get(sessionKey);
  
  if (session) {
    await closeStreamingSession(sessionKey, session);
    streamingSessions.delete(sessionKey);
    sessionCreationLocks.delete(sessionKey); // Clean up any lock
  }
}

/**
 * Flush all streams for a call (when call ends)
 */
export async function flushCallBuffers(callId: string): Promise<void> {
  const sessionsToClose: Array<[string, StreamingSession]> = [];
  
  // Find all sessions for this call
  for (const [key, session] of streamingSessions.entries()) {
    if (session.callId === callId) {
      sessionsToClose.push([key, session]);
    }
  }
  
  // Close all sessions in parallel
  await Promise.allSettled(
    sessionsToClose.map(([key, session]) => closeStreamingSession(key, session))
  );
  
  // Clean up sessions and locks
  for (const [key] of sessionsToClose) {
    streamingSessions.delete(key);
    sessionCreationLocks.delete(key); // Clean up any locks
  }
  
  console.log(`✅ Flushed ${sessionsToClose.length} streaming session(s) for call ${callId}`);
}
