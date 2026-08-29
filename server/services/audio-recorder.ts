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
import { audioLogger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Byte order configuration
// LiveKit always sends PCM16 audio in little-endian format (per documentation)
// Big-endian support has been removed
// Helper function to normalize byte order value from environment variable
// Only supports little-endian (or small-endian as alias)
function normalizeByteOrder(value: string | undefined): 'little-endian' {
  if (!value) return 'little-endian';
  const normalized = value.toLowerCase().trim();
  // Support 'small-endian' as alias for 'little-endian' (small = little)
  if (normalized === 'small-endian' || normalized === 'little-endian') {
    return 'little-endian';
  }
  // Default to little-endian if unknown value
  console.warn(`⚠️ Unknown AUDIO_BYTE_ORDER value: "${value}", defaulting to 'little-endian'`);
  return 'little-endian';
}

export const AUDIO_BYTE_ORDER = normalizeByteOrder(process.env.AUDIO_BYTE_ORDER);

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
const CHUNK_OVERLAP_MS = 10000; // 10 seconds overlap (industry best practice: 5-30s for transcription)
// At 16kHz PCM (16-bit): 1 second = 16,000 samples * 2 bytes = 32,000 bytes
// 45 seconds = 1,440,000 bytes ≈ 1.4MB
// 10 seconds overlap = 320,000 bytes ≈ 320KB
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
  // CRITICAL: Write queue to ensure sequential writes
  writeQueue: Array<{ data: Buffer; resolve: () => void; reject: (error: Error) => void }>;
  writing: boolean; // Whether a write is currently in progress
  // State machine for rotation coordination
  state: 'idle' | 'writing' | 'rotating' | 'closing'; // Track current operation state
  rotationLock?: Promise<void>; // Track in-progress rotation to prevent concurrent rotations
  // Metrics tracking
  firstChunkWallTime: number; // Wall clock time of first chunk
  totalSamplesWritten: number; // For drift detection
  metrics: {
    inputBytesPerSecond: number;
    queueDepth: number;
    droppedFrames: number;
    headerPatchFailures: number;
    rotationDurations: number[];
  };
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
      // INDUSTRY BEST PRACTICE: Prevent GCS transcoding/compression
      cacheControl: 'no-transform',
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
  // Original audio saving is disabled - only resampled audio is saved
  return;
  
  // Disabled code below (kept for reference)
  /* try {
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
  } */
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
export function createWavHeader(pcmDataSize: number, sampleRate: number = 16000): Buffer {
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
      // INDUSTRY BEST PRACTICE: Prevent GCS transcoding/compression
      // cacheControl: 'no-transform' prevents intermediaries from modifying content
      // This ensures audio files are stored and served without modification
      cacheControl: 'no-transform',
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
      writeQueue: [], // Initialize write queue
      writing: false, // No write in progress initially
      state: 'idle', // Initialize state machine
      rotationLock: undefined, // No rotation in progress initially
      firstChunkWallTime: now,
      totalSamplesWritten: 0,
      metrics: {
        inputBytesPerSecond: 0,
        queueDepth: 0,
        droppedFrames: 0,
        headerPatchFailures: 0,
        rotationDurations: [],
      },
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
            false, // Not final, just intermediate chunk
            CHUNK_OVERLAP_MS, // overlapStartMs
            0                  // overlapEndMs
          );
          console.log(`✅ Published chunk ${session.currentChunkIndex} after 408 timeout recovery`);
        } catch (pubError: any) {
          console.error(`❌ Failed to publish chunk after 408 timeout:`, pubError);
        }
        
        // Remove broken session so new chunks can create a fresh one
        // Reset state before deleting (in case session is referenced elsewhere)
        session.state = 'idle';
        session.rotationLock = undefined;
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
  isFinal: boolean = false,
  overlapStartMs?: number,
  overlapEndMs?: number
): Promise<void> {
  try {
    const topic = await getAudioChunksTopic();
    
    // Calculate sample count from PCM data
    // Sample rate verification is handled by:
    // 1. Pre-save check in recordChunk (detects 48kHz audio when 16kHz expected)
    // 2. PCM data analysis in rotateChunk/closeStreamingSession (detects 48kHz PCM when header says 16kHz)
    // Wall clock duration is unreliable (can vary due to pauses, buffering, network delays)
    const actualSamples = session.currentChunkBytes / 2; // 16-bit = 2 bytes per sample
    
    // Use session sample rate directly - it's verified by the checks above
    const verifiedSampleRate = session.sampleRate;
    
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
      // Overlap metadata for transcription dedupe
      overlapStartMs: overlapStartMs ?? CHUNK_OVERLAP_MS,
      overlapEndMs: overlapEndMs ?? 0,
      sampleCount: actualSamples,
      sampleRate: verifiedSampleRate,
    };
    
    const messageId = await topic.publishMessage({ json: message });
    console.log(`📤 Published AudioChunkReady event: ${messageId} (chunk ${chunkIndex}, ${chunkEndTime - chunkStartTime}ms, ${isFinal ? 'final' : 'intermediate'}, ${verifiedSampleRate}Hz)`);
  } catch (error: any) {
    console.error(`❌ Error publishing AudioChunkReady event for chunk ${chunkIndex}:`, error);
  }
}

/**
 * Rotate to a new chunk file
 * Closes current chunk, publishes AudioChunkReady, and starts new chunk with overlap
 * Implements hybrid approach: state machine + queue draining + promise coordination
 */
