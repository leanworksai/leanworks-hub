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

// Chunk duration and overlap constants
const CHUNK_DURATION_MS = 45000; // 45 seconds (configurable: 30-60s)
const CHUNK_OVERLAP_MS = 300; // 300ms overlap (200-500ms range)
// At 16kHz PCM (16-bit): 1 second = 16,000 samples * 2 bytes = 32,000 bytes
// 45 seconds = 1,440,000 bytes ≈ 1.4MB
const CHUNK_DURATION_BYTES = Math.floor((CHUNK_DURATION_MS / 1000) * 16000 * 2); // Bytes for chunk duration at 16kHz
const CHUNK_OVERLAP_BYTES = Math.floor((CHUNK_OVERLAP_MS / 1000) * 16000 * 2); // Bytes for overlap at 16kHz

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
  // Chunk rotation fields
  currentChunkIndex: number; // Current chunk index (0-based)
  currentChunkStartTime: number; // When current chunk started
  currentChunkBytes: number; // Bytes written to current chunk
  overlapBuffer: Buffer; // Last CHUNK_OVERLAP_BYTES from previous chunk
  sampleRate: number; // Sample rate in Hz (immutable once set, e.g., 16000 or 48000)
}

const streamingSessions = new Map<string, StreamingSession>();
const sessionCreationLocks = new Map<string, Promise<StreamingSession>>(); // Track in-progress session creations to prevent duplicates
const orgSlugCache = new Map<string, string>(); // Cache org-slug by callId
const orgIdCache = new Map<string, string>(); // Cache orgId by callId

/**
 * Interface for streaming original 48kHz audio to a single file
 */
interface OriginalAudioSession {
  callId: string;
  participantEmail: string;
  orgSlug: string;
  writeStream: Writable;
  file: any; // GCS File object
  storagePath: string;
  totalBytes: number;
  sampleRate: number; // Always 48000 for original audio
}

const originalAudioSessions = new Map<string, OriginalAudioSession>();
const originalAudioSessionLocks = new Map<string, Promise<OriginalAudioSession>>();

/**
 * Get or create streaming session for original 48kHz audio
 * Creates a single file per participant per call and streams chunks to it
 */
async function getOrCreateOriginalAudioSession(
  callId: string,
  participantEmail: string,
  orgSlug?: string
): Promise<OriginalAudioSession | null> {
  // Check if original audio saving is enabled
  const saveOriginal = process.env.SAVE_ORIGINAL_AUDIO === 'true' || 
                       process.env.NODE_ENV === 'development';
  
  if (!saveOriginal) {
    return null; // Skip if not enabled
  }

  const sessionKey = `${callId}:${participantEmail}:original`;
  
  // Check if session already exists and is valid
  let session = originalAudioSessions.get(sessionKey);
  if (session && !session.writeStream.destroyed && !session.writeStream.writableEnded) {
    return session;
  }
  
  // Check if creation is in progress
  if (originalAudioSessionLocks.has(sessionKey)) {
    try {
      return await originalAudioSessionLocks.get(sessionKey)!;
    } catch {
      // Creation failed, continue to create new one
      originalAudioSessionLocks.delete(sessionKey);
    }
  }
  
  // Resolve org info
  let resolvedOrgSlug = orgSlug;
  if (!resolvedOrgSlug) {
    const orgInfo = await getOrgInfoForCall(callId);
    if (!orgInfo) {
      console.warn(`⚠️ Could not resolve org for call ${callId}, skipping original audio save`);
      return null;
    }
    resolvedOrgSlug = orgInfo.orgSlug;
  }
  
  // Create storage path for original audio (single file per participant)
  const timestamp = Date.now();
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateFolder = `${year}-${month}-${day}`;
  
  const storagePath = `orgs/${resolvedOrgSlug}/recordings/${dateFolder}/${callId}/${participantEmail}/original_48kHz.wav`;
  
  // Create GCS file and write stream
  const bucket = getStorageBucket();
  const file = bucket.file(storagePath);
  
  const writeStream = file.createWriteStream({
    resumable: true,
    timeout: 600000, // 10 minutes
    metadata: {
      contentType: 'audio/wav',
      metadata: {
        callId,
        participantEmail,
        timestamp: timestamp.toString(),
        isOriginal: 'true',
        sampleRate: '48000',
      },
    },
    validation: false,
  });
  
  // Write WAV header with placeholder size (will be updated when stream closes)
  const maxExpectedSize = 10 * 1024 * 1024; // 10MB placeholder (adjust as needed)
  const wavHeader = createWavHeader(maxExpectedSize, 48000);
  writeStream.write(wavHeader);
  
  const newSession: OriginalAudioSession = {
    callId,
    participantEmail,
    orgSlug: resolvedOrgSlug,
    writeStream,
    file,
    storagePath,
    totalBytes: 0,
    sampleRate: 48000,
  };
  
  // Handle stream errors
  writeStream.on('error', (error: any) => {
    const isRetryable = error.code === 'ECONNRESET' || 
                       error.code === 'ETIMEDOUT' || 
                       error.code === 'EPIPE' ||
                       error.code === 408 ||
                       error.code === 429 ||
                       (error.code >= 500 && error.code < 600);
    if (!isRetryable) {
      console.error(`❌ Non-retryable error in original audio stream for ${participantEmail}:`, error);
    }
  });
  
  // Store session
  originalAudioSessions.set(sessionKey, newSession);
  
  console.log(`📝 Created original audio stream for ${participantEmail}: ${storagePath}`);
  
  return newSession;
}

