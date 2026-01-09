/**
 * Transcription Worker
 * Subscribes to Pub/Sub topics and processes audio chunks asynchronously
 */

import { PubSub } from '@google-cloud/pubsub';
import { Storage } from '@google-cloud/storage';
import { AssemblyAI } from 'assemblyai';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
// Note: Readable stream import removed - no longer using streaming API
import { getOrgPoolBySlug, getUserInfoBatch } from '../../database/multi-tenant-pool.js';
import crypto from 'crypto';
import { resample48kHzTo16kHz } from '../services/audio-processor.js';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { transcriptionLogger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize clients
let pubsubClient: PubSub | null = null;
let storageClient: Storage | null = null;
let assemblyAIClient: AssemblyAI | null = null;
let secretManagerClient: SecretManagerServiceClient | null = null;

// Configuration constants for chunk-based transcription
const CHUNK_DURATION_MS = 45000; // 45 seconds (configurable: 30-60s)
const CHUNK_OVERLAP_MS = 300; // 300ms overlap (200-500ms range)
const ASSEMBLYAI_MAX_CONCURRENT_JOBS = 32; // Respect API limits
const TRANSCRIPTION_POLL_INTERVAL_MS = 2000; // Poll every 2s
const TRANSCRIPTION_MAX_WAIT_MS = 300000; // 5 min max wait per chunk

// Active transcription sessions (in-memory for worker, but also persisted to DB)
interface TranscriptionSession {
  callId: string;
  roomName: string;
  participants: Map<string, { email: string; name?: string }>;
  transcripts: Map<string, string[]>; // Final stitched transcripts per participant
  startTime: Date;
  orgSlug?: string; // Organization slug (used for database access)
  // Chunk-based transcription tracking
  chunkTranscripts: Map<string, Map<number, string>>; // participant -> chunkIndex -> transcript text
  chunkTranscriptionJobs: Map<string, Map<number, string>>; // participant -> chunkIndex -> AssemblyAI job ID
  chunkTranscriptionStatus: Map<string, Map<number, 'pending' | 'processing' | 'completed' | 'failed'>>; // participant -> chunkIndex -> status
  chunkStorageUrls: Map<string, Map<number, string>>; // participant -> chunkIndex -> storageUrl
  processedChunks: Map<string, Set<number>>; // Track processed chunks per participant (email -> Set<chunkIndex>)
  processingChunks: Map<string, Set<number>>; // Track chunks currently being processed (in-progress) per participant
  finalChunksReceived: Set<string>; // Track which participants have received final chunks (email -> true)
}

const activeSessions = new Map<string, TranscriptionSession>();
const pendingChunks = new Map<string, Array<{ message: any; data: any }>>(); // Queue chunks that arrive before session is ready

// Add near top with other Maps
const transcriptionSessionLocks = new Map<string, Promise<void>>();

// Track calls that need summaries (when call ended but transcriptions weren't complete)
interface PendingSummary {
  docId: string;
  ownerEmail: string;
  orgSlug: string;
  callId: string;
}
const pendingSummaries = new Map<string, PendingSummary>(); // callId -> PendingSummary

// Note: pushAudioInChunks removed - no longer using streaming API

/**
 * Detect if audio buffer is likely 48kHz and needs resampling to 16kHz
 * Heuristic: Check if buffer size suggests 48kHz sample rate
 * At 16kHz: 1 second = 16,000 samples * 2 bytes = 32,000 bytes
 * At 48kHz: 1 second = 48,000 samples * 2 bytes = 96,000 bytes
 * 
 * Simple strategy: If buffer size is > 2.5x what we'd expect for 16kHz, it's likely 48kHz
 * This handles the case where audio was stored as 48kHz instead of being resampled
 */
function needsResampling(audioBuffer: Buffer): boolean {
  const size = audioBuffer.length;
  
  // Only check files > 50KB to avoid false positives on small chunks
  if (size <= 50000) {
    return false; // Assume 16kHz for small files
  }
  
  // Calculate duration assuming 16kHz (mono, 16-bit = 2 bytes per sample)
  // At 16kHz: 1 second = 16,000 samples * 2 bytes = 32,000 bytes
  const bytesPerSecond16kHz = 16000 * 2; // 32,000 bytes
  const duration = size / bytesPerSecond16kHz;
  
  // Calculate expected size at 48kHz for the same duration
  // At 48kHz: 1 second = 48,000 samples * 2 bytes = 96,000 bytes
  const bytesPerSecond48kHz = 48000 * 2; // 96,000 bytes
  const expected48kHz = duration * bytesPerSecond48kHz;
  
  // Compare actual size to expected 48kHz size
  // If size / expected48kHz is between 0.8-1.2, it's likely 48kHz
  const ratio = size / expected48kHz;
  
  if (ratio >= 0.8 && ratio <= 1.2) {
    return true; // Likely 48kHz
  }
  
  // Default: assume 16kHz (safer - won't break if already correct)
  return false;
}

/**
 * Detect actual sample rate from audio buffer size and duration
 * This verifies the metadata matches the actual data
 * 
 * @param audioBuffer - PCM audio buffer (16-bit samples)
 * @param expectedDuration - Optional expected duration in seconds
 * @returns Detected sample rate (16000 or 48000)
 */
function detectActualSampleRate(audioBuffer: Buffer, expectedDuration?: number): number {
  const bytes = audioBuffer.length;
  const samples = bytes / 2; // 16-bit = 2 bytes per sample
  
  // If we have duration, calculate sample rate directly
  if (expectedDuration && expectedDuration > 0) {
    const calculatedRate = samples / expectedDuration;
    
    // Round to nearest standard rate (16kHz or 48kHz)
    if (Math.abs(calculatedRate - 16000) < Math.abs(calculatedRate - 48000)) {
      return 16000;
    } else {
      return 48000;
    }
  }
  
  // Otherwise, use size-based heuristic (from needsResampling function)
  return needsResampling(audioBuffer) ? 48000 : 16000;
}

/**
 * Convert PCM16 buffer to WAV format
 * AssemblyAI can auto-detect WAV files, but raw PCM requires format specification
 * WAV is a container format that wraps PCM data with a header
 */
function pcmToWav(pcmBuffer: Buffer, sampleRate: number): Buffer {
  const numChannels = 1; // Mono
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const fileSize = 36 + dataSize;
  
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
  wavHeader.writeUInt32LE(dataSize, 40);
  
  // Combine header and PCM data
  return Buffer.concat([wavHeader, pcmBuffer]);
}

/**
 * Resample audio to 16kHz if needed before sending to AssemblyAI
 * AssemblyAI requires 16kHz
 * 
 * Note: Audio is already resampled to 16kHz before saving to GCS (see livekit.ts line 854),
 * so we should assume it's 16kHz. However, we keep the detection logic as a safety net
 * for any legacy files or edge cases.
 */
async function ensure16kHz(audioBuffer: Buffer, email?: string): Promise<Buffer> {
  // Audio is already resampled to 16kHz before saving to GCS (see livekit.ts line 854)
  // So we can skip the resampling check and assume it's already 16kHz
  // This prevents double-resampling which wastes CPU and can degrade quality
  
  // However, keep detection as a safety net for legacy files or edge cases
  if (needsResampling(audioBuffer)) {
    console.warn(`⚠️ Audio file appears to be 48kHz for ${email || 'unknown'} (${audioBuffer.length} bytes) - this should not happen if audio was saved correctly`);
    console.warn(`   This might be a legacy file or there was an error during save. Attempting to resample...`);
    
    try {
      const originalSize = audioBuffer.length;
      console.log(`🔄 Resampling audio from 48kHz to 16kHz for ${email || 'unknown'} (${originalSize} bytes)`);
      
      const resampled = await resample48kHzTo16kHz(audioBuffer);
      
      // Verify resampling produced expected size (should be ~1/3 of original for 48kHz->16kHz)
      const expectedSize = Math.floor(originalSize / 3);
      const sizeDiff = Math.abs(resampled.length - expectedSize);
      const sizeDiffPercent = (sizeDiff / expectedSize) * 100;
      
      if (sizeDiffPercent > 10) {
        console.warn(`⚠️ Resampled audio size (${resampled.length}) differs significantly from expected (${expectedSize}) for ${email || 'unknown'}`);
      }
      
      console.log(`✅ Resampled audio: ${originalSize} bytes → ${resampled.length} bytes (expected ~${expectedSize}) for ${email || 'unknown'}`);
      return resampled;
    } catch (error: any) {
      console.error(`❌ Error resampling audio for ${email || 'unknown'}:`, error);
      // If resampling fails, log warning but return original
      // This might cause transcription issues, but better than crashing
      console.warn(`⚠️ Using original audio buffer (may be wrong sample rate) for ${email || 'unknown'}`);
      return audioBuffer;
    }
  }
  
  // Audio appears to be 16kHz already (as expected), return as-is
  return audioBuffer;
}

// Get project ID
function getProjectId(): string {
  const serviceAccountPath = join(__dirname, '../../gcp_credential.json');
  if (existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    return serviceAccount.project_id;
  }
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || '';
}

// Initialize Firebase Admin SDK for Bearer token generation
function initializeFirebaseAdmin() {
  if (getApps().length === 0) {
    const serviceAccountPath = join(__dirname, '../../gcp_credential.json');
    if (existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
      initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
      console.log('✅ Firebase Admin SDK initialized for transcription worker');
    } else {
      console.warn('⚠️ GCP credentials not found, Firebase Admin SDK not initialized');
    }
  }
}

// Get Bearer token (custom token) for user email
// In production, we create a custom token that can be verified by the API
async function getBearerTokenForUser(userEmail: string): Promise<string | null> {
  try {
    initializeFirebaseAdmin();
    const auth = getAuth();
    
    // Try to get the user by email first
    let uid: string;
    try {
      const userRecord = await auth.getUserByEmail(userEmail.toLowerCase());
      uid = userRecord.uid;
    } catch (error: any) {
      // If user doesn't exist, use email as UID for custom token
      // The API middleware will handle verification
      uid = userEmail.toLowerCase();
    }
    
    // Create a custom token for the user
    const customToken = await auth.createCustomToken(uid);
    return customToken;
  } catch (error: any) {
    console.error(`❌ Failed to create Bearer token for ${userEmail}:`, error);
    return null;
  }
}

// Initialize clients
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
      pubsubClient = new PubSub({ projectId });
    }
  }
  return pubsubClient;
}