async function rotateChunk(sessionKey: string, session: StreamingSession): Promise<void> {
  // Prevent concurrent rotations - return existing lock if rotation in progress
  if (session.state === 'rotating' && session.rotationLock) {
    audioLogger.info({
      event: 'rotation_already_in_progress',
      participantEmail: session.participantEmail,
      callId: session.callId,
      currentChunkIndex: session.currentChunkIndex,
    }, `Rotation already in progress for ${session.participantEmail}, awaiting existing rotation`);
    return session.rotationLock;
  }
  
  // Set state to rotating and create rotation lock
  session.state = 'rotating';
  const rotationStartTime = Date.now();
  
  session.rotationLock = (async (): Promise<void> => {
    try {
      audioLogger.info({
        event: 'rotation_started',
        participantEmail: session.participantEmail,
        callId: session.callId,
        currentChunkIndex: session.currentChunkIndex,
        queueLength: session.writeQueue.length,
        writing: session.writing,
      }, `Starting rotation for chunk ${session.currentChunkIndex} (queue: ${session.writeQueue.length} items, writing: ${session.writing})`);
      
      const currentChunkIndex = session.currentChunkIndex;
      const currentChunkStartTime = session.currentChunkStartTime;
      const currentChunkEndTime = Date.now();
      const currentStoragePath = session.storagePath;
      const currentStorageUrl = `gs://${getStorageBucket().name}/${currentStoragePath}`;
      
      // Use overlap buffer from session (maintained in memory as we write)
      const overlapBuffer = session.overlapBuffer.length > 0 
        ? Buffer.from(session.overlapBuffer) 
        : Buffer.alloc(0);
      
      // Step 1: Wait for in-progress write to complete
      const writeWaitStart = Date.now();
      while (session.writing) {
        await new Promise(resolve => setImmediate(resolve));
        // Safety check: don't wait forever
        if (Date.now() - writeWaitStart > 5000) {
          audioLogger.warn({
            event: 'rotation_write_wait_timeout',
            participantEmail: session.participantEmail,
            callId: session.callId,
            waitDuration: Date.now() - writeWaitStart,
          }, `Timeout waiting for write to complete during rotation`);
          break;
        }
      }
      
      // Step 2: Drain write queue before closing stream
      const queueDrainStart = Date.now();
      const queuedItems = [...session.writeQueue];
      session.writeQueue = [];
      
      audioLogger.info({
        event: 'rotation_queue_drain_start',
        participantEmail: session.participantEmail,
        callId: session.callId,
        queuedItemsCount: queuedItems.length,
      }, `Draining ${queuedItems.length} queued writes before closing stream`);
      
      // Write each queued item sequentially to current stream
      for (let i = 0; i < queuedItems.length; i++) {
        const item = queuedItems[i];
        await new Promise<void>((resolve) => {
          // Check if stream is still writable
          if (session.writeStream.destroyed || session.writeStream.writableEnded) {
            audioLogger.warn({
              event: 'rotation_queue_drain_stream_closed',
              participantEmail: session.participantEmail,
              callId: session.callId,
              itemIndex: i,
              totalItems: queuedItems.length,
            }, `Stream closed during queue drain, rejecting remaining ${queuedItems.length - i} items`);
            item.reject(new Error('Stream closed during rotation'));
            resolve();
            return;
          }
          
          const canWrite = session.writeStream.write(item.data, (error?: Error | null) => {
            if (error) {
              audioLogger.error({
                event: 'rotation_queue_drain_write_error',
                participantEmail: session.participantEmail,
                callId: session.callId,
                itemIndex: i,
                error: error.message,
              }, `Error writing queued item ${i} during rotation`);
              item.reject(error);
            } else {
              item.resolve();
            }
            resolve();
          });
          
          if (!canWrite) {
            // Handle backpressure
            session.writeStream.once('drain', () => {
              // Continue with next item
            });
          }
        });
      }
      
      const queueDrainDuration = Date.now() - queueDrainStart;
      audioLogger.info({
        event: 'rotation_queue_drain_complete',
        participantEmail: session.participantEmail,
        callId: session.callId,
        itemsDrained: queuedItems.length,
        duration: queueDrainDuration,
      }, `Queue drain complete: ${queuedItems.length} items in ${queueDrainDuration}ms`);
      
      // Step 3: Now safe to close the stream
      return new Promise<void>((resolve, reject) => {
        let uploadCompleted = false;
        let timeoutFired = false;
        const rotationTimeout = 30000; // 30 seconds timeout
    
        session.writeStream.on('finish', async () => {
          if (timeoutFired) return;
          uploadCompleted = true;
          
          try {
            // CRITICAL: Update WAV header with actual file size and verify sample rate
            try {
              const actualPcmSize = session.currentChunkBytes;
              const actualFileSize = 44 + actualPcmSize; // 44 bytes for WAV header + PCM data
              
              // Download the file, update header, and re-upload
              const [fileBuffer] = await session.file.download();
              
              // Verify file size matches
              const expectedTotalSize = 44 + actualPcmSize;
              if (fileBuffer.length !== expectedTotalSize) {
                console.error(`❌ CRITICAL: Downloaded file size mismatch for chunk ${currentChunkIndex}!`);
                console.error(`   Expected: ${expectedTotalSize} bytes (44 header + ${actualPcmSize} PCM)`);
                console.error(`   Actual: ${fileBuffer.length} bytes`);
              }
              
              // Verify WAV header is valid
              const riffId = fileBuffer.toString('ascii', 0, 4);
              const waveId = fileBuffer.toString('ascii', 8, 12);
              if (riffId !== 'RIFF' || waveId !== 'WAVE') {
                console.error(`❌ CRITICAL: Invalid WAV header for chunk ${currentChunkIndex}! RIFF=${riffId}, WAVE=${waveId}`);
                throw new Error('Invalid WAV header structure');
              }
              
              // CRITICAL: Verify sample rate in header matches session sample rate
              const currentSampleRate = fileBuffer.readUInt32LE(24);
              if (currentSampleRate !== session.sampleRate) {
                console.error(`❌ CRITICAL: Sample rate mismatch in header for chunk ${currentChunkIndex}!`);
                console.error(`   Expected: ${session.sampleRate} Hz, Found: ${currentSampleRate} Hz`);
                console.error(`   This will cause "slow and deep" or "fast and high" sound when played!`);
                // Fix it
                fileBuffer.writeUInt32LE(session.sampleRate, 24);
                const byteRate = session.sampleRate * 1 * 2; // sampleRate * channels * bytesPerSample
                fileBuffer.writeUInt32LE(byteRate, 28);
                console.log(`   ✅ Fixed sample rate to ${session.sampleRate} Hz in header`);
              }
              
              // CRITICAL: Verify actual PCM data matches header sample rate
              // Assumes original input is always 48kHz from LiveKit
              // If header says 16kHz but audio data size suggests 48kHz, fix the header
              const pcmDataStart = 44; // WAV header is 44 bytes
              const pcmDataSize = fileBuffer.length - pcmDataStart;
              const pcmSamples = pcmDataSize / 2; // 16-bit = 2 bytes per sample
              
              // Calculate expected size for 16kHz vs 48kHz based on actual sample count
              // If we have X samples and header says 16kHz, duration = X/16000 seconds
              // If audio is actually 48kHz, duration = X/48000 seconds (3x shorter)
              // We can't directly measure duration, but we can check if the data pattern suggests 48kHz
              
              // Method: Check if audio data size suggests 48kHz when header says 16kHz
              // For a typical chunk, if header says 16kHz but we have ~3x more samples than expected
              // for the wall clock duration, it's likely 48kHz audio
              
              // More reliable: Check if the PCM data has characteristics of 48kHz audio
              // 48kHz audio will have higher frequency content than properly resampled 16kHz
              if (currentSampleRate === 16000 && pcmDataSize >= 2000) {
                // Analyze a sample of the PCM data to detect if it's actually 48kHz
                const sampleSize = Math.min(5000, pcmSamples); // Analyze first 5000 samples
                let zeroCrossings = 0;
                let highFreqVariation = 0;
                let prevSample = 0;
                
                for (let i = 1; i < sampleSize; i++) {
                  const offset = pcmDataStart + (i * 2);
                  if (offset + 1 >= fileBuffer.length) break;
                  
                  const sample1 = fileBuffer.readInt16LE(offset - 2);
                  const sample2 = fileBuffer.readInt16LE(offset);
                  
                  // Zero crossing detection
                  if ((prevSample >= 0 && sample2 < 0) || (prevSample < 0 && sample2 >= 0)) {
                    zeroCrossings++;
                  }
                  
                  // High frequency variation (difference between consecutive samples)
                  const diff = Math.abs(sample2 - sample1);
                  highFreqVariation += diff;
                  
                  prevSample = sample2;
                }
                
                const zcr = zeroCrossings / sampleSize;
                const avgVariation = highFreqVariation / sampleSize;
                
                // 48kHz audio typically has higher zero-crossing rate and variation
                // Properly resampled 16kHz audio should have lower values
                // Thresholds: ZCR > 0.12 and avgVariation > 500 suggests 48kHz
                if (zcr > 0.12 && avgVariation > 500) {
                  console.error(`❌ CRITICAL: PCM data analysis suggests 48kHz audio but header says 16kHz for chunk ${currentChunkIndex}!`);
                  console.error(`   ZCR: ${zcr.toFixed(3)} (typical 48kHz: >0.12, 16kHz: <0.10)`);
                  console.error(`   Avg variation: ${avgVariation.toFixed(0)} (typical 48kHz: >500, 16kHz: <300)`);
                  console.error(`   This will cause "slow and deep" sound (monster tone) when played!`);
                  console.error(`   Resampling may have failed or wrong audio was saved.`);
                  console.error(`   Fixing header to 48kHz to match actual audio data...`);
                  
                  // Fix header to match actual audio (48kHz)
                  fileBuffer.writeUInt32LE(48000, 24);
                  const byteRate = 48000 * 1 * 2; // 48kHz * channels * bytesPerSample
                  fileBuffer.writeUInt32LE(byteRate, 28);
                  
                  // Update session sample rate for future chunks
                  session.sampleRate = 48000;
                  
                  audioLogger.error({
                    event: 'wav_header_corrected_to_48khz',
                    participantEmail: session.participantEmail,
                    callId: session.callId,
                    chunkIndex: currentChunkIndex,
                    originalHeaderRate: 16000,
                    correctedRate: 48000,
                    pcmDataSize,
                    pcmSamples,
                    zcr: zcr.toFixed(3),
                    avgVariation: avgVariation.toFixed(0),
                    message: 'CRITICAL: Fixed WAV header from 16kHz to 48kHz - PCM data is actually 48kHz (resampling may have failed)',
                  }, `Fixed WAV header: 16kHz → 48kHz (PCM analysis: ZCR=${zcr.toFixed(3)}, variation=${avgVariation.toFixed(0)})`);
                } else {
                  // PCM data appears to be correctly 16kHz
                  if (currentChunkIndex === 0) {
                    audioLogger.debug({
                      event: 'pcm_data_verified_16khz',
                      participantEmail: session.participantEmail,
                      callId: session.callId,
                      chunkIndex: currentChunkIndex,
                      zcr: zcr.toFixed(3),
                      avgVariation: avgVariation.toFixed(0),
                      message: 'PCM data verified as 16kHz (matches header)',
                    }, `✓ PCM data verified as 16kHz: ZCR=${zcr.toFixed(3)}, variation=${avgVariation.toFixed(0)}`);
                  }
                }
              }
              
              // Update RIFF chunk size (bytes 4-7)
              fileBuffer.writeUInt32LE(actualFileSize, 4);
              
              // Update data chunk size (bytes 40-43)
              fileBuffer.writeUInt32LE(actualPcmSize, 40);
              
              // VERIFY: Check PCM data integrity (sample first 20 samples)
              // pcmDataStart is already declared above (line 1237)
              if (fileBuffer.length >= pcmDataStart + 40) {
                const verificationSamples: number[] = [];
                let maxSample = 0;
                let invalidSamples = 0;
                
                for (let i = 0; i < 20 && (pcmDataStart + i * 2 + 1) < fileBuffer.length; i++) {
                  const offset = pcmDataStart + (i * 2);
                  const sampleLE = fileBuffer.readInt16LE(offset);
                  const sampleBE = fileBuffer.readInt16BE(offset);
                  verificationSamples.push(sampleLE);
                  
                  // Check valid range
                  if (sampleLE < -32768 || sampleLE > 32767) {
                    invalidSamples++;
                  }
                  
                  maxSample = Math.max(maxSample, Math.abs(sampleLE));
                }
                
                if (invalidSamples > 0) {
                  console.error(`❌ CRITICAL: ${invalidSamples} invalid PCM samples detected in chunk ${currentChunkIndex}!`);
                  console.error(`   First 20 samples: [${verificationSamples.join(', ')}]`);
                }
                
                // Log verification (only for first chunk or if issues detected)
                if (currentChunkIndex === 0 || invalidSamples > 0) {
                  audioLogger.info({
                    event: 'wav_pcm_data_verification',
                    participantEmail: session.participantEmail,
                    callId: session.callId,
                    chunkIndex: currentChunkIndex,
                    firstSamples: verificationSamples,
                    maxSample,
                    invalidSamples,
                    message: 'PCM data verification after WAV header update',
                  }, `🔍 PCM data verification (chunk ${currentChunkIndex}): First 20 samples: [${verificationSamples.join(', ')}], Max: ${maxSample}, Invalid: ${invalidSamples}`);
                }
              }
              
              // Re-upload with corrected header
              await session.file.save(fileBuffer, {
                metadata: {
                  contentType: 'audio/wav',
                  metadata: session.file.metadata?.metadata || {},
                },
              });
              
              console.log(`✅ Updated WAV header for chunk ${currentChunkIndex}: ${actualPcmSize} bytes PCM data, sample rate: ${session.sampleRate}Hz`);
            } catch (error: any) {
              session.metrics.headerPatchFailures++;
              console.warn(`⚠️ Failed to update WAV header for chunk ${currentChunkIndex}:`, error.message);
              // Don't fail - the file is still usable, just with incorrect header size
            }
            
            // Publish AudioChunkReady event for completed chunk
            await publishAudioChunkReady(
              session,
              currentChunkIndex,
              currentChunkStartTime,
              currentChunkEndTime,
              currentStorageUrl,
              false,
              CHUNK_OVERLAP_MS, // overlapStartMs
              0                  // overlapEndMs
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
                    false,
                    CHUNK_OVERLAP_MS, // overlapStartMs
                    0                  // overlapEndMs
                  );
                  console.log(`✅ Published chunk ${currentChunkIndex} after rotation failure recovery`);
                } catch (pubError) {
                  console.error(`❌ Failed to publish chunk after rotation error:`, pubError);
                }
                
                // Remove session so new chunks can create a fresh one
                const sessionKey = `${session.callId}:${session.participantEmail}`;
                streamingSessions.delete(sessionKey);
                sessionCreationLocks.delete(sessionKey);
                
                // Reset state
                session.state = 'idle';
                session.rotationLock = undefined;
                
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
            // Byte order is always little-endian (LiveKit always sends LE)
            // Initialize write queue for new stream if not already initialized
            if (!session.writeQueue) {
              session.writeQueue = [];
              session.writing = false;
            }
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
            
            const rotationDuration = Date.now() - rotationStartTime;
            session.metrics.rotationDurations.push(rotationDuration);
            // Keep only last 10 rotations
            if (session.metrics.rotationDurations.length > 10) {
              session.metrics.rotationDurations.shift();
            }
            audioLogger.info({
              event: 'rotation_complete',
              participantEmail: session.participantEmail,
              callId: session.callId,
              oldChunkIndex: currentChunkIndex,
              newChunkIndex,
              duration: rotationDuration,
            }, `Rotation complete: chunk ${currentChunkIndex} -> ${newChunkIndex} in ${rotationDuration}ms`);
            
            // Reset state to idle
            session.state = 'idle';
            resolve();
          } catch (error: any) {
            audioLogger.error({
              event: 'rotation_error',
              participantEmail: session.participantEmail,
              callId: session.callId,
              currentChunkIndex,
              error: error.message,
            }, `Error during rotation: ${error.message}`);
            // Reset state even on error
            session.state = 'idle';
            reject(error);
          }
        });
        
        // Close the write stream (after queue is drained)
        session.writeStream.end(() => {
          // 'finish' event will fire when upload completes
        });
        
        // Handle stream errors during close
        session.writeStream.on('error', (error: any) => {
          if ((error as any).code !== 'ERR_STREAM_WRITE_AFTER_END') {
            audioLogger.error({
              event: 'rotation_stream_error',
              participantEmail: session.participantEmail,
              callId: session.callId,
              currentChunkIndex,
              error: error.message,
            }, `Error closing chunk stream: ${error.message}`);
          }
          if (!uploadCompleted && !timeoutFired) {
            // Still try to publish and rotate
            publishAudioChunkReady(
              session,
              currentChunkIndex,
              currentChunkStartTime,
              currentChunkEndTime,
              currentStorageUrl,
              false,
              CHUNK_OVERLAP_MS, // overlapStartMs
              0                  // overlapEndMs
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
              // Initialize write queue for new stream if not already initialized
              if (!session.writeQueue) {
                session.writeQueue = [];
                session.writing = false;
              }
              
              if (overlapBuffer.length > 0) {
                newWriteStream.write(overlapBuffer);
                session.currentChunkBytes += overlapBuffer.length;
              }
              
              session.state = 'idle';
              resolve();
            }).catch(() => {
              session.state = 'idle';
              resolve();
            });
          }
        });
        
        // Timeout protection (30 seconds)
        setTimeout(() => {
          if (!uploadCompleted) {
            timeoutFired = true;
            const rotationDuration = Date.now() - rotationStartTime;
            audioLogger.warn({
              event: 'rotation_timeout',
              participantEmail: session.participantEmail,
              callId: session.callId,
              currentChunkIndex,
              duration: rotationDuration,
            }, `Rotation timeout after ${rotationDuration}ms, proceeding with new chunk creation`);
            
            publishAudioChunkReady(
              session,
              currentChunkIndex,
              currentChunkStartTime,
              currentChunkEndTime,
              currentStorageUrl,
              false,
              CHUNK_OVERLAP_MS, // overlapStartMs
              0                  // overlapEndMs
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
            // Initialize write queue for new stream if not already initialized
            if (!session.writeQueue) {
              session.writeQueue = [];
              session.writing = false;
            }
            
            if (overlapBuffer.length > 0) {
              newWriteStream.write(overlapBuffer);
              session.currentChunkBytes += overlapBuffer.length;
            }
            
            session.state = 'idle';
            resolve();
          }).catch(() => {
            session.state = 'idle';
            resolve();
          });
        }
      }, rotationTimeout);
      });
    } catch (error: any) {
      audioLogger.error({
        event: 'rotation_fatal_error',
        participantEmail: session.participantEmail,
        callId: session.callId,
        error: error.message,
      }, `Fatal error during rotation: ${error.message}`);
      // Always reset state on error
      session.state = 'idle';
      session.rotationLock = undefined;
      throw error;
    } finally {
      // Clear rotation lock when done
      session.rotationLock = undefined;
    }
  })();
  
  return session.rotationLock;
}