/**
 * Save original 48kHz audio chunk (appends to single file)
 * Only saves if SAVE_ORIGINAL_AUDIO env var is set to 'true' or in development mode
 * 
 * @param callId - Call ID
 * @param participantEmail - Participant email
 * @param originalAudio - Original 48kHz audio buffer
 * @param orgSlug - Organization slug (optional)
 */
export async function saveOriginalAudio(
  callId: string,
  participantEmail: string,
  originalAudio: Buffer,
  orgSlug?: string
): Promise<void> {
  try {
    // Get or create streaming session
    const sessionKey = `${callId}:${participantEmail}:original`;
    let session = originalAudioSessions.get(sessionKey);
    
    if (!session || session.writeStream.destroyed || session.writeStream.writableEnded) {
      // Create new session (with lock to prevent duplicates)
      if (originalAudioSessionLocks.has(sessionKey)) {
        try {
          session = await originalAudioSessionLocks.get(sessionKey)!;
        } catch {
          originalAudioSessionLocks.delete(sessionKey);
        }
      }
      
      if (!session) {
        const creationPromise = getOrCreateOriginalAudioSession(callId, participantEmail, orgSlug)
          .then((newSession) => {
            originalAudioSessionLocks.delete(sessionKey);
            if (newSession) {
              originalAudioSessions.set(sessionKey, newSession);
            }
            return newSession;
          })
          .catch((error) => {
            originalAudioSessionLocks.delete(sessionKey);
            console.error(`❌ Error creating original audio session:`, error);
            return null;
          });
        
        originalAudioSessionLocks.set(sessionKey, creationPromise);
        session = await creationPromise;
      }
    }
    
    if (!session) {
      return; // Not enabled or failed to create
    }
    
    // Check if stream is still writable
    if (session.writeStream.destroyed || session.writeStream.writableEnded) {
      console.warn(`⚠️ Cannot write to closed original audio stream for ${participantEmail}`);
      originalAudioSessions.delete(sessionKey);
      return;
    }
    
    // DIAGNOSTIC: Check audio levels before writing (sample every 100 chunks to avoid spam)
    if (session.totalBytes % (1920 * 100) < 1920 && originalAudio.length >= 20) {
      const samples: number[] = [];
      let peak = 0;
      let rmsSum = 0;
      const numSamples = Math.min(50, Math.floor(originalAudio.length / 2));
      
      for (let i = 0; i < numSamples && i * 2 < originalAudio.length; i++) {
        const sample = originalAudio.readInt16LE(i * 2);
        samples.push(sample);
        const abs = Math.abs(sample);
        peak = Math.max(peak, abs);
        rmsSum += sample * sample;
      }
      
      const rms = Math.sqrt(rmsSum / numSamples);
      const peakDb = peak > 0 ? (20 * Math.log10(peak / 32768)).toFixed(2) : '-Inf';
      const chunkNum = Math.floor(session.totalBytes / 1920);
      
      // Also check if there are any suspicious patterns (repeated values, all zeros, etc.)
      const uniqueValues = new Set(samples.map(s => Math.abs(s)));
      const hasRepeatedPattern = uniqueValues.size < numSamples * 0.3; // More than 70% repeated values
      const allZeros = peak === 0;
      
      console.log(`🔍 Original audio diagnostic (chunk ~${chunkNum}): ${originalAudio.length} bytes, peak: ${peak} (${peakDb} dB), RMS: ${rms.toFixed(0)}`);
      
      if (hasRepeatedPattern && !allZeros) {
        console.warn(`   ⚠️ Suspicious pattern detected: ${uniqueValues.size} unique values out of ${numSamples} samples (might indicate data corruption)`);
      }
      
      if (peak < 100 && chunkNum > 10) {
        console.warn(`   ⚠️ Audio is very quiet after ${chunkNum} chunks - this might indicate a problem`);
      }
    }
    
    // Append audio data to stream (PCM data only, header already written)
    const canWrite = session.writeStream.write(originalAudio, (error?: Error | null) => {
      if (error) {
        if ((error as any).code !== 'ERR_STREAM_WRITE_AFTER_END') {
          console.warn(`⚠️ Error writing original audio chunk for ${participantEmail}:`, error.message);
        }
      }
    });
    
    // Update session stats
    session.totalBytes += originalAudio.length;
    
    // Handle backpressure
    if (!canWrite) {
      session.writeStream.once('drain', () => {
        // Stream ready for more data
      });
    }
    
  } catch (error: any) {
    // Don't fail the main flow if original audio save fails
    console.warn(`⚠️ Failed to save original audio for ${participantEmail}:`, error.message);
  }
}

  /**
   * Close original audio streaming session
   * Updates WAV header with actual file size after upload completes
   * Should be called when call ends or participant disconnects
   */
  export async function closeOriginalAudioSession(
  callId: string,
  participantEmail: string
): Promise<void> {
  const sessionKey = `${callId}:${participantEmail}:original`;
  const session = originalAudioSessions.get(sessionKey);
  
  if (!session) {
    return; // No session to close
  }
  
  return new Promise((resolve) => {
    if (session.writeStream.destroyed || session.writeStream.writableEnded) {
      originalAudioSessions.delete(sessionKey);
      resolve();
      return;
    }
    
    session.writeStream.on('finish', async () => {
      console.log(`✅ Closed original audio stream for ${participantEmail}: ${session.totalBytes} bytes`);
      
      // CRITICAL: Update WAV header with actual file size
      // The header currently has a placeholder size, we need to fix it
      try {
        const actualPcmSize = session.totalBytes;
        const actualFileSize = 44 + actualPcmSize; // 44 bytes for WAV header + PCM data
        
        // Download the file, update header, and re-upload
        const [fileBuffer] = await session.file.download();
        
        // VERIFY: Check that the downloaded file matches what we wrote
        const expectedTotalSize = 44 + actualPcmSize; // 44-byte header + PCM data
        if (fileBuffer.length !== expectedTotalSize) {
          console.error(`❌ CRITICAL: Downloaded file size mismatch!`);
          console.error(`   Expected: ${expectedTotalSize} bytes (44 header + ${actualPcmSize} PCM)`);
          console.error(`   Actual: ${fileBuffer.length} bytes`);
          console.error(`   This could cause audio corruption!`);
        }
        
        // VERIFY: Check WAV header is valid before modifying
        const riffId = fileBuffer.toString('ascii', 0, 4);
        const waveId = fileBuffer.toString('ascii', 8, 12);
        if (riffId !== 'RIFF' || waveId !== 'WAVE') {
          console.error(`❌ CRITICAL: Invalid WAV header! RIFF=${riffId}, WAVE=${waveId}`);
          throw new Error('Invalid WAV header structure');
        }
        
        // VERIFY: Check current sample rate in header (CRITICAL for playback)
        const currentSampleRate = fileBuffer.readUInt32LE(24);
        if (currentSampleRate !== 48000) {
          console.error(`❌ CRITICAL: Sample rate mismatch in header!`);
          console.error(`   Expected: 48000 Hz, Found: ${currentSampleRate} Hz`);
          console.error(`   This will cause "slow and deep" sound when played!`);
          // Fix it
          fileBuffer.writeUInt32LE(48000, 24);
          fileBuffer.writeUInt32LE(96000, 28); // Byte rate = 48000 * 1 * 2
          console.log(`   ✅ Fixed sample rate to 48000 Hz in header`);
        }
        
        // Update RIFF chunk size (bytes 4-7)
        fileBuffer.writeUInt32LE(actualFileSize, 4);
        
        // Update data chunk size (bytes 40-43)
        fileBuffer.writeUInt32LE(actualPcmSize, 40);
        
        // VERIFY: Sample a few audio samples to ensure data wasn't corrupted
        if (fileBuffer.length > 100) {
          const sample1 = fileBuffer.readInt16LE(44);
          const sample2 = fileBuffer.readInt16LE(46);
          const sample3 = fileBuffer.readInt16LE(48);
          console.log(`   Verification: First 3 audio samples: ${sample1}, ${sample2}, ${sample3}`);
          
          // Check if samples are in reasonable range (not all zeros, not maxed out)
          const samples = [sample1, sample2, sample3];
          const allZeros = samples.every(s => s === 0);
          const allMaxed = samples.every(s => Math.abs(s) > 30000);
          
          if (allZeros) {
            console.warn(`   ⚠️ WARNING: First samples are all zeros - might be silence or corruption`);
          } else if (allMaxed) {
            console.warn(`   ⚠️ WARNING: First samples are maxed out - might indicate corruption`);
          }
        }
        
        // Re-upload with corrected header
        await session.file.save(fileBuffer, {
          metadata: {
            contentType: 'audio/wav',
            metadata: session.file.metadata?.metadata || {},
          },
        });
        
        const finalSampleRate = fileBuffer.readUInt32LE(24);
        console.log(`✅ Updated WAV header for original audio: ${actualPcmSize} bytes PCM data, sample rate: ${finalSampleRate}Hz`);
      } catch (error: any) {
        console.warn(`⚠️ Failed to update WAV header for original audio:`, error.message);
        // Don't fail - the file is still usable, just with incorrect header size
      }
      
      originalAudioSessions.delete(sessionKey);
      resolve();
    });
    
    session.writeStream.on('error', (error: any) => {
      console.warn(`⚠️ Error closing original audio stream:`, error.message);
      originalAudioSessions.delete(sessionKey);
      resolve();
    });
    
    // Close the stream
    session.writeStream.end();
    
    // Timeout after 30 seconds
    setTimeout(() => {
      if (originalAudioSessions.has(sessionKey)) {
        console.warn(`⚠️ Timeout closing original audio stream for ${participantEmail}`);
        originalAudioSessions.delete(sessionKey);
        resolve();
      }
    }, 30000);
  });
}