function getStorageClient(): Storage {
  if (!storageClient) {
    const serviceAccountPath = join(__dirname, '../../gcp_credential.json');
    if (existsSync(serviceAccountPath)) {
      storageClient = new Storage({
        keyFilename: serviceAccountPath,
      });
    } else {
      storageClient = new Storage();
    }
  }
  return storageClient;
}

async function getAssemblyAIClient(): Promise<AssemblyAI> {
  if (assemblyAIClient) {
    return assemblyAIClient;
  }

  const projectId = getProjectId();
  if (!secretManagerClient) {
    const serviceAccountPath = join(__dirname, '../../gcp_credential.json');
    if (existsSync(serviceAccountPath)) {
      secretManagerClient = new SecretManagerServiceClient({
        keyFilename: serviceAccountPath,
      });
    } else {
      secretManagerClient = new SecretManagerServiceClient();
    }
  }

  // Get API key from Secret Manager
  const secretName = `projects/${projectId}/secrets/assemblyai-api-key/versions/latest`;
  const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
  const apiKey = version.payload?.data?.toString()?.trim() || '';

  if (!apiKey) {
    throw new Error('AssemblyAI API key not found in Secret Manager');
  }

  assemblyAIClient = new AssemblyAI({ apiKey });
  return assemblyAIClient;
}