/**
 * Validate audio pattern to determine if samples represent valid audio data
 * Checks for typical audio characteristics: non-zero samples, variation, reasonable range
 */
function hasValidAudioPattern(samples: number[]): boolean {
  // Check for typical audio characteristics:
  // - Not all zeros
  // - Not all maxed out
  // - Has variation (not constant)
  // - Most samples in reasonable range
  const nonZero = samples.filter(s => s !== 0).length;
  const variation = Math.max(...samples) - Math.min(...samples);
  const avgAbs = samples.reduce((a, b) => a + Math.abs(b), 0) / samples.length;
  
  return nonZero > samples.length * 0.1 && // At least 10% non-zero
         variation > 100 && // Has variation
         avgAbs > 10 && avgAbs < 20000; // Reasonable average
}

/**
 * Process write queue sequentially to ensure chunks are written in order
 * Respects rotation state - does not process queue during rotation
 */
function processWriteQueue(session: StreamingSession): void {
  // Don't process queue if rotation is in progress (queue will be drained by rotation)
  if (session.state === 'rotating') {
    return;
  }
  
  if (session.writing || !session.writeQueue || session.writeQueue.length === 0) {
    return; // Already processing or no queue
  }
  
  if (session.writeStream.destroyed || session.writeStream.writableEnded) {
    // Reject all pending writes
    while (session.writeQueue.length > 0) {
      const item = session.writeQueue.shift()!;
      item.reject(new Error('Stream closed'));
    }
    return;
  }
  
  // Set state to writing
  session.state = 'writing';
  session.writing = true;
  const item = session.writeQueue.shift()!;
  
  // LiveKit always sends PCM16 audio in little-endian format
  // Data passed to recordChunk is already in the correct format - no modification needed
  const dataToWrite = item.data;
  
  // VERIFY: Check PCM data integrity before writing (sample first 10 samples, log periodically)
  // This helps catch corruption early, before it's written to GCS
  if (session.chunkCount % 100 === 0 && dataToWrite.length >= 20) {
    const verificationSamples: number[] = [];
    let maxSample = 0;
    let invalidSamples = 0;
    
    for (let i = 0; i < 10 && (i * 2 + 1) < dataToWrite.length; i++) {
      const offset = i * 2;
      const sampleLE = dataToWrite.readInt16LE(offset);
      const sampleBE = dataToWrite.readInt16BE(offset);
      verificationSamples.push(sampleLE);
      
      // Check valid range
      if (sampleLE < -32768 || sampleLE > 32767) {
        invalidSamples++;
      }
      
      maxSample = Math.max(maxSample, Math.abs(sampleLE));
    }
    
    if (invalidSamples > 0) {
      audioLogger.error({
        event: 'pcm_data_corruption_detected',
        participantEmail: session.participantEmail,
        callId: session.callId,
        chunkIndex: session.currentChunkIndex,
        chunkCount: session.chunkCount,
        firstSamples: verificationSamples,
        maxSample,
        invalidSamples,
        dataSize: dataToWrite.length,
        message: 'CRITICAL: Invalid PCM samples detected before writing to WAV file!',
      }, `❌ CRITICAL: ${invalidSamples} invalid PCM samples detected before writing (chunk ${session.currentChunkIndex}, chunkCount ${session.chunkCount})! First 10 samples: [${verificationSamples.join(', ')}]`);
    } else {
      // Log verification periodically (every 100 chunks)
      audioLogger.debug({
        event: 'pcm_data_verification_before_write',
        participantEmail: session.participantEmail,
        callId: session.callId,
        chunkIndex: session.currentChunkIndex,
        chunkCount: session.chunkCount,
        firstSamples: verificationSamples,
        maxSample,
        dataSize: dataToWrite.length,
        message: 'PCM data verification before writing to WAV file',
      }, `🔍 PCM data verification before write (chunk ${session.currentChunkIndex}): First 10 samples: [${verificationSamples.join(', ')}], Max: ${maxSample}`);
    }
  }
  
  const canWrite = session.writeStream.write(dataToWrite, (error?: Error | null) => {
    session.writing = false;
    
    if (error) {
      // Handle write-after-end errors gracefully
      if ((error as any).code === 'ERR_STREAM_WRITE_AFTER_END') {
        console.warn(`⚠️ Stream already closed for ${session.participantEmail}, removing session`);
        item.reject(error);
        // Reject remaining items
        while (session.writeQueue.length > 0) {
          const remaining = session.writeQueue.shift()!;
          remaining.reject(new Error('Stream closed'));
        }
        // Reset state on error
        session.state = 'idle';
        return;
      }
      
      const isRetryable = (error as any).code === 'ECONNRESET' || 
                         (error as any).code === 'ETIMEDOUT' || 
                         (error as any).code === 'EPIPE';
      if (!isRetryable) {
        console.error(`❌ Error writing chunk for ${session.participantEmail}:`, error);
      }
      item.reject(error);
      // Reset state on error
      session.state = 'idle';
    } else {
      item.resolve();
      // Reset state to idle when write completes successfully
      session.state = 'idle';
    }
    
    // Process next item in queue
    processWriteQueue(session);
  });
  
  if (!canWrite) {
    // Stream is backpressured, wait for drain
    session.writeStream.once('drain', () => {
      processWriteQueue(session);
    });
  }
}