/**
 * Create WAV file header
 * WAV is a container format that wraps PCM data with a header
 * 
 * @param pcmDataSize - Size of PCM data in bytes (use placeholder size for streaming)
 * @param sampleRate - Sample rate in Hz (default: 16000)
 * @returns 44-byte WAV header buffer
 */
function createWavHeader(pcmDataSize: number, sampleRate: number = 16000): Buffer {
  const numChannels = 1; // Mono
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const fileSize = 36 + pcmDataSize;
  
  // WAV file header (44 bytes)
  const wavHeader = Buffer.alloc(44);
  
  // RIFF header
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(fileSize, 4);
  wavHeader.write('WAVE', 8);
  
  // fmt chunk
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16); // fmt chunk size
  wavHeader.writeUInt16LE(1, 20); // audio format (1 = PCM)
  wavHeader.writeUInt16LE(numChannels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  
  // data chunk
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(pcmDataSize, 40);
  
  return wavHeader;
}

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
 * Never falls back to 'default' - throws error if not found
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
      // First try: Search by document ID (most reliable)
      const callsQuery = firestoreDb.collectionGroup('calls');
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
            console.log(`✅ Found orgSlug ${orgSlug} for call ${callId} via document ID lookup`);
            return { orgSlug, orgId };
          }
        }
      }
      
      // Second try: If callId format is {chatId}-{timestamp}, try searching by roomName
      // CallId format: dm-email1-email2-{timestamp} or call-dm-email1-email2
      const callIdMatch = callId.match(/^(call-)?(.+)-(\d+)$/);
      if (callIdMatch) {
        const potentialRoomName = callIdMatch[1] ? callId : `call-${callIdMatch[2]}`;
        console.log(`🔍 Trying roomName lookup for call ${callId} with roomName: ${potentialRoomName}`);
        
        try {
          const roomQuery = firestoreDb.collectionGroup('calls')
            .where('roomName', '==', potentialRoomName)
            .orderBy('createdAt', 'desc')
            .limit(5);
          const roomSnapshot = await roomQuery.get();
          
          for (const doc of roomSnapshot.docs) {
            // Prefer exact match, but also accept active calls
            if (doc.id === callId || doc.data().status === 'active' || doc.data().status === 'ringing') {
              const pathParts = doc.ref.path.split('/');
              if (pathParts.length >= 2 && pathParts[0] === 'orgs') {
                const orgSlug = pathParts[1];
                orgSlugCache.set(callId, orgSlug);
                console.log(`✅ Found orgSlug ${orgSlug} for call ${callId} via roomName lookup`);
                return { orgSlug };
              }
            }
          }
        } catch (roomError: any) {
          // Index might not exist, that's okay - continue to error
          console.warn(`⚠️ RoomName lookup failed for call ${callId}:`, roomError.message);
        }
      }
    } catch (error: any) {
      console.error(`❌ Failed to look up org info for call ${callId}:`, error.message);
    }
  }

  // Don't fall back to 'default' - throw error instead
  // This ensures we don't accidentally save files to the wrong location
  throw new Error(`Could not find orgSlug for call ${callId}. Call document may not exist yet or lookup failed.`);
}