// Load transcription session from database
async function loadSessionFromDB(callId: string, orgSlug?: string): Promise<TranscriptionSession | null> {
  if (!orgSlug) {
    console.warn(`⚠️ Cannot load session from DB without orgSlug for call ${callId}`);
    return null;
  }

  try {
    const pool = await getOrgPoolBySlug(orgSlug);
    const result = await pool.query(
      'SELECT * FROM transcription_sessions WHERE call_id = $1',
      [callId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const participants = new Map<string, { email: string; name?: string }>();
    const participantsData = Array.isArray(row.participants) ? row.participants : JSON.parse(row.participants || '[]');
    
    for (const p of participantsData) {
      participants.set(p.email.toLowerCase(), p);
    }

    // Load chunk transcripts from transcription_chunk_results table if it exists
    const chunkTranscripts = new Map<string, Map<number, string>>();
    const chunkTranscriptionJobs = new Map<string, Map<number, string>>();
    const chunkTranscriptionStatus = new Map<string, Map<number, 'pending' | 'processing' | 'completed' | 'failed'>>();
    const chunkStorageUrls = new Map<string, Map<number, string>>();
    const processedChunks = new Map<string, Set<number>>();
    
    try {
      const chunkResults = await pool.query(
        'SELECT participant_email, chunk_index, transcript, assemblyai_job_id, status, storage_url FROM transcription_chunk_results WHERE call_id = $1',
        [callId]
      );
      
      for (const chunkRow of chunkResults.rows) {
        const email = chunkRow.participant_email.toLowerCase();
        const chunkIndex = chunkRow.chunk_index;
        
        if (!chunkTranscripts.has(email)) {
          chunkTranscripts.set(email, new Map());
          chunkTranscriptionJobs.set(email, new Map());
          chunkTranscriptionStatus.set(email, new Map());
          chunkStorageUrls.set(email, new Map());
          processedChunks.set(email, new Set());
        }
        
        if (chunkRow.transcript) {
          chunkTranscripts.get(email)!.set(chunkIndex, chunkRow.transcript);
        }
        if (chunkRow.assemblyai_job_id) {
          chunkTranscriptionJobs.get(email)!.set(chunkIndex, chunkRow.assemblyai_job_id);
        }
        if (chunkRow.status) {
          chunkTranscriptionStatus.get(email)!.set(chunkIndex, chunkRow.status as 'pending' | 'processing' | 'completed' | 'failed');
        }
        if (chunkRow.storage_url) {
          chunkStorageUrls.get(email)!.set(chunkIndex, chunkRow.storage_url);
        }
        processedChunks.get(email)!.add(chunkIndex);
      }
    } catch (error: any) {
      // Table might not exist yet (migration not run), that's okay
      console.warn(`⚠️ Could not load chunk results from DB (table may not exist):`, error.message);
    }

    const session: TranscriptionSession = {
      callId: row.call_id,
      roomName: row.room_name,
      participants,
      transcripts: new Map(), // Final stitched transcripts
      startTime: row.started_at,
      orgSlug,
      chunkTranscripts, // Restored from DB
      chunkTranscriptionJobs, // Restored from DB
      chunkTranscriptionStatus, // Restored from DB
      chunkStorageUrls, // Restored from DB
      processedChunks, // Restored from DB
      processingChunks: new Map(), // Initialize empty - tracks chunks currently being processed
      finalChunksReceived: new Set(), // Initialize empty - will be populated as final chunks arrive
    };

    // Load transcripts from DB
    const transcriptsData = row.transcripts ? (typeof row.transcripts === 'string' ? JSON.parse(row.transcripts) : row.transcripts) : {};
    for (const [email, transcriptArray] of Object.entries(transcriptsData)) {
      session.transcripts.set(email.toLowerCase(), transcriptArray as string[]);
    }

    const totalChunks = Array.from(chunkTranscripts.values()).reduce((sum, map) => sum + map.size, 0);
    console.log(`📝 Loaded session from DB: ${chunkTranscripts.size} participants with ${totalChunks} chunk transcripts`);

    return session;
  } catch (error: any) {
    console.error(`❌ Error loading session from DB for call ${callId}:`, error);
    return null;
  }
}

// Save transcription session to database
async function saveSessionToDB(session: TranscriptionSession): Promise<void> {
  if (!session.orgSlug) {
    console.warn(`⚠️ Cannot save session to DB without orgSlug for call ${session.callId}`);
    return;
  }

  try {
    const pool = await getOrgPoolBySlug(session.orgSlug);
    const participantsArray = Array.from(session.participants.values());
    const transcriptsObj: Record<string, string[]> = {};
    for (const [email, transcripts] of session.transcripts.entries()) {
      transcriptsObj[email] = transcripts;
    }

    await pool.query(`
      INSERT INTO transcription_sessions (call_id, room_name, participants, status, started_at, transcripts, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (call_id) DO UPDATE SET
        participants = EXCLUDED.participants,
        status = EXCLUDED.status,
        transcripts = EXCLUDED.transcripts,
        updated_at = NOW()
    `, [
      session.callId,
      session.roomName,
      JSON.stringify(participantsArray),
      'active',
      session.startTime,
      JSON.stringify(transcriptsObj),
    ]);
  } catch (error: any) {
    console.error(`❌ Error saving session to DB for call ${session.callId}:`, error);
  }
}

// Note: setupTranscriberForParticipant removed - no longer using streaming API

// Start transcription session
async function startTranscriptionSession(
  callId: string,
  roomName: string,
  participants: Array<{ email: string; name?: string }>,
  orgSlug?: string
): Promise<void> {
  // Check if session creation is already in progress
  if (transcriptionSessionLocks.has(callId)) {
    console.log(`📝 Transcription session creation in progress for call ${callId}, waiting...`);
    try {
      await transcriptionSessionLocks.get(callId)!;
      // Check again after waiting
      const existing = activeSessions.get(callId);
      if (existing) {
        console.log(`📝 Transcription session already exists for call ${callId} (created by concurrent request)`);
        return;
      }
    } catch (error: any) {
      console.warn(`⚠️ Transcription session creation failed, retrying:`, error.message);
      transcriptionSessionLocks.delete(callId);
    }
  }
  
  // Check if session already exists
  let session: TranscriptionSession | undefined = activeSessions.get(callId);
  let sessionLoadedFromDB = false;
  if (!session && orgSlug) {
    const loadedSession = await loadSessionFromDB(callId, orgSlug);
    if (loadedSession) {
      session = loadedSession;
      activeSessions.set(callId, session);
      sessionLoadedFromDB = true;
      console.log(`📝 Loaded transcription session from DB for call ${callId}`);
    }
  }

  // If session already exists, just ensure participants are up to date
  if (session && !sessionLoadedFromDB) {
    // Session exists - ensure participants match
    for (const participant of participants) {
      const email = participant.email.toLowerCase();
      if (!session.participants.has(email)) {
        session.participants.set(email, participant);
      }
    }
    console.log(`📝 Transcription session already exists for call ${callId}`);
    activeSessions.set(callId, session);
    await saveSessionToDB(session);
    transcriptionSessionLocks.delete(callId);
    return;
  }

  // Create new session if it doesn't exist
  if (!session) {
    session = {
      callId,
      roomName,
      participants: new Map(participants.map(p => [p.email.toLowerCase(), p])),
      transcripts: new Map(), // Final stitched transcripts
      startTime: new Date(),
      orgSlug,
      chunkTranscripts: new Map(), // participant -> chunkIndex -> transcript
      chunkTranscriptionJobs: new Map(), // participant -> chunkIndex -> jobId
      chunkTranscriptionStatus: new Map(), // participant -> chunkIndex -> status
      chunkStorageUrls: new Map(), // participant -> chunkIndex -> storageUrl
      processedChunks: new Map(), // participant -> Set<chunkIndex>
      processingChunks: new Map(), // participant -> Set<chunkIndex>
      finalChunksReceived: new Set(), // participant emails
    };
  } else {
    // Session loaded from DB - ensure participants match
    for (const participant of participants) {
      const email = participant.email.toLowerCase();
      if (!session.participants.has(email)) {
        session.participants.set(email, participant);
      }
    }
  }

  activeSessions.set(callId, session);
  await saveSessionToDB(session);
  console.log(`✅ Transcription session started for call ${callId} with ${participants.length} participants`);
  
  // Process any pending chunks that arrived before session was created
  const pending = pendingChunks.get(callId);
  if (pending && pending.length > 0) {
    console.log(`📦 Processing ${pending.length} pending chunks for call ${callId}`);
    for (const { message, data } of pending) {
      // Process chunk asynchronously (don't await to avoid blocking)
      processAudioChunk(message).catch((error: any) => {
        console.error(`❌ Error processing pending chunk:`, error);
        message.nack();
      });
    }
    pendingChunks.delete(callId);
  }

  transcriptionSessionLocks.delete(callId); // Clear lock when done
}

/**
 * Transcribe an audio chunk using AssemblyAI pre-recorded API
 */
async function transcribeAudioChunk(
  session: TranscriptionSession,
  participantEmail: string,
  chunkIndex: number,
  storageUrl: string
): Promise<string | null> {
  const email = participantEmail.toLowerCase();
  
  try {
    // Download chunk from GCS with retry logic for missing files
    const storage = getStorageClient();
    const [bucketName, ...pathParts] = storageUrl.replace('gs://', '').split('/');
    const filePath = pathParts.join('/');
    const file = storage.bucket(bucketName).file(filePath);
    
    // Check if file exists before trying to download (with retry)
    let audioBuffer: Buffer | null = null;
    let retries = 3;
    let lastError: Error | null = null;
    
    while (retries > 0 && !audioBuffer) {
      try {
        // Check if file exists
        const [exists] = await file.exists();
        if (!exists) {
          if (retries > 1) {
            console.warn(`⚠️ File ${filePath} does not exist yet (chunk ${chunkIndex} for ${email}), retrying in 2s... (${retries - 1} retries left)`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
            retries--;
            continue;
          } else {
            throw new Error(`File ${filePath} does not exist in GCS after retries. The upload may have failed.`);
          }
        }
        
        // File exists, download it
        [audioBuffer] = await file.download();
        break; // Success, exit retry loop
      } catch (error: any) {
        lastError = error;
        if (error.code === 404 || error.code === 'ENOENT') {
          if (retries > 1) {
            console.warn(`⚠️ File ${filePath} not found (chunk ${chunkIndex} for ${email}), retrying in 2s... (${retries - 1} retries left)`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            retries--;
            continue;
          } else {
            throw new Error(`File ${filePath} does not exist in GCS after retries. The upload may have failed.`);
          }
        }
        // Non-404 error, don't retry
        throw error;
      }
    }
    
    if (!audioBuffer) {
      throw lastError || new Error('Failed to download file after retries');
    }
    
    if (audioBuffer.length === 0) {
      console.warn(`⚠️ Empty audio chunk ${chunkIndex} for ${email}`);
      return null;
    }
    
    // Check if file is WAV format (starts with "RIFF" header)
    const isWav = audioBuffer.length >= 4 && audioBuffer.toString('ascii', 0, 4) === 'RIFF';
    
    let wavBuffer: Buffer;
    
    if (isWav) {
      // File is already WAV format - verify sample rate from header matches actual audio
      if (audioBuffer.length < 44) {
        console.warn(`⚠️ WAV file too small (${audioBuffer.length} bytes) for chunk ${chunkIndex} of ${email}`);
        return null;
      }
      
      // Read sample rate from WAV header (bytes 24-27, little-endian)
      const headerSampleRate = audioBuffer.readUInt32LE(24);
      
      // CRITICAL: Verify header sample rate matches actual audio data
      // Calculate PCM data size (file size - 44 byte header)
      const pcmDataSize = audioBuffer.length - 44;
      const pcmSamples = pcmDataSize / 2; // 16-bit = 2 bytes per sample
      
      // Try to estimate duration from chunk metadata if available
      // For now, use size-based detection as fallback
      const detectedSampleRate = detectActualSampleRate(Buffer.from(audioBuffer, 44, pcmDataSize));
      
      // Check if header sample rate matches detected rate
      if (headerSampleRate !== detectedSampleRate) {
        console.error(`❌ CRITICAL: WAV header sample rate mismatch for chunk ${chunkIndex} of ${email}!`);
        console.error(`   Header says: ${headerSampleRate}Hz`);
        console.error(`   Audio data indicates: ${detectedSampleRate}Hz`);
        console.error(`   PCM data: ${pcmSamples} samples, ${pcmDataSize} bytes`);
        console.error(`   This will cause incorrect playback speed (monster tone)!`);
        
        // Fix the header to match actual audio data
        const fixedBuffer = Buffer.from(audioBuffer);
        fixedBuffer.writeUInt32LE(detectedSampleRate, 24);
        const byteRate = detectedSampleRate * 1 * 2; // sampleRate * channels * bytesPerSample
        fixedBuffer.writeUInt32LE(byteRate, 28);
        
        transcriptionLogger.error({
          event: 'wav_header_sample_rate_fixed',
          callId: session.callId,
          participantEmail: email,
          chunkIndex,
          originalHeaderRate: headerSampleRate,
          detectedRate: detectedSampleRate,
          pcmSamples,
          pcmDataSize,
          message: 'CRITICAL: Fixed WAV header sample rate to match actual audio data',
        }, `Fixed WAV header: ${headerSampleRate}Hz → ${detectedSampleRate}Hz for chunk ${chunkIndex}`);
        
        wavBuffer = fixedBuffer;
      } else {
        // Header matches - verify it's 16kHz as expected
        if (headerSampleRate !== 16000) {
          console.warn(`⚠️ WAV file has sample rate ${headerSampleRate}Hz (expected 16000Hz) for chunk ${chunkIndex} of ${email}`);
          console.warn(`   However, audio data appears to match header (${detectedSampleRate}Hz)`);
          // Still proceed - AssemblyAI can handle other sample rates
        }
        
        // Use WAV file directly with AssemblyAI
        wavBuffer = audioBuffer;
      }
    } else {
      // Legacy PCM file - detect actual sample rate and resample to 16kHz if needed
      const detectedSampleRate = detectActualSampleRate(audioBuffer);
      
      if (detectedSampleRate !== 16000) {
        console.warn(`⚠️ PCM audio detected as ${detectedSampleRate}Hz (expected 16kHz) for chunk ${chunkIndex} of ${email}`);
        console.warn(`   Resampling to 16kHz...`);
      }
      
      const resampledAudio = await ensure16kHz(audioBuffer, email);
      
      // CRITICAL: Verify resampled audio is actually 16kHz before creating WAV header
      const verifiedSampleRate = detectActualSampleRate(resampledAudio);
      if (verifiedSampleRate !== 16000) {
        console.error(`❌ CRITICAL: Resampled audio is still ${verifiedSampleRate}Hz, not 16kHz!`);
        console.error(`   This will cause incorrect WAV header metadata!`);
        transcriptionLogger.error({
          event: 'resampling_verification_failed',
          callId: session.callId,
          participantEmail: email,
          chunkIndex,
          detectedRate: verifiedSampleRate,
          expectedRate: 16000,
          message: 'CRITICAL: Resampled audio does not match expected 16kHz',
        }, `Resampling verification failed: got ${verifiedSampleRate}Hz, expected 16kHz`);
      }
      
      // Convert PCM to WAV format for AssemblyAI (WAV is auto-detected, raw PCM is not)
      // Use verified sample rate (should be 16000)
      wavBuffer = pcmToWav(resampledAudio, verifiedSampleRate);
      
      // Double-check the WAV header we just created
      const createdHeaderRate = wavBuffer.readUInt32LE(24);
      if (createdHeaderRate !== verifiedSampleRate) {
        console.error(`❌ CRITICAL: Created WAV header has wrong sample rate!`);
        console.error(`   Expected: ${verifiedSampleRate}Hz, Got: ${createdHeaderRate}Hz`);
        // Fix it
        wavBuffer.writeUInt32LE(verifiedSampleRate, 24);
        const byteRate = verifiedSampleRate * 1 * 2;
        wavBuffer.writeUInt32LE(byteRate, 28);
      }
    }
    
    // Upload to AssemblyAI and submit transcription job
    const assemblyAI = await getAssemblyAIClient();
    const uploadUrl = await assemblyAI.files.upload(wavBuffer);
    
    // Submit transcription job (returns immediately, status will be 'queued' or 'processing')
    const transcript = await assemblyAI.transcripts.transcribe({
      audio: uploadUrl,
      format_text: true,
      punctuate: true,
      speaker_labels: true, // Enable speaker diarization for multi-speaker calls
    });
    
    // Store job ID and status
    if (!session.chunkTranscriptionJobs.has(email)) {
      session.chunkTranscriptionJobs.set(email, new Map());
      session.chunkTranscriptionStatus.set(email, new Map());
      session.chunkStorageUrls.set(email, new Map());
    }
    const jobId = transcript.id;
    session.chunkTranscriptionJobs.get(email)!.set(chunkIndex, jobId);
    session.chunkTranscriptionStatus.get(email)!.set(chunkIndex, 'processing');
    session.chunkStorageUrls.get(email)!.set(chunkIndex, storageUrl);
    
    // Save initial status to DB
    if (session.orgSlug) {
      try {
        const pool = await getOrgPoolBySlug(session.orgSlug);
        await pool.query(`
          INSERT INTO transcription_chunk_results (call_id, participant_email, chunk_index, storage_url, assemblyai_job_id, status)
          VALUES ($1, $2, $3, $4, $5, 'processing')
          ON CONFLICT (call_id, participant_email, chunk_index) DO UPDATE SET
            assemblyai_job_id = EXCLUDED.assemblyai_job_id,
            status = 'processing'
        `, [session.callId, email, chunkIndex, storageUrl, jobId]);
      } catch (dbError: any) {
        // Handle missing table gracefully - log warning but continue processing
        if (dbError.code === '42P01') {
          console.warn(`⚠️ Database table 'transcription_chunk_results' does not exist. Please run migration: database/migrations/add-transcription-chunk-results.sql`);
          console.warn(`⚠️ Continuing without DB persistence - transcription will still work but results won't be saved to DB`);
        } else {
          console.error(`❌ Error saving chunk result to DB:`, dbError);
        }
      }
    }
    
    // Log transcription started
    transcriptionLogger.info({
      event: 'transcription_started',
      callId: session.callId,
      participantEmail: email,
      chunkIndex,
      storageUrl,
      assemblyaiJobId: jobId,
      timestamp: new Date().toISOString(),
    }, `Chunk ${chunkIndex} transcription started for ${email}`);
    
    // Poll for completion (async, don't await to allow parallel processing)
    pollTranscriptionStatus(session, email, chunkIndex, jobId)
      .then((transcriptText) => {
        if (transcriptText) {
          console.log(`✅ Chunk ${chunkIndex} transcription completed for ${email}`);
        }
      })
      .catch((error) => {
        transcriptionLogger.error({
          event: 'transcription_polling_error',
          callId: session.callId,
          participantEmail: email,
          chunkIndex,
          assemblyaiJobId: jobId,
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString(),
        }, `Error polling transcription for chunk ${chunkIndex}: ${error.message}`);
        console.error(`❌ Error polling transcription for chunk ${chunkIndex}:`, error);
      });
    
    // Return null immediately - transcript will be available when polling completes
    // The polling happens in background, and results are stored in session.chunkTranscripts
    return null;
  } catch (error: any) {
    // Log transcription error to file
    transcriptionLogger.error({
      event: 'transcription_error',
      callId: session.callId,
      participantEmail: email,
      chunkIndex,
      storageUrl: storageUrl || null,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    }, `Error transcribing chunk ${chunkIndex} for ${email}: ${error.message}`);
    
    console.error(`❌ Error transcribing chunk ${chunkIndex} for ${email}:`, error);
    
    // Mark as failed
    if (!session.chunkTranscriptionStatus.has(email)) {
      session.chunkTranscriptionStatus.set(email, new Map());
    }
    session.chunkTranscriptionStatus.get(email)!.set(chunkIndex, 'failed');
    
    // Save to DB
    if (session.orgSlug) {
      try {
        const pool = await getOrgPoolBySlug(session.orgSlug);
        await pool.query(`
          INSERT INTO transcription_chunk_results (call_id, participant_email, chunk_index, storage_url, status, error_message)
          VALUES ($1, $2, $3, $4, 'failed', $5)
          ON CONFLICT (call_id, participant_email, chunk_index) DO UPDATE SET
            status = 'failed',
            error_message = EXCLUDED.error_message
        `, [session.callId, email, chunkIndex, storageUrl, error.message]);
      } catch (dbError: any) {
        // Handle missing table gracefully
        if (dbError.code === '42P01') {
          console.warn(`⚠️ Database table 'transcription_chunk_results' does not exist. Please run migration.`);
        } else {
          console.error(`❌ Error saving chunk result to DB:`, dbError);
        }
      }
    }
    
    return null;
  }
}

/**
 * Poll AssemblyAI for transcription status
 */
async function pollTranscriptionStatus(
  session: TranscriptionSession,
  participantEmail: string,
  chunkIndex: number,
  jobId: string
): Promise<string | null> {
  const email = participantEmail.toLowerCase();
  const assemblyAI = await getAssemblyAIClient();
  const startTime = Date.now();
  
  // Declare storageUrl at function level so it's available for logging
  let storageUrl: string | undefined = undefined;
  
  while (Date.now() - startTime < TRANSCRIPTION_MAX_WAIT_MS) {
    try {
      const transcript = await assemblyAI.transcripts.get(jobId);
      
      if (transcript.status === 'completed') {
        const transcriptText = transcript.text || '';
        
        // Store transcript
        if (!session.chunkTranscripts.has(email)) {
          session.chunkTranscripts.set(email, new Map());
        }
        session.chunkTranscripts.get(email)!.set(chunkIndex, transcriptText);
        session.chunkTranscriptionStatus.get(email)!.set(chunkIndex, 'completed');
        
        // Mark as processed (remove from processing, add to processed)
        if (!session.processingChunks.has(email)) {
          session.processingChunks.set(email, new Set());
        }
        if (!session.processedChunks.has(email)) {
          session.processedChunks.set(email, new Set());
        }
        session.processingChunks.get(email)!.delete(chunkIndex);
        session.processedChunks.get(email)!.add(chunkIndex);
        
        // Get storage_url from session state (before DB operations)
        storageUrl = session.chunkStorageUrls.get(email)?.get(chunkIndex);
        
        // Save to DB - retrieve storage_url from session state or DB
        if (session.orgSlug) {
          try {
            const pool = await getOrgPoolBySlug(session.orgSlug);
            
            // If not in session state, try to get from DB as fallback
            if (!storageUrl) {
              try {
                const dbResult = await pool.query(
                  'SELECT storage_url FROM transcription_chunk_results WHERE call_id = $1 AND participant_email = $2 AND chunk_index = $3',
                  [session.callId, email, chunkIndex]
                );
                if (dbResult.rows.length > 0 && dbResult.rows[0].storage_url) {
                  storageUrl = dbResult.rows[0].storage_url;
                }
              } catch (queryError: any) {
                console.warn(`⚠️ Could not retrieve storage_url from DB for chunk ${chunkIndex}:`, queryError.message);
              }
            }
            
            // If still no storage_url, we can't save (but log warning and continue)
            if (!storageUrl) {
              console.warn(`⚠️ No storage_url available for chunk ${chunkIndex} completion - skipping DB update`);
            } else {
              // Use UPSERT with storage_url included
              await pool.query(`
                INSERT INTO transcription_chunk_results (call_id, participant_email, chunk_index, storage_url, assemblyai_job_id, transcript, status, completed_at)
                VALUES ($1, $2, $3, $4, $5, $6, 'completed', NOW())
                ON CONFLICT (call_id, participant_email, chunk_index) DO UPDATE SET
                  storage_url = COALESCE(EXCLUDED.storage_url, transcription_chunk_results.storage_url),
                  assemblyai_job_id = EXCLUDED.assemblyai_job_id,
                  transcript = EXCLUDED.transcript,
                  status = 'completed',
                  completed_at = NOW()
              `, [session.callId, email, chunkIndex, storageUrl, jobId, transcriptText]);
            }
          } catch (dbError: any) {
            // Handle missing table gracefully
            if (dbError.code === '42P01') {
              console.warn(`⚠️ Database table 'transcription_chunk_results' does not exist. Please run migration.`);
            } else {
              console.error(`❌ Error saving chunk result to DB:`, dbError);
            }
          }
        }
        
        // Log transcription to file (structured logging)
        transcriptionLogger.info({
          event: 'transcription_completed',
          callId: session.callId,
          participantEmail: email,
          chunkIndex,
          storageUrl: storageUrl || null,
          assemblyaiJobId: jobId,
          transcriptLength: transcriptText.length,
          transcript: transcriptText,
          timestamp: new Date().toISOString(),
        }, `Chunk ${chunkIndex} transcription completed for ${email}`);
        
        // Also print to console for immediate visibility
        console.log(`\n${'='.repeat(80)}`);
        console.log(`✅ Chunk ${chunkIndex} transcription completed for ${email}`);
        console.log(`${'='.repeat(80)}`);
        console.log(`Full Transcription:`);
        console.log(transcriptText);
        console.log(`${'='.repeat(80)}\n`);
        
        // Check if there's a pending summary for this call and if all transcriptions are now complete
        const pendingSummary = pendingSummaries.get(session.callId);
        if (pendingSummary) {
          // Reload session from DB to ensure we have the latest state (in case call ended and session was removed from activeSessions)
          let sessionToCheck = session;
          if (session.orgSlug && !activeSessions.has(session.callId)) {
            // Session not in activeSessions (call may have ended), try to reload from DB
            const dbSession = await loadSessionFromDB(session.callId, session.orgSlug);
            if (dbSession) {
              // Merge latest state from DB
              for (const [email, dbChunkMap] of dbSession.chunkTranscripts.entries()) {
                if (!sessionToCheck.chunkTranscripts.has(email)) {
                  sessionToCheck.chunkTranscripts.set(email, new Map());
                }
                const memChunkMap = sessionToCheck.chunkTranscripts.get(email)!;
                for (const [chunkIdx, transcript] of dbChunkMap.entries()) {
                  if (!memChunkMap.has(chunkIdx)) {
                    memChunkMap.set(chunkIdx, transcript);
                  }
                }
              }
              // Merge status maps
              for (const [email, dbStatusMap] of dbSession.chunkTranscriptionStatus.entries()) {
                if (!sessionToCheck.chunkTranscriptionStatus.has(email)) {
                  sessionToCheck.chunkTranscriptionStatus.set(email, new Map());
                }
                const memStatusMap = sessionToCheck.chunkTranscriptionStatus.get(email)!;
                for (const [chunkIdx, status] of dbStatusMap.entries()) {
                  if (!memStatusMap.has(chunkIdx)) {
                    memStatusMap.set(chunkIdx, status);
                  }
                }
              }
            }
          }
          
          const allComplete = areAllChunksTranscribed(sessionToCheck);
          if (allComplete.allComplete) {
            // Final verification: ensure we have the absolute latest state before triggering summary
            // Reload from DB one more time to be absolutely certain
            let finalSessionCheck = sessionToCheck;
            if (session.orgSlug) {
              const latestDbSession = await loadSessionFromDB(session.callId, session.orgSlug);
              if (latestDbSession) {
                // Merge latest DB state into our check session
                for (const [email, dbChunkMap] of latestDbSession.chunkTranscripts.entries()) {
                  if (!finalSessionCheck.chunkTranscripts.has(email)) {
                    finalSessionCheck.chunkTranscripts.set(email, new Map());
                  }
                  const memChunkMap = finalSessionCheck.chunkTranscripts.get(email)!;
                  for (const [chunkIdx, transcript] of dbChunkMap.entries()) {
                    memChunkMap.set(chunkIdx, transcript);
                  }
                }
                for (const [email, dbStatusMap] of latestDbSession.chunkTranscriptionStatus.entries()) {
                  if (!finalSessionCheck.chunkTranscriptionStatus.has(email)) {
                    finalSessionCheck.chunkTranscriptionStatus.set(email, new Map());
                  }
                  const memStatusMap = finalSessionCheck.chunkTranscriptionStatus.get(email)!;
                  for (const [chunkIdx, status] of dbStatusMap.entries()) {
                    memStatusMap.set(chunkIdx, status);
                  }
                }
                // Also merge final chunks received status
                for (const email of latestDbSession.finalChunksReceived) {
                  finalSessionCheck.finalChunksReceived.add(email);
                }
              }
            }
            
            // Final verification check with latest state
            const finalVerification = areAllChunksTranscribed(finalSessionCheck);
            
            // Also verify that all participants have received their final chunks
            const allParticipants = Array.from(finalSessionCheck.participants.keys());
            const missingFinalChunks = allParticipants.filter(email => !finalSessionCheck.finalChunksReceived.has(email));
            
            if (finalVerification.allComplete && missingFinalChunks.length === 0) {
              console.log(`✅ All transcriptions now complete for call ${session.callId} (final verification passed). Triggering pending summary.`);
              // Remove from pending map
              pendingSummaries.delete(session.callId);
              // Trigger summary generation - only after absolute confirmation that all transcriptions are complete
              // Errors are handled internally and logged at appropriate levels
              generateMeetingDocSummary(pendingSummary.docId, pendingSummary.ownerEmail, pendingSummary.orgSlug)
                .catch((error) => {
                  // Additional catch is redundant but ensures no unhandled rejections
                  // Error is already logged in generateMeetingDocSummary
                });
            } else {
              if (!finalVerification.allComplete) {
                console.log(`⏳ Final verification shows incomplete transcriptions for call ${session.callId}. Will retry on next completion.`);
                console.log(`   Incomplete: ${finalVerification.incomplete.join(', ')}`);
              }
              if (missingFinalChunks.length > 0) {
                console.log(`⏳ Final verification shows missing final chunks from: ${missingFinalChunks.join(', ')}. Will retry on next completion.`);
              }
            }
          }
        }
        
        return transcriptText;
      } else if (transcript.status === 'error') {
        // Mark as failed
        session.chunkTranscriptionStatus.get(email)!.set(chunkIndex, 'failed');
        session.processingChunks.get(email)!.delete(chunkIndex);
        
        const errorMessage = transcript.error || 'Unknown error';
        
        // Log transcription error to file
        transcriptionLogger.error({
          event: 'transcription_failed',
          callId: session.callId,
          participantEmail: email,
          chunkIndex,
          assemblyaiJobId: jobId,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        }, `Chunk ${chunkIndex} transcription failed for ${email}: ${errorMessage}`);
        
        // Save to DB
        if (session.orgSlug) {
          try {
            const pool = await getOrgPoolBySlug(session.orgSlug);
            await pool.query(`
              UPDATE transcription_chunk_results
              SET status = 'failed', error_message = $1
              WHERE call_id = $2 AND participant_email = $3 AND chunk_index = $4
            `, [errorMessage, session.callId, email, chunkIndex]);
          } catch (dbError: any) {
            // Handle missing table gracefully
            if (dbError.code === '42P01') {
              console.warn(`⚠️ Database table 'transcription_chunk_results' does not exist. Please run migration.`);
            } else {
              console.error(`❌ Error updating chunk result in DB:`, dbError);
            }
          }
        }
        
        throw new Error(`Transcription failed: ${errorMessage}`);
      }
      
      // Still processing (queued or processing), wait and poll again
      await new Promise(resolve => setTimeout(resolve, TRANSCRIPTION_POLL_INTERVAL_MS));
    } catch (error: any) {
      if (error.message?.includes('Transcription failed') || error.message?.includes('Transcription timeout')) {
        throw error;
      }
      console.warn(`⚠️ Error polling transcription status for chunk ${chunkIndex}:`, error.message);
      await new Promise(resolve => setTimeout(resolve, TRANSCRIPTION_POLL_INTERVAL_MS));
    }
  }
  
  // Timeout - mark as failed
  transcriptionLogger.error({
    event: 'transcription_timeout',
    callId: session.callId,
    participantEmail: email,
    chunkIndex,
    assemblyaiJobId: jobId,
    waitDuration: TRANSCRIPTION_MAX_WAIT_MS,
    timestamp: new Date().toISOString(),
  }, `Chunk ${chunkIndex} transcription timed out for ${email} after ${TRANSCRIPTION_MAX_WAIT_MS}ms`);
  
  session.chunkTranscriptionStatus.get(email)!.set(chunkIndex, 'failed');
  session.processingChunks.get(email)!.delete(chunkIndex);
  
  if (session.orgSlug) {
    try {
      const pool = await getOrgPoolBySlug(session.orgSlug);
      await pool.query(`
        UPDATE transcription_chunk_results
        SET status = 'failed', error_message = $1
        WHERE call_id = $2 AND participant_email = $3 AND chunk_index = $4
      `, [`Timeout after ${TRANSCRIPTION_MAX_WAIT_MS}ms`, session.callId, email, chunkIndex]);
    } catch (dbError: any) {
      // Handle missing table gracefully
      if (dbError.code === '42P01') {
        console.warn(`⚠️ Database table 'transcription_chunk_results' does not exist. Please run migration.`);
      } else {
        console.error(`❌ Error updating chunk result in DB:`, dbError);
      }
    }
  }
  
  throw new Error(`Transcription timeout for chunk ${chunkIndex} after ${TRANSCRIPTION_MAX_WAIT_MS}ms`);
}

/**
 * Stitch chunk transcripts together, removing overlaps
 */
function stitchChunkTranscripts(
  session: TranscriptionSession,
  participantEmail: string
): string[] {
  const email = participantEmail.toLowerCase();
  const chunkTranscriptsMap = session.chunkTranscripts.get(email);
  
  if (!chunkTranscriptsMap || chunkTranscriptsMap.size === 0) {
    return [];
  }
  
  // Get all chunk indices and sort them
  const chunkIndices = Array.from(chunkTranscriptsMap.keys()).sort((a, b) => a - b);
  const stitched: string[] = [];
  
  for (let i = 0; i < chunkIndices.length; i++) {
    const chunkIndex = chunkIndices[i];
    const transcript = chunkTranscriptsMap.get(chunkIndex) || '';
    
    if (i === 0) {
      // First chunk - add as-is
      if (transcript.trim()) {
        stitched.push(transcript.trim());
      }
    } else {
      // Subsequent chunks - remove overlap with previous chunk
      const prevTranscript = chunkTranscriptsMap.get(chunkIndices[i - 1]) || '';
      
      // Simple overlap removal: find common words at the end of prev and start of current
      // This is a basic implementation - could be improved with more sophisticated text matching
      const prevWords = prevTranscript.trim().split(/\s+/);
      const currentWords = transcript.trim().split(/\s+/);
      
      // Find overlap (last N words of prev match first N words of current)
      let overlapLength = 0;
      const maxOverlap = Math.min(prevWords.length, currentWords.length, 10); // Max 10 words overlap
      
      for (let j = 1; j <= maxOverlap; j++) {
        const prevSuffix = prevWords.slice(-j).join(' ').toLowerCase();
        const currentPrefix = currentWords.slice(0, j).join(' ').toLowerCase();
        if (prevSuffix === currentPrefix) {
          overlapLength = j;
        }
      }
      
      // Add current transcript without overlap
      if (overlapLength > 0) {
        const remainingWords = currentWords.slice(overlapLength);
        if (remainingWords.length > 0) {
          stitched.push(remainingWords.join(' '));
        }
      } else {
        // No overlap detected, add full transcript
        if (transcript.trim()) {
          stitched.push(transcript.trim());
        }
      }
    }
  }
  
  return stitched;
}

// Process AudioChunkReady event from Pub/Sub
async function processAudioChunk(message: any): Promise<void> {
  let data: any;
  try {
    // Pub/Sub messages can have json property or need to parse data
    if (message.json) {
      data = message.json;
    } else if (message.data) {
      data = JSON.parse(message.data.toString());
    } else {
      console.error('❌ Message has no json or data property:', message);
      message.nack();
      return;
    }
  } catch (error: any) {
    console.error('❌ Error parsing message:', error);
    message.nack();
    return;
  }
  
  // Handle both old format (for backward compatibility) and new AudioChunkReady format
  const eventType = data.event;
  const isAudioChunkReady = eventType === 'audio_chunk_ready';
  
  const { callId, participantEmail, storageUrl, chunkIndex, orgSlug, isFinal } = data;
  const chunkIdx = chunkIndex !== undefined ? chunkIndex : (data.segmentIndex !== undefined ? data.segmentIndex : 0);

  console.log(`🎤 Processing ${isAudioChunkReady ? 'AudioChunkReady' : 'audio chunk'} event for ${participantEmail} in call ${callId} (chunk ${chunkIdx}${isFinal ? ', final' : ''})`);

  // Get session
  let session: TranscriptionSession | undefined = activeSessions.get(callId);
  if (!session) {
    // Try to load from DB if orgSlug is available
    if (orgSlug) {
      const loadedSession = await loadSessionFromDB(callId, orgSlug);
      if (loadedSession) {
        session = loadedSession;
        activeSessions.set(callId, session);
        console.log(`📝 Loaded transcription session from DB for call ${callId}`);
      }
    }
    
    // If still no session, auto-start transcription session
    if (!session) {
      console.log(`📝 No transcription session found for call ${callId}, auto-starting...`);
      try {
        const participants = [{ email: participantEmail }];
        await startTranscriptionSession(callId, data.roomName || callId, participants, orgSlug);
        session = activeSessions.get(callId);
        if (!session) {
          console.error(`❌ Failed to create transcription session for call ${callId}`);
          message.nack();
          return;
        }
        console.log(`✅ Auto-started transcription session for call ${callId}`);
      } catch (error: any) {
        console.error(`❌ Error auto-starting transcription session:`, error);
        message.nack();
        return;
      }
    }
  }

  if (!session) {
    console.error(`❌ No transcription session available for call ${callId} after all attempts`);
    message.nack();
    return;
  }

  const email = participantEmail.toLowerCase();
  
  // Initialize maps if needed
  if (!session.processedChunks.has(email)) {
    session.processedChunks.set(email, new Set());
  }
  if (!session.processingChunks.has(email)) {
    session.processingChunks.set(email, new Set());
  }
  
  const processedChunks = session.processedChunks.get(email)!;
  const processingChunks = session.processingChunks.get(email)!;
  
  // Check if this chunk has already been processed
  if (processedChunks.has(chunkIdx)) {
    if (isFinal) {
      // Final chunks should always be processed - they may contain updated audio
      // Remove from processedChunks to allow reprocessing
      console.log(`🔄 Processing final chunk ${chunkIdx} for ${email} (updating existing record)`);
      processedChunks.delete(chunkIdx);
      // Also remove from processingChunks if it's there (shouldn't be, but be safe)
      if (processingChunks.has(chunkIdx)) {
        processingChunks.delete(chunkIdx);
      }
      // Continue processing...
    } else {
      console.log(`⏭️ Skipping duplicate chunk ${chunkIdx} for ${email} (already processed)`);
      message.ack();
      return;
    }
  }
  
  // Check if this chunk is currently being processed
  if (processingChunks.has(chunkIdx)) {
    console.log(`⏳ Chunk ${chunkIdx} already being processed for ${email}, skipping concurrent attempt`);
    message.nack(); // Nack to retry later
    return;
  }
  
  // Mark chunk as processing
  processingChunks.add(chunkIdx);
  
  try {
    // Transcribe chunk in parallel (respect concurrent job limits)
    // Check current concurrent jobs for this participant
    const currentJobs = Array.from(session.chunkTranscriptionStatus.get(email)?.values() || [])
      .filter(status => status === 'processing' || status === 'pending').length;
    
    if (currentJobs >= ASSEMBLYAI_MAX_CONCURRENT_JOBS) {
      // Too many concurrent jobs, nack and retry later
      console.log(`⏳ Too many concurrent transcription jobs (${currentJobs}), deferring chunk ${chunkIdx} for ${email}`);
      processingChunks.delete(chunkIdx);
      setTimeout(() => {
        message.nack();
      }, 5000); // Retry in 5 seconds
      return;
    }
    
    // Transcribe chunk (starts job and polls in background)
    await transcribeAudioChunk(session, participantEmail, chunkIdx, storageUrl);
    
    // Note: Chunk is marked as "processing" - it will be marked as "processed" when transcription completes
    // We don't remove from processingChunks here - that happens in pollTranscriptionStatus when complete
    
    // Track if this is a final chunk
    if (isFinal) {
      session.finalChunksReceived.add(email);
      console.log(`✅ Final chunk received for ${email} (transcription in progress)`);
    }
    
    // Ack the message - transcription is in progress
    message.ack();
  } catch (error: any) {
    // On error, remove from processing set so it can be retried
    processingChunks.delete(chunkIdx);
    
    if (error.code === 404 || error.code === 'ENOENT') {
      // File not ready yet
      const waitTime = isFinal ? 10000 : 3000;
      console.log(`⏳ File not ready yet for chunk ${chunkIdx}, will retry in ${waitTime}ms`);
      setTimeout(() => {
        message.nack();
      }, waitTime);
    } else {
      console.error(`❌ Error processing chunk ${chunkIdx} for ${email}:`, error);
      setTimeout(() => {
        message.nack();
      }, 2000);
    }
  }
}

// Get API key from Secret Manager for leanworks-app API
async function getApiKeyFromSecretManager(): Promise<string> {
  const projectId = getProjectId();
  if (!secretManagerClient) {
    const serviceAccountPath = join(__dirname, '../../gcp_credential.json');
    if (existsSync(serviceAccountPath)) {
      secretManagerClient = new SecretManagerServiceClient({
        keyFilename: serviceAccountPath,
      });
    } else {
      secretManagerClient = new SecretManagerServiceClient();
    }
  }

  try {
    const secretName = `projects/${projectId}/secrets/api-key/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
    const apiKey = version.payload?.data?.toString() || '';
    
    if (apiKey) {
      return apiKey;
    } else {
      throw new Error('API key is empty');
    }
  } catch (error) {
    console.error('❌ Failed to fetch API key from Secret Manager:', error);
    // Fallback to environment variable for local development
    const fallbackKey = process.env.ASK_API_KEY || '7aeCdl+e5wtI/7PZFlGcUaWEM8Mf32AY7qSoThiO5WI=';
    console.log('⚠️ Using fallback API key from environment variable');
    return fallbackKey;
  }
}

// Call meeting doc summary API
async function generateMeetingDocSummary(
  docId: string,
  userEmail: string,
  orgSlug: string
): Promise<void> {
  try {
    // Determine the AI service URL
    const isLocalDev = process.env.NODE_ENV !== 'production';
    const aiServiceBase = isLocalDev 
      ? process.env.AI_SERVICE_URL || 'http://0.0.0.0:8081'
      : process.env.AI_SERVICE_URL || 'http://ask-api:80';
    
    // Use the correct endpoint path for doc summary
    const apiUrl = `${aiServiceBase}/api/doc-summary`;
    
    // Prepare request body with docId included
    const requestBody = {
      doc_id: docId,
      user_id: userEmail,
      org_slug: orgSlug,
    };
    
    // Prepare headers - use Bearer token for production, API key for local testing
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (isLocalDev) {
      // Local testing: use API key
      const apiKey = await getApiKeyFromSecretManager();
      headers['X-API-Key'] = apiKey;
    } else {
      // Production (GKE): use Bearer token
      const bearerToken = await getBearerTokenForUser(userEmail);
      if (bearerToken) {
        headers['Authorization'] = `Bearer ${bearerToken}`;
      } else {
        // Fallback to API key if Bearer token generation fails
        console.warn(`⚠️ Failed to generate Bearer token, falling back to API key for ${userEmail}`);
        const apiKey = await getApiKeyFromSecretManager();
        headers['X-API-Key'] = apiKey;
      }
    }
    
    // Make API call with timeout (30 seconds)
    console.log(`📡 Calling doc summary API: ${apiUrl} (GKE: ${!isLocalDev ? 'yes' : 'no'})`);
    console.log(`   Request body: doc_id=${docId}, user_id=${userEmail}, org_slug=${orgSlug}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        const errorMsg = `API call failed: ${response.status} ${response.statusText} - ${errorText}`;
        console.error(`❌ Doc summary API error for doc ${docId}:`, {
          url: apiUrl,
          status: response.status,
          statusText: response.statusText,
          error: errorText.substring(0, 500), // Limit error text length
          isLocalDev,
          hasBearerToken: !!headers['Authorization'],
          hasApiKey: !!headers['X-API-Key']
        });
        throw new Error(errorMsg);
      }
      
      const result = await response.json();
      console.log(`✅ Generated meeting doc summary for doc ${docId}:`, result);
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error('API call timed out after 30 seconds');
      }
      throw fetchError;
    }
  } catch (error: any) {
    // Log error at warning level since this is a background operation that doesn't affect the user
    // The summary can be regenerated later if needed
    const errorMessage = error.message || String(error);
    const isNetworkError = errorMessage.includes('fetch failed') || 
                          errorMessage.includes('ECONNREFUSED') ||
                          errorMessage.includes('ENOTFOUND') ||
                          errorMessage.includes('timeout');
    
    if (isNetworkError) {
      // Network errors are expected in some environments - log at debug level
      console.log(`ℹ️  Summary generation deferred for doc ${docId} (network issue: ${errorMessage}). Will retry on next access.`);
    } else {
      // Other errors (auth, API errors) - log at warning level
      console.warn(`⚠️  Summary generation failed for doc ${docId}: ${errorMessage}`);
    }
    // Don't throw - this is a background operation that shouldn't affect call ending
  }
}

/**
 * Check if all chunks for all participants are fully transcribed
 * Returns true if all chunks are completed, false otherwise
 */
function areAllChunksTranscribed(session: TranscriptionSession): { allComplete: boolean; incomplete: string[] } {
  const incomplete: string[] = [];
  
  for (const email of Array.from(session.participants.keys())) {
    const statusMap = session.chunkTranscriptionStatus.get(email);
    const processingChunksSet = session.processingChunks.get(email);
    
    // Check for chunks with 'processing' or 'pending' status
    if (statusMap) {
      const processing = Array.from(statusMap.values()).filter(s => s === 'processing' || s === 'pending');
      if (processing.length > 0) {
        incomplete.push(`${email} (${processing.length} chunks in status map)`);
      }
    }
    
    // Also check processingChunks set - chunks that are being processed but may not have status yet
    if (processingChunksSet && processingChunksSet.size > 0) {
      const chunkIndices = Array.from(processingChunksSet).sort((a, b) => a - b);
      incomplete.push(`${email} (${processingChunksSet.size} chunks in processing set: ${chunkIndices.join(', ')})`);
    }
  }
  
  return {
    allComplete: incomplete.length === 0,
    incomplete
  };
}

// Handle call ended event
async function handleCallEnded(message: any): Promise<void> {
  let data: any;
  try {
    if (message.json) {
      data = message.json;
    } else if (message.data) {
      data = JSON.parse(message.data.toString());
    } else {
      console.error('❌ Message has no json or data property:', message);
      message.nack();
      return;
    }
  } catch (error: any) {
    console.error('❌ Error parsing message:', error);
    message.nack();
    return;
  }
  
  const { callId, chatId, participants, orgSlug } = data;

  console.log(`🔚 Handling call ended for ${callId}`);
  console.log(`📋 Call ended data:`, {
    callId,
    chatId,
    participantsCount: participants?.length || 0,
    participants: participants?.map((p: any) => p.email) || [],
    orgSlug: orgSlug || 'missing'
  });

  // Get session - prefer in-memory, merge with DB if needed
  let session: TranscriptionSession | undefined = activeSessions.get(callId);
  if (!session && orgSlug) {
    // No in-memory session, load from DB
    const loadedSession = await loadSessionFromDB(callId, orgSlug);
    if (loadedSession) {
      session = loadedSession;
    }
  } else if (session && orgSlug) {
    // Session exists in memory, but also load from DB to merge any missing chunks
    const dbSession = await loadSessionFromDB(callId, orgSlug);
    if (dbSession) {
      // Merge chunk transcripts from DB into in-memory session
      for (const [email, dbChunkMap] of dbSession.chunkTranscripts.entries()) {
        if (!session.chunkTranscripts.has(email)) {
          session.chunkTranscripts.set(email, new Map());
        }
        const memChunkMap = session.chunkTranscripts.get(email)!;
        // Add any chunks from DB that aren't in memory
        for (const [chunkIndex, transcript] of dbChunkMap.entries()) {
          if (!memChunkMap.has(chunkIndex)) {
            memChunkMap.set(chunkIndex, transcript);
            console.log(`📥 Merged chunk ${chunkIndex} from DB for ${email}`);
          }
        }
      }
      
      // Also merge chunk transcription status, jobs, and storage URLs
      for (const [email, dbStatusMap] of dbSession.chunkTranscriptionStatus.entries()) {
        if (!session.chunkTranscriptionStatus.has(email)) {
          session.chunkTranscriptionStatus.set(email, new Map());
        }
        const memStatusMap = session.chunkTranscriptionStatus.get(email)!;
        for (const [chunkIndex, status] of dbStatusMap.entries()) {
          if (!memStatusMap.has(chunkIndex)) {
            memStatusMap.set(chunkIndex, status);
          }
        }
      }
      
      for (const [email, dbJobsMap] of dbSession.chunkTranscriptionJobs.entries()) {
        if (!session.chunkTranscriptionJobs.has(email)) {
          session.chunkTranscriptionJobs.set(email, new Map());
        }
        const memJobsMap = session.chunkTranscriptionJobs.get(email)!;
        for (const [chunkIndex, jobId] of dbJobsMap.entries()) {
          if (!memJobsMap.has(chunkIndex)) {
            memJobsMap.set(chunkIndex, jobId);
          }
        }
      }
      
      for (const [email, dbStorageMap] of dbSession.chunkStorageUrls.entries()) {
        if (!session.chunkStorageUrls.has(email)) {
          session.chunkStorageUrls.set(email, new Map());
        }
        const memStorageMap = session.chunkStorageUrls.get(email)!;
        for (const [chunkIndex, storageUrl] of dbStorageMap.entries()) {
          if (!memStorageMap.has(chunkIndex)) {
            memStorageMap.set(chunkIndex, storageUrl);
          }
        }
      }
      
      // Merge processed chunks
      for (const [email, dbProcessedSet] of dbSession.processedChunks.entries()) {
        if (!session.processedChunks.has(email)) {
          session.processedChunks.set(email, new Set());
        }
        const memProcessedSet = session.processedChunks.get(email)!;
        for (const chunkIndex of dbProcessedSet) {
          memProcessedSet.add(chunkIndex);
        }
      }
      
      const totalMergedChunks = Array.from(session.chunkTranscripts.values()).reduce((sum, map) => sum + map.size, 0);
      console.log(`✅ Merged DB chunks into in-memory session: ${totalMergedChunks} total chunks now available`);
    }
  }

  if (!session) {
    console.warn(`⚠️ No session found for call ${callId}`);
    message.ack();
    return;
  }

  // First, check if all chunks are already transcribed - if so, proceed immediately
  const initialCheck = areAllChunksTranscribed(session);
  let allTranscriptionsComplete = initialCheck.allComplete;
  
  if (initialCheck.allComplete) {
    console.log(`✅ All chunks are already transcribed! Proceeding immediately to merge and create doc.`);
  } else {
    // Wait for final chunks to be received and processed
    const MAX_WAIT_TIME_MS = 120000; // 2 minutes maximum
    const CHECK_INTERVAL_MS = 2000; // Check every 2 seconds (more frequent for faster response)
    const startWaitTime = Date.now();
    
    console.log(`⏳ Waiting for final chunks and transcriptions (max ${MAX_WAIT_TIME_MS / 1000}s)...`);
    console.log(`   Initial status: ${initialCheck.incomplete.join(', ')}`);
    
    while (Date.now() - startWaitTime < MAX_WAIT_TIME_MS) {
      const allParticipants = Array.from(session.participants.keys());
      const missingFinalChunks = allParticipants.filter(email => !session.finalChunksReceived.has(email));
      
      // CRITICAL: First wait for all final chunks to be received
      // This ensures we don't proceed before all chunks are published
      // If we check transcription status before final chunks are received, we might miss chunks
      // that are still being uploaded to GCS
      if (missingFinalChunks.length > 0) {
        const elapsed = Math.floor((Date.now() - startWaitTime) / 1000);
        const remaining = Math.floor((MAX_WAIT_TIME_MS - (Date.now() - startWaitTime)) / 1000);
        console.log(`⏳ Waiting for final chunks from: ${missingFinalChunks.join(', ')} (${elapsed}s elapsed, ${remaining}s remaining)`);
        await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
        continue; // Don't check transcription status until all final chunks are received
      }
      
      // Only after all final chunks are received, check if all chunks are transcribed
      const checkResult = areAllChunksTranscribed(session);
      
      if (checkResult.allComplete) {
        const elapsed = Math.floor((Date.now() - startWaitTime) / 1000);
        console.log(`✅ All chunk transcriptions completed after ${elapsed}s`);
        allTranscriptionsComplete = true;
        break;
      }
      
      const elapsed = Math.floor((Date.now() - startWaitTime) / 1000);
      const remaining = Math.floor((MAX_WAIT_TIME_MS - (Date.now() - startWaitTime)) / 1000);
      console.log(`⏳ Still waiting for transcriptions... (${elapsed}s elapsed, ${remaining}s remaining, incomplete: ${checkResult.incomplete.join(', ')})`);
      
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
    }
    
    // Final check - if still not complete after timeout, log warning but proceed
    const finalCheck = areAllChunksTranscribed(session);
    const allParticipants = Array.from(session.participants.keys());
    const stillMissingFinalChunks = allParticipants.filter(email => !session.finalChunksReceived.has(email));
    
    if (stillMissingFinalChunks.length > 0) {
      console.warn(`⚠️ Timeout: Still missing final chunks from: ${stillMissingFinalChunks.join(', ')}. Proceeding anyway.`);
    }
    
    if (!finalCheck.allComplete) {
      console.warn(`⚠️ Timeout: Some chunks not transcribed after ${MAX_WAIT_TIME_MS / 1000}s. Proceeding with available chunks.`);
      console.warn(`   Incomplete: ${finalCheck.incomplete.join(', ')}`);
      allTranscriptionsComplete = false;
    } else {
      // Double-check: if final check shows complete, update flag
      allTranscriptionsComplete = true;
    }
  }
  
  // Stitch all chunk transcripts together
  console.log(`📝 Stitching chunk transcripts...`);
  for (const email of Array.from(session.participants.keys())) {
    // Print all chunk transcripts before stitching
    const chunkTranscriptsMap = session.chunkTranscripts.get(email);
    if (chunkTranscriptsMap && chunkTranscriptsMap.size > 0) {
      const chunkIndices = Array.from(chunkTranscriptsMap.keys()).sort((a, b) => a - b);
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📄 All Chunk Transcripts for ${email} (${chunkIndices.length} chunks):`);
      console.log(`${'='.repeat(80)}`);
      for (const chunkIndex of chunkIndices) {
        const transcript = chunkTranscriptsMap.get(chunkIndex) || '';
        console.log(`\n--- Chunk ${chunkIndex} Full Transcription ---`);
        console.log(transcript);
        console.log(`--- End of Chunk ${chunkIndex} ---\n`);
      }
      console.log(`${'='.repeat(80)}\n`);
    }
    
    const stitchedTranscripts = stitchChunkTranscripts(session, email);
    session.transcripts.set(email, stitchedTranscripts);
    console.log(`✅ Stitched ${stitchedTranscripts.length} transcript segments for ${email}`);
  }

  // Update session status in DB
  // Use orgSlug from event, or fall back to session.orgSlug
  const finalOrgSlug = orgSlug || session.orgSlug;
  if (finalOrgSlug) {
    try {
      const pool = await getOrgPoolBySlug(finalOrgSlug);
      
      // First, try to load any transcripts that might have been saved to DB during the call
      try {
        const dbResult = await pool.query(
          'SELECT transcripts FROM transcription_sessions WHERE call_id = $1',
          [callId]
        );
        if (dbResult.rows.length > 0 && dbResult.rows[0].transcripts) {
          const dbTranscripts = typeof dbResult.rows[0].transcripts === 'string' 
            ? JSON.parse(dbResult.rows[0].transcripts) 
            : dbResult.rows[0].transcripts;
          
          // Merge DB transcripts with in-memory transcripts
          for (const [email, transcriptArray] of Object.entries(dbTranscripts)) {
            const emailLower = email.toLowerCase();
            if (!session.transcripts.has(emailLower)) {
              session.transcripts.set(emailLower, []);
            }
            // Add any transcripts from DB that aren't already in memory
            const existing = session.transcripts.get(emailLower)!;
            const dbArray = transcriptArray as string[];
            for (const transcript of dbArray) {
              if (!existing.includes(transcript)) {
                existing.push(transcript);
              }
            }
          }
          console.log(`📥 Loaded transcripts from DB: ${Object.keys(dbTranscripts).length} participants`);
        }
      } catch (loadError: any) {
        console.warn(`⚠️ Could not load transcripts from DB:`, loadError.message);
      }
      
      const transcriptsObj: Record<string, string[]> = {};
      for (const [email, transcripts] of session.transcripts.entries()) {
        transcriptsObj[email] = transcripts;
      }

      // Log transcript summary
      const totalTranscripts = Array.from(session.transcripts.values()).reduce((sum, arr) => sum + arr.length, 0);
      console.log(`📊 Final transcript summary: ${session.transcripts.size} participants, ${totalTranscripts} transcript segments`);
      for (const [email, transcripts] of session.transcripts.entries()) {
        console.log(`   ${email}: ${transcripts.length} segments`);
      }

      await pool.query(`
        UPDATE transcription_sessions
        SET status = 'completed', completed_at = NOW(), transcripts = $1, updated_at = NOW()
        WHERE call_id = $2
      `, [JSON.stringify(transcriptsObj), callId]);

      // Create a single shared doc for all participants
      // Fallback to session participants if event doesn't have participants
      let participantsToUse = participants;
      if (!participantsToUse || participantsToUse.length === 0) {
        console.log(`⚠️ Event has no participants, falling back to session participants`);
        const sessionParticipantEmails = Array.from(session.participants.keys());
        if (sessionParticipantEmails.length > 0) {
          participantsToUse = sessionParticipantEmails.map(email => ({ email }));
          console.log(`✅ Using ${participantsToUse.length} participant(s) from session: ${sessionParticipantEmails.join(', ')}`);
        }
      }
      
      console.log(`📝 Checking if shared doc should be created: participants=${participantsToUse?.length || 0}, orgSlug=${orgSlug || 'missing'}`);
      if (participantsToUse && participantsToUse.length > 0) {
        console.log(`✅ Creating shared doc for ${participantsToUse.length} participant(s)`);
        const userInfoMap = await getUserInfoBatch(participantsToUse.map(p => p.email));
        const participantsWithNames = participantsToUse.map(p => {
          const info = userInfoMap.get(p.email.toLowerCase());
          return {
            email: p.email,
            name: info?.name || p.email,
          };
        });

        // Format transcript
        const formattedTranscript = formatTranscriptWithSpeakers(session.transcripts, new Map(
          participantsWithNames.map(p => [p.email.toLowerCase(), p])
        ));
        
        // Log if transcript is empty
        if (!formattedTranscript || formattedTranscript.trim().length === 0) {
          console.warn(`⚠️ No transcript content to include in doc for call ${callId}`);
          console.warn(`   Session transcripts Map size: ${session.transcripts.size}`);
          console.warn(`   Session transcripts keys: ${Array.from(session.transcripts.keys()).join(', ')}`);
        }

        // Determine projectId or teamId from chatId
        let projectId: string | null = null;
        let teamId: string | null = null;
        if (chatId) {
          if (chatId.startsWith('project-')) {
            projectId = chatId.replace('project-', '');
          } else if (chatId.startsWith('team-')) {
            teamId = chatId.replace('team-', '');
          }
        }

        const callDate = session.startTime;
        const callDateStr = callDate.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        // Create a single shared doc visible to all participants
        try {
          const docId = crypto.randomBytes(16).toString('hex');
          const docTitle = `Meeting Notes - ${callDateStr}`;
          
          // Use transcript if available, otherwise show a message
          const transcriptContent = formattedTranscript && formattedTranscript.trim().length > 0
            ? formattedTranscript
            : '<p><em>No transcript available for this call.</em></p>';
          
          const docContent = `
            <div>
              <h2>Voice Call Transcript</h2>
              <p><strong>Date:</strong> ${callDateStr}</p>
              <p><strong>Participants:</strong> ${participantsWithNames.map(p => p.name).join(', ')}</p>
              <hr>
              <div>
                ${transcriptContent}
              </div>
            </div>
          `;

          // Set owner to first participant (host), and make doc visible only to host and participants
          const ownerEmail = participantsWithNames[0].email.toLowerCase();
          // Ensure owner (host) is included in visibleToMembers along with all participants
          const visibleToMembers = participantsWithNames.map(p => p.email.toLowerCase());
          // Explicitly ensure owner is included (should already be there as first participant, but be explicit)
          if (!visibleToMembers.includes(ownerEmail)) {
            visibleToMembers.push(ownerEmail);
          }

          await pool.query(`
            INSERT INTO docs (id, title, content, owner_email, project_id, team_id, tags, visibility, visible_to_members, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          `, [
            docId,
            docTitle,
            docContent,
            ownerEmail,
            projectId,
            teamId,
            JSON.stringify(['meeting', 'transcript']),
            'specific_members', // Visibility: only host and participants
            JSON.stringify(visibleToMembers)
          ]);

          console.log(`✅ Created shared meeting doc (docId: ${docId}) visible to ${visibleToMembers.length} participant(s): ${visibleToMembers.join(', ')}`);
          
          // Generate meeting doc summary asynchronously (only once for the shared doc)
          // IMPORTANT: Only generate summary if ALL transcriptions are complete
          if (finalOrgSlug && formattedTranscript && formattedTranscript.trim().length > 0 && allTranscriptionsComplete) {
            // Final verification: double-check that all transcriptions are actually complete
            // This ensures we never trigger summary generation before all transcriptions finish
            const finalVerification = areAllChunksTranscribed(session);
            if (!finalVerification.allComplete) {
              console.warn(`⚠️ Final verification failed: Not all transcriptions are complete. Deferring summary generation.`);
              console.warn(`   Incomplete: ${finalVerification.incomplete.join(', ')}`);
              // Store pending summary info so we can trigger it when all transcriptions complete
              pendingSummaries.set(callId, {
                docId,
                ownerEmail,
                orgSlug: finalOrgSlug,
                callId
              });
              console.log(`📝 Registered pending summary for call ${callId} (docId: ${docId})`);
            } else {
              console.log(`📊 All transcriptions complete (verified). Triggering summary generation for shared doc ${docId} (orgSlug: ${finalOrgSlug})`);
              try {
                // Call summary API in background (fire and forget)
                // Errors are handled internally and logged at appropriate levels
                // This will only execute after ALL transcriptions are confirmed complete
                generateMeetingDocSummary(docId, ownerEmail, finalOrgSlug)
                  .catch((error) => {
                    // Additional catch is redundant but ensures no unhandled rejections
                    // Error is already logged in generateMeetingDocSummary
                  });
              } catch (orgError: any) {
                console.warn(`⚠️ Could not get org slug for summary generation:`, orgError.message);
              }
            }
          } else if (finalOrgSlug && formattedTranscript && formattedTranscript.trim().length > 0 && !allTranscriptionsComplete) {
            console.warn(`⚠️ Skipping summary generation: Not all transcriptions are complete yet. Summary will be generated once all transcriptions finish.`);
            console.warn(`   Doc ${docId} created but summary deferred until all chunks are transcribed.`);
            // Store pending summary info so we can trigger it when all transcriptions complete
            pendingSummaries.set(callId, {
              docId,
              ownerEmail,
              orgSlug: finalOrgSlug,
              callId
            });
            console.log(`📝 Registered pending summary for call ${callId} (docId: ${docId})`);
          }
        } catch (docError: any) {
          console.error(`❌ Error creating shared doc:`, docError);
          console.error(`   Error details:`, docError.message, docError.stack);
        }
        console.log(`✅ Finished processing shared doc for ${participantsToUse.length} participant(s)`);
      } else {
        console.warn(`⚠️ Skipping doc creation: participants array is ${participantsToUse ? 'empty' : 'missing'}`);
        if (!finalOrgSlug) {
          console.warn(`⚠️ Also missing orgSlug, which is required for doc creation`);
        }
      }
    } catch (error: any) {
      console.error(`❌ Error finalizing session for call ${callId}:`, error);
      console.error(`   Error details:`, error.message, error.stack);
    }
  } else {
    console.warn(`⚠️ Cannot create docs: orgSlug is missing for call ${callId} (event orgSlug: ${orgSlug || 'missing'}, session orgSlug: ${session.orgSlug || 'missing'})`);
  }

  // Remove from active sessions
  activeSessions.delete(callId);
  message.ack();
  console.log(`✅ Call ended processing complete for ${callId}`);
}

// Format transcript with speaker labels
function formatTranscriptWithSpeakers(
  transcripts: Map<string, string[]>,
  participantMap: Map<string, { email: string; name: string }>
): string {
  const parts: string[] = [];
  
  // Combine all transcripts with timestamps (simplified - in production you'd want actual timestamps)
  const allTurns: Array<{ speaker: string; text: string; index: number }> = [];
  
  for (const [email, transcriptArray] of transcripts.entries()) {
    const participant = participantMap.get(email);
    const speakerName = participant?.name || email;
    
    transcriptArray.forEach((text, index) => {
      allTurns.push({ speaker: speakerName, text, index });
    });
  }
  
  // Sort by index (simplified - in production you'd want actual timestamps)
  allTurns.sort((a, b) => a.index - b.index);
  
  // Format as HTML
  for (const turn of allTurns) {
    parts.push(`<p><strong>${turn.speaker}:</strong> ${turn.text}</p>`);
  }
  
  return parts.join('\n');
}

// Handle transcription started event
async function handleTranscriptionStarted(message: any): Promise<void> {
  let data: any;
  try {
    if (message.json) {
      data = message.json;
    } else if (message.data) {
      data = JSON.parse(message.data.toString());
    } else {
      console.error('❌ Message has no json or data property:', message);
      message.nack();
      return;
    }
  } catch (error: any) {
    console.error('❌ Error parsing message:', error);
    message.nack();
    return;
  }
  
  const { callId, roomName, participants, orgSlug } = data;

  console.log(`📝 Handling transcription started for call ${callId}`);

  try {
    await startTranscriptionSession(callId, roomName, participants || [], orgSlug);
    message.ack();
  } catch (error: any) {
    console.error(`❌ Error starting transcription session:`, error);
    message.nack();
  }
}

// Main worker function
export async function startWorker(): Promise<void> {
  console.log('🚀 Starting transcription worker...');

  const pubsub = getPubSubClient();
  const audioChunksTopic = process.env.PUBSUB_AUDIO_CHUNKS_TOPIC || 'audio-chunks';
  const callEventsTopic = process.env.PUBSUB_CALL_EVENTS_TOPIC || 'call-events';
  const audioChunksSub = process.env.PUBSUB_AUDIO_CHUNKS_SUBSCRIPTION || 'transcription-workers';
  const callEventsSub = process.env.PUBSUB_CALL_EVENTS_SUBSCRIPTION || 'transcription-workers-call-events';

  // Get or create topics
  const audioChunksTopicObj = pubsub.topic(audioChunksTopic);
  const [audioTopicExists] = await audioChunksTopicObj.exists();
  if (!audioTopicExists) {
    console.warn(`⚠️ Topic ${audioChunksTopic} does not exist. Creating...`);
    await pubsub.createTopic(audioChunksTopic);
  }

  const callEventsTopicObj = pubsub.topic(callEventsTopic);
  const [callTopicExists] = await callEventsTopicObj.exists();
  if (!callTopicExists) {
    console.warn(`⚠️ Topic ${callEventsTopic} does not exist. Creating...`);
    await pubsub.createTopic(callEventsTopic);
  }

  // Get or create subscriptions
  let audioChunksSubscription = pubsub.subscription(audioChunksSub);
  const [audioSubExists] = await audioChunksSubscription.exists();
  if (!audioSubExists) {
    console.warn(`⚠️ Subscription ${audioChunksSub} does not exist. Creating...`);
    await pubsub.createSubscription(audioChunksTopic, audioChunksSub, {
      ackDeadlineSeconds: 60,
      messageRetentionDuration: { seconds: 7 * 24 * 60 * 60 }, // 7 days
    });
    audioChunksSubscription = pubsub.subscription(audioChunksSub);
  }

  let callEventsSubscription = pubsub.subscription(callEventsSub);
  const [callSubExists] = await callEventsSubscription.exists();
  if (!callSubExists) {
    console.warn(`⚠️ Subscription ${callEventsSub} does not exist. Creating...`);
    await pubsub.createSubscription(callEventsTopic, callEventsSub, {
      ackDeadlineSeconds: 60,
      messageRetentionDuration: { seconds: 7 * 24 * 60 * 60 }, // 7 days
    });
    callEventsSubscription = pubsub.subscription(callEventsSub);
  }

  // Subscribe to audio chunks
  audioChunksSubscription.on('message', processAudioChunk);
  console.log(`✅ Subscribed to ${audioChunksSub} for topic ${audioChunksTopic}`);

  // Subscribe to call events
  callEventsSubscription.on('message', (message: any) => {
    let data: any;
    try {
      if (message.json) {
        data = message.json;
      } else if (message.data) {
        data = JSON.parse(message.data.toString());
      } else {
        console.error('❌ Message has no json or data property:', message);
        message.nack();
        return;
      }
    } catch (error: any) {
      console.error('❌ Error parsing message:', error);
      message.nack();
      return;
    }
    
    if (data.event === 'transcription_started') {
      handleTranscriptionStarted(message);
    } else if (data.event === 'call_ended') {
      handleCallEnded(message);
    } else {
      console.warn(`⚠️ Unknown call event: ${data?.event || 'unknown'}`);
      message.ack();
    }
  });
  console.log(`✅ Subscribed to ${callEventsSub} for topic ${callEventsTopic}`);

  console.log('✅ Transcription worker started and listening for messages');
}