/**
 * Record an audio chunk
 * Streams directly to Cloud Storage (now with sequential write queue)
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
      // Reset state before removing
      session.state = 'idle';
      session.rotationLock = undefined;
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
            newSession.state = 'idle';
            newSession.rotationLock = undefined;
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
        // Log this to structured logger as well
        audioLogger.error({
          event: 'sample_rate_mismatch',
          participantEmail,
          callId,
          sessionSampleRate: session.sampleRate,
          audioSampleRate: sampleRate,
          audioSize: audioData.length,
        }, `Sample rate mismatch: session=${session.sampleRate}Hz, audio=${sampleRate}Hz. Creating new session.`);
        // Close existing session and create new one with correct sample rate
        // Reset state before destroying
        session.state = 'idle';
        session.rotationLock = undefined;
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
      
      // CRITICAL: Verify audio data size matches expected sample rate
      // This catches cases where 48kHz audio is accidentally saved with 16kHz header
      // Assumes original input is always 48kHz from LiveKit, so if sampleRate is 16kHz,
      // the audio should be ~1/3 the size of 48kHz input
      if (audioData.length >= 20) {
        // For a typical 20ms chunk at 16kHz: 16000 * 0.02 * 2 = 640 bytes
        // For a typical 20ms chunk at 48kHz: 48000 * 0.02 * 2 = 1920 bytes
        const expected16kHz = 16000 * 0.02 * 2; // 640 bytes for 20ms @ 16kHz
        const expected48kHz = 48000 * 0.02 * 2; // 1920 bytes for 20ms @ 48kHz
        const sizeDiff16kHz = Math.abs(audioData.length - expected16kHz);
        const sizeDiff48kHz = Math.abs(audioData.length - expected48kHz);
        
        // Check if audio size suggests different sample rate than metadata
        if (sampleRate === 16000 && sizeDiff48kHz < sizeDiff16kHz) {
          // Audio size suggests 48kHz but header says 16kHz!
          console.error(`❌ CRITICAL: Audio data size suggests 48kHz but sampleRate parameter says 16kHz!`);
          console.error(`   Audio size: ${audioData.length} bytes`);
          console.error(`   Expected 16kHz (20ms): ${expected16kHz} bytes (diff: ${sizeDiff16kHz})`);
          console.error(`   Expected 48kHz (20ms): ${expected48kHz} bytes (diff: ${sizeDiff48kHz})`);
          console.error(`   This means 48kHz audio is being saved with 16kHz header - will cause monster tone!`);
          console.error(`   The resampled 16kHz audio should have been passed, not the original 48kHz audio!`);
          console.error(`   This indicates resampling may have failed or wrong audio was passed to recordChunk!`);
          
          audioLogger.error({
            event: 'wrong_audio_saved_48khz_instead_of_16khz',
            participantEmail,
            callId,
            audioSize: audioData.length,
            sampleRate,
            expected16kHz,
            expected48kHz,
            sizeDiff16kHz,
            sizeDiff48kHz,
            message: 'CRITICAL: 48kHz audio is being saved with 16kHz header - resampling may have failed or wrong audio passed',
          }, `Wrong audio saved: 48kHz audio (${audioData.length} bytes) with 16kHz header! Resampling may have failed.`);
          
          // Don't save - this would create incorrect metadata
          throw new Error(`Cannot save 48kHz audio (${audioData.length} bytes) with 16kHz header - resampling may have failed. Expected ~${expected16kHz} bytes for 16kHz audio.`);
        } else if (sampleRate === 48000 && sizeDiff16kHz < sizeDiff48kHz) {
          // Audio size suggests 16kHz but header says 48kHz (less common but possible)
          console.warn(`⚠️ Audio data size suggests 16kHz but sampleRate parameter says 48kHz!`);
          console.warn(`   Audio size: ${audioData.length} bytes`);
          console.warn(`   Expected 16kHz (20ms): ${expected16kHz} bytes (diff: ${sizeDiff16kHz})`);
          console.warn(`   Expected 48kHz (20ms): ${expected48kHz} bytes (diff: ${sizeDiff48kHz})`);
          console.warn(`   This might indicate 16kHz audio is being saved with 48kHz header.`);
          
          audioLogger.warn({
            event: 'audio_size_mismatch_16khz_with_48khz_header',
            participantEmail,
            callId,
            audioSize: audioData.length,
            sampleRate,
            expected16kHz,
            expected48kHz,
            sizeDiff16kHz,
            sizeDiff48kHz,
            message: 'Audio size suggests 16kHz but header says 48kHz',
          }, `Audio size mismatch: ${audioData.length} bytes suggests 16kHz but header says 48kHz`);
        } else {
          // Metadata matches - log verification success for first chunk
          if (session.chunkCount === 0) {
            audioLogger.debug({
              event: 'first_chunk_sample_rate_verified',
              participantEmail,
              callId,
              sampleRate: session.sampleRate,
              audioSize: audioData.length,
              message: 'First chunk sample rate metadata verified',
            }, `✓ First chunk sample rate verified: ${session.sampleRate}Hz, size: ${audioData.length} bytes`);
          }
        }
      }
    
    // Check if stream is still writable before writing
    if (session.writeStream.destroyed || session.writeStream.writableEnded) {
      console.warn(`⚠️ Cannot write to closed stream for ${participantEmail}, skipping chunk`);
      return;
    }
    
    // Check if current chunk exceeds duration threshold and needs rotation
    // CRITICAL: Await rotation to ensure new stream is ready before queuing writes
    // This prevents race condition where writes queue to closed stream
    if (session.currentChunkBytes >= CHUNK_DURATION_BYTES) {
      // Check if rotation is already in progress
      if (session.state === 'rotating' && session.rotationLock) {
        // Wait for existing rotation to complete
        audioLogger.info({
          event: 'awaiting_existing_rotation',
          participantEmail,
          callId: session.callId,
          currentChunkIndex: session.currentChunkIndex,
        }, `Rotation already in progress, awaiting completion before queuing write`);
        try {
          await session.rotationLock;
        } catch (error: any) {
          audioLogger.error({
            event: 'rotation_wait_error',
            participantEmail,
            callId: session.callId,
            error: error.message,
          }, `Error waiting for rotation: ${error.message}`);
          // Remove broken session - next chunk will create fresh one
          streamingSessions.delete(sessionKey);
          sessionCreationLocks.delete(sessionKey);
          return;
        }
      } else if (session.state !== 'rotating') {
        // Start rotation and await it
        try {
          await rotateChunk(sessionKey, session);
        } catch (error: any) {
          audioLogger.error({
            event: 'rotation_error',
            participantEmail,
            callId: session.callId,
            error: error.message,
          }, `Error rotating chunk: ${error.message}`);
          // Remove broken session - next chunk will create fresh one
          streamingSessions.delete(sessionKey);
          sessionCreationLocks.delete(sessionKey);
          return;
        }
      }
    }
    
    // CRITICAL: Queue writes to ensure sequential writing (prevents interleaving)
    if (!session.writeQueue) {
      session.writeQueue = [];
      session.writing = false;
    }
    
    // Add to write queue and wait for it to be written
    await new Promise<void>((resolve, reject) => {
      session.writeQueue!.push({ data: audioData, resolve, reject });
      processWriteQueue(session);
    });
    
    // Update session stats (after successful write)
    session.totalBytes += audioData.length;
    session.chunkCount++;
    session.currentChunkBytes += audioData.length;
    session.totalSamplesWritten += audioData.length / 2; // 16-bit = 2 bytes per sample
    
    // Update overlap buffer: keep last CHUNK_OVERLAP_BYTES in memory
    // Append new data to overlap buffer, then trim to size
    const combinedBuffer = Buffer.concat([session.overlapBuffer, audioData]);
    if (combinedBuffer.length > CHUNK_OVERLAP_BYTES) {
      // Keep only the last CHUNK_OVERLAP_BYTES
      session.overlapBuffer = combinedBuffer.slice(combinedBuffer.length - CHUNK_OVERLAP_BYTES);
    } else {
      session.overlapBuffer = combinedBuffer;
    }
    
    // Log periodically (every ~5 seconds worth of audio at 16kHz)
    const timeElapsed = Date.now() - session.startTime;
    if (timeElapsed > 0 && session.chunkCount % 200 === 0) {
      const bytesPerSecond = (session.totalBytes / timeElapsed) * 1000;
      session.metrics.inputBytesPerSecond = bytesPerSecond;
      session.metrics.queueDepth = session.writeQueue.length;
      
      audioLogger.info({
        event: 'session_metrics',
        participantEmail: session.participantEmail,
        callId: session.callId,
        chunkIndex: session.currentChunkIndex,
        ...session.metrics,
      }, `Session metrics: ${Math.round(session.metrics.inputBytesPerSecond)} bytes/s, queue: ${session.metrics.queueDepth}`);
      
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
        true,
        0, // No overlap at start of final chunk
        0  // No overlap at end
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
    session.writeStream.on('finish', async () => {
      if (timeoutFired) {
        return;
      }
      uploadCompleted = true;
      console.log(`✅ GCS upload completed for final chunk ${finalChunkIndex} for ${session.participantEmail}: ${session.currentChunkBytes} bytes`);
      
      // CRITICAL: Update WAV header with actual file size and verify sample rate
      try {
        const actualPcmSize = session.currentChunkBytes;
        const actualFileSize = 44 + actualPcmSize; // 44 bytes for WAV header + PCM data
        
        // Download the file, update header, and re-upload
        const [fileBuffer] = await session.file.download();
        
        // Verify file size matches
        const expectedTotalSize = 44 + actualPcmSize;
        if (fileBuffer.length !== expectedTotalSize) {
          console.error(`❌ CRITICAL: Downloaded file size mismatch for chunk ${finalChunkIndex}!`);
          console.error(`   Expected: ${expectedTotalSize} bytes (44 header + ${actualPcmSize} PCM)`);
          console.error(`   Actual: ${fileBuffer.length} bytes`);
        }
        
        // Verify WAV header is valid
        const riffId = fileBuffer.toString('ascii', 0, 4);
        const waveId = fileBuffer.toString('ascii', 8, 12);
        if (riffId !== 'RIFF' || waveId !== 'WAVE') {
          console.error(`❌ CRITICAL: Invalid WAV header for chunk ${finalChunkIndex}! RIFF=${riffId}, WAVE=${waveId}`);
          throw new Error('Invalid WAV header structure');
        }
        
        // CRITICAL: Verify sample rate in header matches session sample rate
        const currentSampleRate = fileBuffer.readUInt32LE(24);
        if (currentSampleRate !== session.sampleRate) {
          console.error(`❌ CRITICAL: Sample rate mismatch in header for chunk ${finalChunkIndex}!`);
          console.error(`   Expected: ${session.sampleRate} Hz, Found: ${currentSampleRate} Hz`);
          console.error(`   This will cause "slow and deep" or "fast and high" sound when played!`);
          // Fix it
          fileBuffer.writeUInt32LE(session.sampleRate, 24);
          const byteRate = session.sampleRate * 1 * 2; // sampleRate * channels * bytesPerSample
          fileBuffer.writeUInt32LE(byteRate, 28);
          console.log(`   ✅ Fixed sample rate to ${session.sampleRate} Hz in header`);
        }
        
        // CRITICAL: Verify actual PCM data matches header sample rate (same as rotation check)
        const pcmDataStartFinal = 44; // WAV header is 44 bytes
        const pcmDataSize = fileBuffer.length - pcmDataStartFinal;
        const pcmSamples = pcmDataSize / 2; // 16-bit = 2 bytes per sample
        
        // Check if PCM data is actually 48kHz when header says 16kHz
        if (currentSampleRate === 16000 && pcmDataSize >= 2000) {
          // Analyze PCM data to detect if it's actually 48kHz
          const sampleSize = Math.min(5000, pcmSamples);
          let zeroCrossings = 0;
          let highFreqVariation = 0;
          let prevSample = 0;
          
          for (let i = 1; i < sampleSize; i++) {
            const offset = pcmDataStartFinal + (i * 2);
            if (offset + 1 >= fileBuffer.length) break;
            
            const sample1 = fileBuffer.readInt16LE(offset - 2);
            const sample2 = fileBuffer.readInt16LE(offset);
            
            // Zero crossing detection
            if ((prevSample >= 0 && sample2 < 0) || (prevSample < 0 && sample2 >= 0)) {
              zeroCrossings++;
            }
            
            // High frequency variation
            const diff = Math.abs(sample2 - sample1);
            highFreqVariation += diff;
            
            prevSample = sample2;
          }
          
          const zcr = zeroCrossings / sampleSize;
          const avgVariation = highFreqVariation / sampleSize;
          
          // If ZCR and variation suggest 48kHz, fix the header
          if (zcr > 0.12 && avgVariation > 500) {
            console.error(`❌ CRITICAL: Final chunk PCM data suggests 48kHz but header says 16kHz!`);
            console.error(`   ZCR: ${zcr.toFixed(3)}, Avg variation: ${avgVariation.toFixed(0)}`);
            console.error(`   Fixing header to 48kHz to match actual audio data...`);
            
            // Fix header to match actual audio (48kHz)
            fileBuffer.writeUInt32LE(48000, 24);
            const byteRate = 48000 * 1 * 2;
            fileBuffer.writeUInt32LE(byteRate, 28);
            
            // Update session sample rate
            session.sampleRate = 48000;
            
            audioLogger.error({
              event: 'final_chunk_header_corrected_to_48khz',
              participantEmail: session.participantEmail,
              callId: session.callId,
              chunkIndex: finalChunkIndex,
              originalHeaderRate: 16000,
              correctedRate: 48000,
              pcmDataSize,
              zcr: zcr.toFixed(3),
              avgVariation: avgVariation.toFixed(0),
              message: 'CRITICAL: Fixed final chunk header from 16kHz to 48kHz - PCM data is actually 48kHz',
            }, `Fixed final chunk header: 16kHz → 48kHz (PCM analysis)`);
          }
        }
        
        // Update RIFF chunk size (bytes 4-7)
        fileBuffer.writeUInt32LE(actualFileSize, 4);
        
        // Update data chunk size (bytes 40-43)
        fileBuffer.writeUInt32LE(actualPcmSize, 40);
        
        // VERIFY: Check PCM data integrity (sample first 20 samples)
        // pcmDataStartFinal is already declared above (line 2250)
        if (fileBuffer.length >= pcmDataStartFinal + 40) {
          const verificationSamples: number[] = [];
          let maxSample = 0;
          let invalidSamples = 0;
          
          for (let i = 0; i < 20 && (pcmDataStartFinal + i * 2 + 1) < fileBuffer.length; i++) {
            const offset = pcmDataStartFinal + (i * 2);
            const sampleLE = fileBuffer.readInt16LE(offset);
            const sampleBE = fileBuffer.readInt16BE(offset);
            verificationSamples.push(sampleLE);
            
            // Check valid range
            if (sampleLE < -32768 || sampleLE > 32767) {
              invalidSamples++;
            }
            
            maxSample = Math.max(maxSample, Math.abs(sampleLE));
          }
          
          if (invalidSamples > 0) {
            console.error(`❌ CRITICAL: ${invalidSamples} invalid PCM samples detected in final chunk ${finalChunkIndex}!`);
            console.error(`   First 20 samples: [${verificationSamples.join(', ')}]`);
          }
          
          // Log verification for final chunk
          audioLogger.info({
            event: 'wav_pcm_data_verification',
            participantEmail: session.participantEmail,
            callId: session.callId,
            chunkIndex: finalChunkIndex,
            firstSamples: verificationSamples,
            maxSample,
            invalidSamples,
            isFinal: true,
            message: 'PCM data verification after final WAV header update',
          }, `🔍 PCM data verification (final chunk ${finalChunkIndex}): First 20 samples: [${verificationSamples.join(', ')}], Max: ${maxSample}, Invalid: ${invalidSamples}`);
        }
        
        // Re-upload with corrected header
        await session.file.save(fileBuffer, {
          metadata: {
            contentType: 'audio/wav',
            metadata: session.file.metadata?.metadata || {},
          },
        });
        
        console.log(`✅ Updated WAV header for chunk ${finalChunkIndex}: ${actualPcmSize} bytes PCM data, sample rate: ${session.sampleRate}Hz`);
      } catch (error: any) {
        session.metrics.headerPatchFailures++;
        console.warn(`⚠️ Failed to update WAV header for chunk ${finalChunkIndex}:`, error.message);
        // Don't fail - the file is still usable, just with incorrect header size
      }
      
      // Publish final AudioChunkReady event after upload is complete
      publishAudioChunkReady(
        session,
        finalChunkIndex,
        finalChunkStartTime,
        Date.now(),
        finalStorageUrl,
        true,
        0, // No overlap at start of final chunk
        0  // No overlap at end
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
          true,
          0, // No overlap at start of final chunk
          0  // No overlap at end
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
    
    // Wait for rotation to complete if in progress
    if (session.state === 'rotating' && session.rotationLock) {
      try {
        await session.rotationLock;
      } catch (error) {
        // Ignore rotation errors during cleanup
      }
    }
    
    await closeStreamingSession(sessionKey, session);
    // Reset state before deleting
    session.state = 'idle';
    session.rotationLock = undefined;
    streamingSessions.delete(sessionKey);
    sessionCreationLocks.delete(sessionKey); // Clean up any lock
  }
  
  // Also close original audio session if it exists
  // Original audio upload removed - no longer saving original audio to GCS
}

/**
 * Clear all streaming sessions and state (called on server startup/restart)
 * Prevents state from persisting across server restarts
 */