/**
 * Create a streaming session for a participant
 */
async function createStreamingSession(
  callId: string,
  participantEmail: string,
  orgSlug?: string,
  sampleRate: number = 16000 // Default to 16kHz (AssemblyAI requirement)
): Promise<StreamingSession> {
  // Get org info if not provided
  let orgInfo: { orgSlug: string; orgId?: string };
  
  if (orgSlug) {
    // Use provided orgSlug
    orgInfo = { orgSlug, orgId: undefined };
    // Cache it
    orgSlugCache.set(callId, orgSlug);
  } else {
    // Try to look up orgSlug, with retry logic in case call document doesn't exist yet
    let lookupAttempts = 0;
    const maxAttempts = 3;
    let lastError: Error | null = null;
    
    while (lookupAttempts < maxAttempts) {
      try {
        orgInfo = await getOrgInfoForCall(callId);
        break; // Success, exit loop
      } catch (error: any) {
        lastError = error;
        lookupAttempts++;
        
        if (lookupAttempts < maxAttempts) {
          // Wait a bit before retrying (call document might be created after WebSocket connects)
          const waitTime = lookupAttempts * 1000; // 1s, 2s
          console.log(`⏳ OrgSlug lookup failed for call ${callId}, retrying in ${waitTime}ms (attempt ${lookupAttempts}/${maxAttempts})...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    // If all attempts failed, throw error
    if (!orgInfo!) {
      console.error(`❌ Failed to find orgSlug for call ${callId} after ${maxAttempts} attempts`);
      throw lastError || new Error(`Could not determine orgSlug for call ${callId}`);
    }
  }
  
  // Cache orgId if we found it
  if (orgInfo.orgId) {
    orgIdCache.set(callId, orgInfo.orgId);
  }
  
  // Generate storage path with org-slug prefix and date/time folder
  const timestamp = Date.now();
  const resolvedOrgSlug = orgInfo.orgSlug;
  
  // Create date/time folder (YYYY-MM-DD format)
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateFolder = `${year}-${month}-${day}`;
  
  // Query existing chunks to find the last chunk index (to continue from where we left off)
  const bucket = getStorageBucket();
  const prefix = `orgs/${resolvedOrgSlug}/recordings/${dateFolder}/${callId}/${participantEmail}/chunk_`;
  let maxChunkIndex = -1;
  
  try {
    const [files] = await bucket.getFiles({ prefix });
    for (const file of files) {
      // Extract chunk index from filename: chunk_0.wav, chunk_1.wav, etc.
      const match = file.name.match(/chunk_(\d+)\.wav$/);
      if (match) {
        const index = parseInt(match[1], 10);
        maxChunkIndex = Math.max(maxChunkIndex, index);
      }
    }
    if (maxChunkIndex >= 0) {
      console.log(`📊 Found existing chunks for ${participantEmail} in call ${callId}, continuing from chunk ${maxChunkIndex + 1}`);
    }
  } catch (error: any) {
    // If query fails, start from 0 (non-fatal error)
    console.warn(`⚠️ Could not query existing chunks for ${participantEmail}, starting from chunk 0:`, error.message);
  }
  
  // Start from next chunk index (or 0 if no existing chunks)
  const initialChunkIndex = maxChunkIndex + 1;
  
  // Storage path for chunk: orgs/{orgSlug}/recordings/{date}/{callId}/{participantEmail}/chunk_{index}.wav
  const storagePath = `orgs/${resolvedOrgSlug}/recordings/${dateFolder}/${callId}/${participantEmail}/chunk_${initialChunkIndex}.wav`;
  
  // Create GCS file and write stream
  const file = bucket.file(storagePath);
  
  const writeStream = file.createWriteStream({
    resumable: true, // Use resumable uploads for reliability
    timeout: 600000, // 10 minutes timeout per request (increased for stability)
    metadata: {
      contentType: 'audio/wav',
      metadata: {
        callId,
        participantEmail,
        chunkIndex: initialChunkIndex.toString(),
        timestamp: timestamp.toString(),
      },
    },
    validation: false, // Skip MD5 validation for faster uploads
  });
  
  // Write WAV header before streaming PCM data
  // Use placeholder size (max expected chunk size ~2MB) since we don't know final size yet
  // WAV format is tolerant of slightly incorrect size values
  const maxExpectedChunkSize = 2 * 1024 * 1024; // 2MB
  // Use explicit sample rate (immutable once set)
  const wavHeader = createWavHeader(maxExpectedChunkSize, sampleRate);
  writeStream.write(wavHeader);
  
  // CRITICAL: Log sample rate to verify it's correct
  console.log(`📝 Created WAV file for ${participantEmail} with sample rate: ${sampleRate}Hz (header size: ${maxExpectedChunkSize} bytes placeholder)`);
  
  const now = Date.now();
  const session: StreamingSession = {
    callId,
    participantEmail,
    orgSlug: resolvedOrgSlug,
    orgId: orgInfo.orgId,
    writeStream,
    file,
    storagePath,
    startTime: now,
    totalBytes: 0,
    chunkCount: 0,
    lastPublishTime: now,
    segmentIndex: 0,
    currentChunkIndex: initialChunkIndex,
    currentChunkStartTime: now,
    currentChunkBytes: 0,
    overlapBuffer: Buffer.alloc(0), // Start with empty overlap buffer
    sampleRate, // Store sample rate (immutable once set)
  };
  
  // Handle stream errors (async, non-blocking)
  writeStream.on('error', async (error: any) => {
    const isRetryable = error.code === 'ECONNRESET' || 
                       error.code === 'ETIMEDOUT' || 
                       error.code === 'EPIPE' ||
                       error.code === 408 ||
                       error.code === 429 ||
                       (error.code >= 500 && error.code < 600);
    
    if (isRetryable) {
      // For 408 timeout errors, check if retry limit was exceeded
      if (error.code === 408 && error.message?.includes('Retry limit exceeded')) {
        // Check if stream is being closed (writableEnded or destroyed)
        const isClosing = session.writeStream.writableEnded || session.writeStream.destroyed;
        
        if (isClosing) {
          // Stream is closing - this is expected, just log a warning
          console.warn(`⚠️ GCS upload timeout during stream close for ${participantEmail} (expected, final chunk will still be published)`);
          return; // Don't do recovery - closeStreamingSession will handle it
        }
        
        // Stream is still active - do recovery
        console.error(`❌ GCS upload session expired for ${participantEmail} (408 timeout, retry limit exceeded).`);
        console.error(`   Attempting recovery: publishing current chunk and removing broken session...`);
        
        const sessionKey = `${session.callId}:${session.participantEmail}`;
        const currentStorageUrl = `gs://${getStorageBucket().name}/${session.storagePath}`;
        
        // CRITICAL: Publish the current chunk immediately (even if upload failed)
        // This ensures the transcription worker receives it and doesn't miss sentences
        try {
          await publishAudioChunkReady(
            session,
            session.currentChunkIndex,
            session.currentChunkStartTime,
            Date.now(),
            currentStorageUrl,
            false // Not final, just intermediate chunk
          );
          console.log(`✅ Published chunk ${session.currentChunkIndex} after 408 timeout recovery`);
        } catch (pubError: any) {
          console.error(`❌ Failed to publish chunk after 408 timeout:`, pubError);
        }
        
        // Remove broken session so new chunks can create a fresh one
        streamingSessions.delete(sessionKey);
        sessionCreationLocks.delete(sessionKey);
        
        // Destroy the broken stream
        try {
          session.writeStream.destroy();
        } catch (destroyError) {
          // Ignore destroy errors
        }
        
        console.log(`✅ Removed broken session for ${participantEmail}, new chunks will create fresh session`);
      } else {
        console.warn(`⚠️ Retryable error in stream for ${participantEmail}: ${error.code || error.message}`);
        // Resumable streams handle retries automatically
      }
    } else {
      // Only log non-retryable errors if stream is not closing
      if (!session.writeStream.writableEnded && !session.writeStream.destroyed) {
        console.error(`❌ Non-retryable error in stream for ${participantEmail}:`, error);
      }
    }
  });
  
  return session;
}

/**
 * Publish AudioChunkReady event to Pub/Sub (async, non-blocking)
 * Called when a chunk is complete and ready for transcription
 */
async function publishAudioChunkReady(
  session: StreamingSession,
  chunkIndex: number,
  chunkStartTime: number,
  chunkEndTime: number,
  storageUrl: string,
  isFinal: boolean = false
): Promise<void> {
  try {
    const topic = await getAudioChunksTopic();
    
    const message = {
      event: 'audio_chunk_ready',
      callId: session.callId,
      participantEmail: session.participantEmail,
      chunkIndex,
      storageUrl,
      chunkStartTime,
      chunkEndTime,
      orgSlug: session.orgSlug,
      isFinal,
    };
    
    const messageId = await topic.publishMessage({ json: message });
    console.log(`📤 Published AudioChunkReady event: ${messageId} (chunk ${chunkIndex}, ${chunkEndTime - chunkStartTime}ms, ${isFinal ? 'final' : 'intermediate'})`);
  } catch (error: any) {
    console.error(`❌ Error publishing AudioChunkReady event for chunk ${chunkIndex}:`, error);
  }
}

/**
 * Rotate to a new chunk file
 * Closes current chunk, publishes AudioChunkReady, and starts new chunk with overlap
 */
async function rotateChunk(sessionKey: string, session: StreamingSession): Promise<void> {
  return new Promise((resolve) => {
    const currentChunkIndex = session.currentChunkIndex;
    const currentChunkStartTime = session.currentChunkStartTime;
    const currentChunkEndTime = Date.now();
    const currentStoragePath = session.storagePath;
    const currentStorageUrl = `gs://${getStorageBucket().name}/${currentStoragePath}`;
    
    // Use overlap buffer from session (maintained in memory as we write)
    const overlapBuffer = session.overlapBuffer.length > 0 
      ? Buffer.from(session.overlapBuffer) 
      : Buffer.alloc(0);
    
    // Close current chunk file
    let uploadCompleted = false;
    let timeoutFired = false;
    
    session.writeStream.on('finish', async () => {
      if (timeoutFired) return;
      uploadCompleted = true;
      
      try {
        // Publish AudioChunkReady event for completed chunk
        await publishAudioChunkReady(
          session,
          currentChunkIndex,
          currentChunkStartTime,
          currentChunkEndTime,
          currentStorageUrl,
          false
        );
        
        // Start new chunk with overlap
        const newChunkIndex = currentChunkIndex + 1;
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateFolder = `${year}-${month}-${day}`;
        const newStoragePath = `orgs/${session.orgSlug}/recordings/${dateFolder}/${session.callId}/${session.participantEmail}/chunk_${newChunkIndex}.wav`;
        
        const bucket = getStorageBucket();
        const newFile = bucket.file(newStoragePath);
        const newWriteStream = newFile.createWriteStream({
          resumable: true,
          timeout: 600000,
          metadata: {
            contentType: 'audio/wav',
            metadata: {
              callId: session.callId,
              participantEmail: session.participantEmail,
              chunkIndex: newChunkIndex.toString(),
              timestamp: Date.now().toString(),
            },
          },
          validation: false,
        });
        
        // Handle errors on new stream
        newWriteStream.on('error', async (error: any) => {
          const isRetryable = error.code === 'ECONNRESET' || 
                             error.code === 'ETIMEDOUT' || 
                             error.code === 'EPIPE' ||
                             error.code === 408 ||
                             error.code === 429 ||
                             (error.code >= 500 && error.code < 600);
          
          if (error.code === 408 && error.message?.includes('Retry limit exceeded')) {
            console.error(`❌ Stream failed during rotation for ${session.participantEmail}, attempting recovery...`);
            
            // Try to publish the current chunk anyway (even if upload failed)
            try {
              await publishAudioChunkReady(
                session,
                currentChunkIndex,
                currentChunkStartTime,
                currentChunkEndTime,
                currentStorageUrl,
                false
              );
              console.log(`✅ Published chunk ${currentChunkIndex} after rotation failure recovery`);
            } catch (pubError) {
              console.error(`❌ Failed to publish chunk after rotation error:`, pubError);
            }
            
            // Remove session so new chunks can create a fresh one
            const sessionKey = `${session.callId}:${session.participantEmail}`;
            streamingSessions.delete(sessionKey);
            sessionCreationLocks.delete(sessionKey);
            
            // Resolve to allow continuation
            resolve();
          } else if (!isRetryable) {
            console.error(`❌ Non-retryable error in new chunk stream for ${session.participantEmail}:`, error);
          }
        });
      
      // Write WAV header before streaming PCM data
      const maxExpectedChunkSize = 2 * 1024 * 1024; // 2MB placeholder
      // Use session's sample rate (immutable, set at session creation)
      const wavHeader = createWavHeader(maxExpectedChunkSize, session.sampleRate);
      newWriteStream.write(wavHeader);
        
        // Update session for new chunk
        session.writeStream = newWriteStream;
        session.file = newFile;
        session.storagePath = newStoragePath;
        session.currentChunkIndex = newChunkIndex;
        session.currentChunkStartTime = Date.now();
        session.currentChunkBytes = 0;
        // Keep overlap buffer for next rotation (will be updated as we write)
        
        // Write overlap buffer to new chunk if we have it
        if (overlapBuffer.length > 0) {
          const canWrite = newWriteStream.write(overlapBuffer);
          session.currentChunkBytes += overlapBuffer.length;
          // Don't add to totalBytes here - it was already counted in the previous chunk
          if (!canWrite) {
            newWriteStream.once('drain', () => {
              // Stream ready for more data
            });
          }
        }
        
        console.log(`🔄 Rotated to chunk ${newChunkIndex} for ${session.participantEmail} (overlap: ${overlapBuffer.length} bytes)`);
        resolve();
      } catch (error: any) {
        console.error(`❌ Error rotating chunk:`, error);
        resolve(); // Resolve anyway to not block
      }
    });
    
    // Close the write stream
    session.writeStream.end(() => {
      // 'finish' event will fire when upload completes
    });
    
    // Handle stream errors during close
    session.writeStream.on('error', (error: any) => {
      if ((error as any).code !== 'ERR_STREAM_WRITE_AFTER_END') {
        console.error(`❌ Error closing chunk stream:`, error);
      }
      if (!uploadCompleted && !timeoutFired) {
        // Still try to publish and rotate
        publishAudioChunkReady(
          session,
          currentChunkIndex,
          currentChunkStartTime,
          currentChunkEndTime,
          currentStorageUrl,
          false
        ).then(() => {
          // Create new chunk even if publish failed
          const newChunkIndex = currentChunkIndex + 1;
          const date = new Date();
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const dateFolder = `${year}-${month}-${day}`;
          const newStoragePath = `orgs/${session.orgSlug}/recordings/${dateFolder}/${session.callId}/${session.participantEmail}/chunk_${newChunkIndex}.wav`;
          
          const bucket = getStorageBucket();
          const newFile = bucket.file(newStoragePath);
          const newWriteStream = newFile.createWriteStream({
            resumable: true,
            timeout: 600000,
            metadata: {
              contentType: 'audio/wav',
              metadata: {
                callId: session.callId,
                participantEmail: session.participantEmail,
                chunkIndex: newChunkIndex.toString(),
                timestamp: Date.now().toString(),
              },
            },
            validation: false,
          });
          
        // Write WAV header before streaming PCM data
        const maxExpectedChunkSize = 2 * 1024 * 1024; // 2MB placeholder
        // Use session's sample rate (immutable, set at session creation)
        const wavHeader = createWavHeader(maxExpectedChunkSize, session.sampleRate);
        newWriteStream.write(wavHeader);
        
        session.writeStream = newWriteStream;
          session.file = newFile;
          session.storagePath = newStoragePath;
          session.currentChunkIndex = newChunkIndex;
          session.currentChunkStartTime = Date.now();
          session.currentChunkBytes = 0;
          
          if (overlapBuffer.length > 0) {
            newWriteStream.write(overlapBuffer);
            session.currentChunkBytes += overlapBuffer.length;
          }
          
          resolve();
        }).catch(() => resolve());
      }
    });
    
    // Timeout after 2 minutes
    setTimeout(() => {
      if (!uploadCompleted) {
        timeoutFired = true;
        console.warn(`⚠️ Timeout waiting for chunk upload, proceeding with rotation`);
        publishAudioChunkReady(
          session,
          currentChunkIndex,
          currentChunkStartTime,
          currentChunkEndTime,
          currentStorageUrl,
          false
        ).then(() => {
          // Create new chunk
          const newChunkIndex = currentChunkIndex + 1;
          const date = new Date();
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const dateFolder = `${year}-${month}-${day}`;
          const newStoragePath = `orgs/${session.orgSlug}/recordings/${dateFolder}/${session.callId}/${session.participantEmail}/chunk_${newChunkIndex}.wav`;
          
          const bucket = getStorageBucket();
          const newFile = bucket.file(newStoragePath);
          const newWriteStream = newFile.createWriteStream({
            resumable: true,
            timeout: 600000,
            metadata: {
              contentType: 'audio/wav',
              metadata: {
                callId: session.callId,
                participantEmail: session.participantEmail,
                chunkIndex: newChunkIndex.toString(),
                timestamp: Date.now().toString(),
              },
            },
            validation: false,
          });
          
        // Write WAV header before streaming PCM data
        const maxExpectedChunkSize = 2 * 1024 * 1024; // 2MB placeholder
        // Use session's sample rate (immutable, set at session creation)
        const wavHeader = createWavHeader(maxExpectedChunkSize, session.sampleRate);
        newWriteStream.write(wavHeader);
        
        session.writeStream = newWriteStream;
        session.file = newFile;
        session.storagePath = newStoragePath;
        session.currentChunkIndex = newChunkIndex;
        session.currentChunkStartTime = Date.now();
        session.currentChunkBytes = 0;
        
        if (overlapBuffer.length > 0) {
          newWriteStream.write(overlapBuffer);
          session.currentChunkBytes += overlapBuffer.length;
        }
        
        resolve();
      }).catch(() => resolve());
    }
  }, 120000); // 2 minutes
});
}

/**
 * Record an audio chunk
 * Streams directly to Cloud Storage (async, non-blocking)
 */
export async function recordChunk(
  callId: string,
  participantEmail: string,
  audioData: Buffer,
  orgSlug?: string, // Optional: if provided, will be used; otherwise looked up
  sampleRate: number = 16000 // Explicit sample rate in Hz (default: 16kHz for AssemblyAI)
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
        const creationPromise = createStreamingSession(callId, participantEmail, orgSlug, sampleRate)
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
    
    // CRITICAL: Validate sample rate matches (fail fast on mismatch)
    if (session.sampleRate !== sampleRate) {
      console.error(
        `❌ Sample rate mismatch for ${participantEmail}: ` +
        `session=${session.sampleRate}Hz, audio=${sampleRate}Hz. ` +
        `This would cause incorrect WAV header. Creating new session.`
      );
      // Close existing session and create new one with correct sample rate
      try {
        session.writeStream.destroy();
      } catch (e) {
        // Ignore errors when destroying
      }
      streamingSessions.delete(sessionKey);
      sessionCreationLocks.delete(sessionKey);
      // Recursively call to create new session with correct sample rate
      return recordChunk(callId, participantEmail, audioData, orgSlug, sampleRate);
    }
    
    // Check if stream is still writable before writing
    if (session.writeStream.destroyed || session.writeStream.writableEnded) {
      console.warn(`⚠️ Cannot write to closed stream for ${participantEmail}, skipping chunk`);
      return;
    }
    
    // Check if current chunk exceeds duration threshold and needs rotation
    // We check BEFORE writing to avoid writing to a chunk that's about to be closed
    // NOTE: Rotation is non-blocking - we don't await to allow concurrent processing
    if (session.currentChunkBytes >= CHUNK_DURATION_BYTES) {
      // Rotate to new chunk (non-blocking - don't await)
      // The write will queue if rotation is in progress, but we continue processing
      rotateChunk(sessionKey, session)
        .catch((error: any) => {
          console.error(`❌ Error rotating chunk:`, error);
          // Continue - try to write to current stream anyway
        });
      // Don't await - continue immediately to allow concurrent chunk processing
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
    session.currentChunkBytes += audioData.length;
    
    // Update overlap buffer: keep last CHUNK_OVERLAP_BYTES in memory
    // Append new data to overlap buffer, then trim to size
    const combinedBuffer = Buffer.concat([session.overlapBuffer, audioData]);
    if (combinedBuffer.length > CHUNK_OVERLAP_BYTES) {
      // Keep only the last CHUNK_OVERLAP_BYTES
      session.overlapBuffer = combinedBuffer.slice(combinedBuffer.length - CHUNK_OVERLAP_BYTES);
    } else {
      session.overlapBuffer = combinedBuffer;
    }
    
    // If stream is backpressured, wait for drain (but don't block the caller)
    if (!canWrite) {
      session.writeStream.once('drain', () => {
        // Stream is ready for more data
      });
    }
    
    // Log periodically (every ~5 seconds worth of audio at 16kHz)
    const timeElapsed = Date.now() - session.startTime;
    if (timeElapsed > 0 && session.chunkCount % 200 === 0) {
      const bytesPerSecond = (session.totalBytes / timeElapsed) * 1000;
      console.log(`🎤 Streaming audio: chunk ${session.currentChunkIndex}, ${session.chunkCount} total chunks, ${session.totalBytes} bytes (${Math.round(bytesPerSecond)} bytes/s) for ${participantEmail}`);
    }
  } catch (error: any) {
    console.error(`❌ Error recording audio chunk for ${participantEmail}:`, error);
    // Don't throw - we don't want to break the WebSocket connection
  }
}

/**
 * Close streaming session and publish final chunk
 * Waits for GCS upload to complete (up to 2 minutes) before publishing final AudioChunkReady event
 */
async function closeStreamingSession(sessionKey: string, session: StreamingSession): Promise<void> {
  return new Promise((resolve) => {
    // Check if stream is already closed
    if (session.writeStream.destroyed || session.writeStream.writableEnded) {
      console.log(`✅ Stream already closed for ${session.participantEmail}`);
      // Still publish final chunk event
      const finalStorageUrl = `gs://${getStorageBucket().name}/${session.storagePath}`;
      publishAudioChunkReady(
        session,
        session.currentChunkIndex,
        session.currentChunkStartTime,
        Date.now(),
        finalStorageUrl,
        true
      ).then(() => {
        resolve();
      }).catch((error) => {
        console.error(`❌ Error publishing final chunk event:`, error);
        resolve();
      });
      return;
    }
    
    let uploadCompleted = false;
    let timeoutFired = false;
    const finalChunkIndex = session.currentChunkIndex;
    const finalChunkStartTime = session.currentChunkStartTime;
    const finalStorageUrl = `gs://${getStorageBucket().name}/${session.storagePath}`;
    
    // Wait for the GCS upload to complete (finish event)
    session.writeStream.on('finish', () => {
      if (timeoutFired) {
        return;
      }
      uploadCompleted = true;
      console.log(`✅ GCS upload completed for final chunk ${finalChunkIndex} for ${session.participantEmail}: ${session.currentChunkBytes} bytes`);
      
      // Publish final AudioChunkReady event after upload is complete
      publishAudioChunkReady(
        session,
        finalChunkIndex,
        finalChunkStartTime,
        Date.now(),
        finalStorageUrl,
        true
      ).then(() => {
        resolve();
      }).catch((error) => {
        console.error(`❌ Error publishing final chunk event:`, error);
        resolve();
      });
    });
    
    // Close the write stream
    session.writeStream.end(() => {
      console.log(`✅ Closed streaming session for ${session.participantEmail}: chunk ${finalChunkIndex}, ${session.totalBytes} total bytes, ${session.chunkCount} total chunks`);
    });
    
    // Handle stream errors during close
    session.writeStream.on('error', (error: any) => {
      if ((error as any).code !== 'ERR_STREAM_WRITE_AFTER_END') {
        console.error(`❌ Error closing stream for ${session.participantEmail}:`, error);
      }
      
      if (!uploadCompleted && !timeoutFired) {
        publishAudioChunkReady(
          session,
          finalChunkIndex,
          finalChunkStartTime,
          Date.now(),
          finalStorageUrl,
          true
        ).then(() => resolve()).catch(() => resolve());
      }
    });
    
    // Timeout after 2 minutes - still publish final chunk event even if upload incomplete
    setTimeout(() => {
      if (!uploadCompleted) {
        timeoutFired = true;
        console.warn(`⚠️ Timeout waiting for GCS upload for final chunk ${finalChunkIndex} (2 min), publishing final chunk event anyway`);
        publishAudioChunkReady(
          session,
          finalChunkIndex,
          finalChunkStartTime,
          Date.now(),
          finalStorageUrl,
          true
        ).then(() => resolve()).catch(() => resolve());
      }
    }, 120000); // 2 minutes
  });
}

/**
 * Clean up buffers for a participant (when they disconnect)
 */
export async function cleanupParticipantBuffer(callId: string, participantEmail: string): Promise<void> {
  const sessionKey = `${callId}:${participantEmail}`;
  const session = streamingSessions.get(sessionKey);
  
  if (session) {
    // CRITICAL: Wait a short time for any in-flight chunks to finish processing
    // This ensures the last chunk (which might still be resampling) gets written
    // before we close the stream. Without this, if the user ends the call immediately
    // after speaking, the last chunk might still be in the resampling queue and will
    // fail to write to a closed stream.
    console.log(`⏳ Waiting for in-flight chunks to finish for ${participantEmail}...`);
    await new Promise(resolve => setTimeout(resolve, 200)); // 200ms grace period
    
    await closeStreamingSession(sessionKey, session);
    streamingSessions.delete(sessionKey);
    sessionCreationLocks.delete(sessionKey); // Clean up any lock
  }
  
  // Also close original audio session if it exists
  // Original audio upload removed - no longer saving original audio to GCS
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