export function clearAllStreamingSessions(): void {
  const sessionCount = streamingSessions.size;
  const lockCount = sessionCreationLocks.size;
  const cacheCount = orgSlugCache.size;
  
  // Close all active sessions gracefully
  for (const [key, session] of streamingSessions.entries()) {
    try {
      // Reset state
      session.state = 'idle';
      session.rotationLock = undefined;
      // Close write stream if it exists and is writable
      if (session.writeStream && !session.writeStream.destroyed) {
        session.writeStream.destroy();
      }
    } catch (error) {
      // Ignore errors during cleanup
    }
  }
  
  streamingSessions.clear();
  sessionCreationLocks.clear();
  orgSlugCache.clear();
  
  console.log(`🧹 Cleared all streaming sessions on server startup (${sessionCount} sessions, ${lockCount} locks, ${cacheCount} cache entries)`);
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'audio-recorder.ts:2137',message:'Cleared all streaming sessions',data:{sessionCount,lockCount,cacheCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
  // #endregion
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
  
  // Wait for any in-progress rotations before closing
  for (const [, session] of sessionsToClose) {
    if (session.state === 'rotating' && session.rotationLock) {
      try {
        await session.rotationLock;
      } catch (error) {
        // Ignore rotation errors during cleanup
      }
    }
  }
  
  // Close all sessions in parallel
  await Promise.allSettled(
    sessionsToClose.map(([key, session]) => closeStreamingSession(key, session))
  );
  
  // Clean up sessions and locks
  for (const [key, session] of sessionsToClose) {
    // Reset state before deleting
    session.state = 'idle';
    session.rotationLock = undefined;
    streamingSessions.delete(key);
    sessionCreationLocks.delete(key); // Clean up any locks
  }
  
  console.log(`✅ Flushed ${sessionsToClose.length} streaming session(s) for call ${callId}`);
}
