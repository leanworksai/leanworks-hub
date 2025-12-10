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
import { Readable } from 'stream';
import { getOrgPool, getUserInfoBatch } from '../../database/multi-tenant-pool.js';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize clients
let pubsubClient: PubSub | null = null;
let storageClient: Storage | null = null;
let assemblyAIClient: AssemblyAI | null = null;
let secretManagerClient: SecretManagerServiceClient | null = null;

// Active transcription sessions (in-memory for worker, but also persisted to DB)
interface TranscriptionSession {
  callId: string;
  roomName: string;
  participants: Map<string, { email: string; name?: string }>;
  transcribers: Map<string, any>; // AssemblyAI StreamingTranscriber per participant
  audioStreams: Map<string, Readable>; // Readable streams for piping audio to transcribers
  transcripts: Map<string, string[]>; // Transcripts per participant
  startTime: Date;
  orgId?: string;
  processedSegments: Map<string, Set<number>>; // Track processed segments per participant (email -> Set<segmentIndex>)
  lastProcessedBytes: Map<string, number>; // Track last processed byte position per participant (email -> bytes)
  finalChunksReceived: Set<string>; // Track which participants have received final chunks (email -> true)
}

const activeSessions = new Map<string, TranscriptionSession>();
const pendingChunks = new Map<string, Array<{ message: any; data: any }>>(); // Queue chunks that arrive before session is ready

// Add near top with other Maps
const transcriptionSessionLocks = new Map<string, Promise<void>>();

// AssemblyAI has a 1MB frame size limit, so we chunk audio into smaller pieces
// AssemblyAI requires chunks between 50-1000ms duration
// At 16kHz PCM (16-bit): 1000ms = 16,000 samples * 2 bytes = 32,000 bytes
// Use 30KB to ensure we stay well under the 1000ms limit
const MAX_CHUNK_SIZE = 30 * 1024; // 30KB chunks (ensures <1000ms at 16kHz)
// At 16kHz PCM, 30KB ≈ 937ms of audio
// Send chunks at ~1x real-time speed (slightly faster for buffering, but not 8x)
const CHUNK_INTERVAL_MS = 900; // Send 30KB chunks every 900ms (~1.04x real-time)

/**
 * Push audio buffer to stream in chunks to meet AssemblyAI's requirements:
 * - Maximum frame size: 1MB
 * - Duration limit: 50-1000ms per chunk
 * - Rate limit: Must send at approximately real-time speed to avoid "Audio Transmission Rate Exceeded" error
 * At 16kHz PCM (16-bit), 1000ms = 32KB, so we use 30KB chunks to stay safe
 */
async function pushAudioInChunks(stream: Readable, audioBuffer: Buffer): Promise<void> {
  let offset = 0;
  while (offset < audioBuffer.length) {
    const chunk = audioBuffer.slice(offset, Math.min(offset + MAX_CHUNK_SIZE, audioBuffer.length));
    stream.push(chunk);
    offset += MAX_CHUNK_SIZE;
    
    // Rate limit: wait before sending next chunk to avoid exceeding AssemblyAI's rate limit
    // Only wait if there's more data to send
    if (offset < audioBuffer.length) {
      await new Promise(resolve => setTimeout(resolve, CHUNK_INTERVAL_MS));
    }
  }
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
async function loadSessionFromDB(callId: string, orgId?: string): Promise<TranscriptionSession | null> {
  if (!orgId) {
    console.warn(`⚠️ Cannot load session from DB without orgId for call ${callId}`);
    return null;
  }

  try {
    const pool = await getOrgPool(orgId);
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

    // Load processed segments from transcription_chunks table
    const chunksResult = await pool.query(
      'SELECT participant_email, chunk_index, storage_url FROM transcription_chunks WHERE call_id = $1',
      [callId]
    );

    const processedSegments = new Map<string, Set<number>>();
    const lastProcessedBytes = new Map<string, number>();
    const storageUrlsByEmail = new Map<string, string>();

    for (const chunkRow of chunksResult.rows) {
      const email = chunkRow.participant_email.toLowerCase();
      if (!processedSegments.has(email)) {
        processedSegments.set(email, new Set());
      }
      processedSegments.get(email)!.add(chunkRow.chunk_index);
      
      // Store the latest storage URL for each participant (they should all point to the same file)
      if (chunkRow.storage_url) {
        storageUrlsByEmail.set(email, chunkRow.storage_url);
      }
    }

    // Try to estimate lastProcessedBytes by checking GCS file size
    // If we've processed all segments up to a certain point, we can estimate bytes
    const storage = getStorageClient();
    for (const [email, storageUrl] of storageUrlsByEmail.entries()) {
      try {
        const [bucketName, ...pathParts] = storageUrl.replace('gs://', '').split('/');
        const filePath = pathParts.join('/');
        const file = storage.bucket(bucketName).file(filePath);
        const [metadata] = await file.getMetadata();
        const fileSize = parseInt(String(metadata.size || '0'), 10);
        
        // If file exists and has size, use it as an estimate
        // The actual processed bytes might be less, but this gives us a starting point
        // The deduplication logic will prevent re-processing
        if (fileSize > 0) {
          lastProcessedBytes.set(email, fileSize);
          console.log(`📊 Estimated lastProcessedBytes for ${email}: ${fileSize} bytes (from GCS file size)`);
        }
      } catch (error: any) {
        console.warn(`⚠️ Could not get file size for ${email} from ${storageUrl}:`, error.message);
        // Set to 0 if we can't determine
        lastProcessedBytes.set(email, 0);
      }
    }

    const session: TranscriptionSession = {
      callId: row.call_id,
      roomName: row.room_name,
      participants,
      transcribers: new Map(),
      audioStreams: new Map(),
      transcripts: new Map(),
      startTime: row.started_at,
      orgId,
      processedSegments, // Restored from DB
      lastProcessedBytes, // Estimated from GCS file sizes
      finalChunksReceived: new Set(), // Initialize empty - will be populated as final chunks arrive
    };

    // Load transcripts from DB
    const transcriptsData = row.transcripts ? (typeof row.transcripts === 'string' ? JSON.parse(row.transcripts) : row.transcripts) : {};
    for (const [email, transcriptArray] of Object.entries(transcriptsData)) {
      session.transcripts.set(email.toLowerCase(), transcriptArray as string[]);
    }

    console.log(`📝 Loaded session from DB: ${processedSegments.size} participants with processed segments, ${Array.from(processedSegments.values()).reduce((sum, set) => sum + set.size, 0)} total segments processed`);

    return session;
  } catch (error: any) {
    console.error(`❌ Error loading session from DB for call ${callId}:`, error);
    return null;
  }
}

// Save transcription session to database
async function saveSessionToDB(session: TranscriptionSession): Promise<void> {
  if (!session.orgId) {
    console.warn(`⚠️ Cannot save session to DB without orgId for call ${session.callId}`);
    return;
  }

  try {
    const pool = await getOrgPool(session.orgId);
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

// Helper function to create and set up a transcriber for a participant
async function setupTranscriberForParticipant(
  session: TranscriptionSession,
  participant: { email: string; name?: string },
  assemblyAI: any // AssemblyAI client
): Promise<void> {
  const email = participant.email.toLowerCase();
  
  try {
    const transcriber = assemblyAI.streaming.transcriber({
      sampleRate: 16000, // 16kHz
      formatTurns: true,
    });

    let transcriberReady = false;
    const transcriberReadyPromise = new Promise<void>((resolve) => {
      const openHandler = ({ id }: { id: string }) => {
        transcriberReady = true;
        console.log(`✅ Transcription session opened for ${email}, ID: ${id}`);
        resolve();
      };
      transcriber.on('open', openHandler);
    });

    transcriber.on('turn', (turn: any) => {
      if (turn.transcript && turn.transcript.trim()) {
        if (!session.transcripts.has(email)) {
          session.transcripts.set(email, []);
        }
        session.transcripts.get(email)!.push(turn.transcript);
        console.log(`📝 Transcript for ${email}: ${turn.transcript}`);
        
        // Save to DB periodically
        saveSessionToDB(session).catch(console.error);
      }
    });

    transcriber.on('error', (error: any) => {
      console.error(`❌ Transcription error for ${email}:`, error);
    });

    transcriber.on('close', (code: number, reason: string) => {
      console.log(`🔌 Transcription connection closed for ${email}: ${code} - ${reason}`);
    });

    const audioStream = new Readable({
      read() {},
      objectMode: false,
      highWaterMark: 64 * 1024,
    });

    // Connect transcriber (non-blocking)
    transcriber.connect().catch((error: any) => {
      console.error(`❌ Error connecting transcriber for ${email}:`, error);
    });

    // Wait for transcriber to be ready in background
    transcriberReadyPromise.then(() => {
      console.log(`✅ Transcriber ready for ${email}`);
    }).catch(console.error);

    // Pipe audio stream to transcriber
    if (typeof Readable.toWeb === 'function') {
      const webStream = Readable.toWeb(audioStream);
      const transcriberStream = transcriber.stream();
      const writer = transcriberStream.getWriter();
      const reader = webStream.getReader();

      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              await writer.close();
              break;
            }
            if (value && transcriberReady) {
              await writer.write(value);
            }
          }
        } catch (error: any) {
          console.error(`❌ Error piping audio to transcriber for ${email}:`, error);
          try {
            await writer.abort();
          } catch {}
        } finally {
          reader.releaseLock();
        }
      })();
    }

    session.transcribers.set(email, transcriber);
    session.audioStreams.set(email, audioStream);
  } catch (error: any) {
    console.error(`❌ Error setting up transcriber for ${email}:`, error);
  }
}

// Start transcription session
async function startTranscriptionSession(
  callId: string,
  roomName: string,
  participants: Array<{ email: string; name?: string }>,
  orgId?: string
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
  if (!session && orgId) {
    const loadedSession = await loadSessionFromDB(callId, orgId);
    if (loadedSession) {
      session = loadedSession;
      activeSessions.set(callId, session);
      sessionLoadedFromDB = true;
      console.log(`📝 Loaded transcription session from DB for call ${callId}, will recreate transcribers`);
    }
  }

  if (session && !sessionLoadedFromDB) {
    console.log(`📝 Transcription session already exists for call ${callId}`);
    return;
  }

  const assemblyAI = await getAssemblyAIClient();

  // If session was loaded from DB, we need to recreate transcribers
  // If it's a new session, create it fresh
  if (!session) {
    session = {
      callId,
      roomName,
      participants: new Map(participants.map(p => [p.email.toLowerCase(), p])),
      transcribers: new Map(),
      audioStreams: new Map(),
      transcripts: new Map(),
      startTime: new Date(),
      orgId,
      processedSegments: new Map(), // Track processed segments per participant
      lastProcessedBytes: new Map(), // Track last processed byte position per participant
      finalChunksReceived: new Set(), // Track which participants have received final chunks
    };
  } else {
    // Session loaded from DB - ensure participants match
    // Add any new participants that weren't in the DB
    for (const participant of participants) {
      const email = participant.email.toLowerCase();
      if (!session.participants.has(email)) {
        session.participants.set(email, participant);
      }
    }
  }

  // Create/recreate streaming transcriber for each participant
  // This is needed both for new sessions and sessions restored from DB
  for (const participant of Array.from(session.participants.values())) {
    const email = participant.email.toLowerCase();
    
    // If transcriber already exists (shouldn't happen for DB-loaded sessions, but check anyway)
    if (session.transcribers.has(email) && session.audioStreams.has(email)) {
      console.log(`📝 Transcriber already exists for ${email}, skipping recreation`);
      continue;
    }
    
    await setupTranscriberForParticipant(session, participant, assemblyAI);
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

// Process audio chunk from Pub/Sub
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
  
  const { callId, participantEmail, storageUrl, chunkIndex, segmentIndex, orgId, isFinal } = data;
  const segmentIdx = segmentIndex !== undefined ? segmentIndex : chunkIndex; // Support both field names

  console.log(`🎤 Processing audio chunk for ${participantEmail} in call ${callId} (segment ${segmentIdx}${isFinal ? ', final' : ''})`);

  // Get session
  let session: TranscriptionSession | undefined = activeSessions.get(callId);
  if (!session) {
    // Try to load from DB if orgId is available
    if (data.orgId) {
      const loadedSession = await loadSessionFromDB(callId, data.orgId);
      if (loadedSession) {
        session = loadedSession;
        activeSessions.set(callId, session);
        console.log(`📝 Loaded transcription session from DB for call ${callId}`);
      }
    }
    
    // If still no session, queue the chunk for later processing
    if (!session) {
      const segmentIdx = data.segmentIndex !== undefined ? data.segmentIndex : chunkIndex;
      console.warn(`⚠️ No active session for call ${callId}, queuing segment ${segmentIdx} for later`);
      if (!pendingChunks.has(callId)) {
        pendingChunks.set(callId, []);
      }
      pendingChunks.get(callId)!.push({ message, data });
      // Don't ack or nack - we'll process it when session is ready
      return;
    }
  }

  const email = participantEmail.toLowerCase();
  const audioStream = session.audioStreams.get(email);
  
  if (!audioStream) {
    console.warn(`⚠️ No audio stream for ${email} in call ${callId}`);
    message.nack();
    return;
  }

  try {
    // Check if this segment has already been processed (deduplication)
    if (!session.processedSegments.has(email)) {
      session.processedSegments.set(email, new Set());
    }
    const processedSegments = session.processedSegments.get(email)!;
    
    if (processedSegments.has(segmentIdx)) {
      console.log(`⏭️ Skipping duplicate segment ${segmentIdx} for ${email} (already processed)`);
      message.ack(); // Ack to remove from queue, but don't process again
      return;
    }
    
    // Download audio from Cloud Storage
    const storage = getStorageClient();
    const [bucketName, ...pathParts] = storageUrl.replace('gs://', '').split('/');
    const filePath = pathParts.join('/');
    const file = storage.bucket(bucketName).file(filePath);
    
    // For streaming uploads, only download new data (bytes we haven't processed yet)
    let lastProcessedByte = session.lastProcessedBytes.get(email) || 0;
    
    try {
      // Get file metadata to check current size
      const [metadata] = await file.getMetadata();
      const currentSize = parseInt(String(metadata.size || '0'), 10);
      
      if (currentSize <= lastProcessedByte) {
        // Validate: lastProcessedByte should never exceed file size
        if (lastProcessedByte > currentSize) {
          console.warn(`⚠️ Invalid state: lastProcessedByte (${lastProcessedByte}) > file size (${currentSize}) for ${email}. This indicates a mismatch - possibly wrong file or session state corruption. Resetting to 0.`);
          session.lastProcessedBytes.set(email, 0);
          lastProcessedByte = 0; // Update local variable to use reset value
          // Continue processing from beginning (processedSegments will prevent duplicates)
        } else {
          // No new data, skip this segment
          console.log(`⏭️ No new data for segment ${segmentIdx} (file size: ${currentSize}, last processed: ${lastProcessedByte})`);
          message.ack();
          return;
        }
      }
      
      // Download only the new portion of the file
      // Note: lastProcessedByte might have been reset to 0 above
      const [audioBuffer] = await file.download({
        start: lastProcessedByte,
        end: isFinal ? undefined : currentSize, // Download up to current size, or all if final
      });
      
      // Push to audio stream only if we have new data
      // Chunk into smaller pieces to avoid exceeding AssemblyAI's 1MB frame limit
      if (audioBuffer.length > 0) {
        await pushAudioInChunks(audioStream, audioBuffer);
        session.lastProcessedBytes.set(email, lastProcessedByte + audioBuffer.length);
        console.log(`📥 Downloaded ${audioBuffer.length} new bytes for ${email} (total processed: ${lastProcessedByte + audioBuffer.length}/${currentSize}, chunked into ${Math.ceil(audioBuffer.length / MAX_CHUNK_SIZE)} pieces)`);
      }
      
      // Mark segment as processed
      processedSegments.add(segmentIdx);
      
      // Mark chunk as processed in DB
      if (session.orgId) {
        const pool = await getOrgPool(session.orgId);
        await pool.query(`
          INSERT INTO transcription_chunks (call_id, participant_email, chunk_index, storage_url, processed_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT DO NOTHING
        `, [callId, email, segmentIdx, storageUrl]);
      }

      message.ack();
      console.log(`✅ Processed audio segment ${segmentIdx} for ${email}${isFinal ? ' (final)' : ''}`);
      
      // Track if this is a final chunk
      if (isFinal) {
        if (!session.finalChunksReceived) {
          session.finalChunksReceived = new Set();
        }
        session.finalChunksReceived.add(email);
        console.log(`✅ Final chunk received and processed for ${email}`);
      }
    } catch (metadataError: any) {
      // If metadata fetch fails, try downloading the entire file (fallback)
      console.warn(`⚠️ Could not get file metadata, downloading entire file:`, metadataError.message);
      const [audioBuffer] = await file.download();
      
      if (audioBuffer.length > 0) {
        // Only push if we haven't processed this exact size before
        const lastSize = session.lastProcessedBytes.get(email) || 0;
        if (audioBuffer.length > lastSize) {
          const newData = audioBuffer.slice(lastSize);
          // Chunk into smaller pieces to avoid exceeding AssemblyAI's 1MB frame limit
          await pushAudioInChunks(audioStream, newData);
          // FIX: Should be lastSize + newData.length, not just audioBuffer.length
          // This correctly tracks total processed bytes
          session.lastProcessedBytes.set(email, lastSize + newData.length);
        }
      }
      
      processedSegments.add(segmentIdx);
      
      if (session.orgId) {
        const pool = await getOrgPool(session.orgId);
        await pool.query(`
          INSERT INTO transcription_chunks (call_id, participant_email, chunk_index, storage_url, processed_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT DO NOTHING
        `, [callId, email, segmentIdx, storageUrl]);
      }
      
      message.ack();
      console.log(`✅ Processed audio segment ${segmentIdx} for ${email} (fallback mode)${isFinal ? ' (final)' : ''}`);
      
      // Track if this is a final chunk (fallback mode)
      if (isFinal) {
        if (!session.finalChunksReceived) {
          session.finalChunksReceived = new Set();
        }
        session.finalChunksReceived.add(email);
        console.log(`✅ Final chunk received and processed for ${email} (fallback mode)`);
      }
    }
  } catch (error: any) {
    // If file doesn't exist yet (streaming in progress), that's okay - we'll retry later
    if (error.code === 404 || error.code === 'ENOENT') {
      // For final segments, wait longer for the file to be finalized (prioritizing stability)
      if (isFinal) {
        console.log(`⏳ File not ready yet for final segment ${segmentIdx}, waiting longer before retry...`);
        // Wait 10 seconds before retrying final segments (file might still be closing/uploading)
        setTimeout(() => {
          message.nack(); // Nack to retry later
        }, 10000);
      } else {
        console.log(`⏳ File not ready yet for segment ${segmentIdx}, will retry later`);
        // For non-final segments, wait 3 seconds before retry
        setTimeout(() => {
          message.nack(); // Nack to retry later
        }, 3000);
      }
    } else {
      console.error(`❌ Error processing audio segment for ${email}:`, error);
      // For other errors, wait a bit before retry
      setTimeout(() => {
        message.nack();
      }, 2000);
    }
  }
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
  
  const { callId, chatId, participants, orgId } = data;

  console.log(`🔚 Handling call ended for ${callId}`);

  // Get session
  let session: TranscriptionSession | undefined = activeSessions.get(callId);
  if (!session && orgId) {
    const loadedSession = await loadSessionFromDB(callId, orgId);
    if (loadedSession) {
      session = loadedSession;
    }
  }

  if (!session) {
    console.warn(`⚠️ No session found for call ${callId}`);
    message.ack();
    return;
  }

  // Wait for final chunks to be processed with intelligent checking
  // Since flushCallBuffers runs async, final metadata might take time to publish
  // GCS uploads typically complete within seconds to a minute, so 2 minutes is reasonable
  // We check periodically if all participants have received final chunks
  const MAX_WAIT_TIME_MS = 120000; // 2 minutes maximum (most uploads complete in <30s)
  const CHECK_INTERVAL_MS = 10000; // Check every 10 seconds for faster detection
  const startWaitTime = Date.now();
  
  // Initialize finalChunksReceived if not already set
  if (!session.finalChunksReceived) {
    session.finalChunksReceived = new Set();
  }
  
  console.log(`⏳ Waiting for final chunks to be processed (max ${MAX_WAIT_TIME_MS / 1000}s, checking every ${CHECK_INTERVAL_MS / 1000}s)...`);
  
  while (Date.now() - startWaitTime < MAX_WAIT_TIME_MS) {
    // Check if all participants have received final chunks
    const allParticipants = Array.from(session.participants.keys());
    const participantsWithFinalChunks = Array.from(session.finalChunksReceived);
    const missingFinalChunks = allParticipants.filter(email => !session.finalChunksReceived.has(email));
    
    if (missingFinalChunks.length === 0) {
      const elapsed = Math.floor((Date.now() - startWaitTime) / 1000);
      console.log(`✅ All participants have final chunks processed (${participantsWithFinalChunks.length}/${allParticipants.length}) after ${elapsed}s`);
      break;
    }
    
    const elapsed = Math.floor((Date.now() - startWaitTime) / 1000);
    const remaining = Math.floor((MAX_WAIT_TIME_MS - (Date.now() - startWaitTime)) / 1000);
    console.log(`⏳ Still waiting for final chunks... (${elapsed}s elapsed, ${remaining}s remaining, missing: ${missingFinalChunks.join(', ')})`);
    
    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
  }
  
  const totalWaitTime = Math.floor((Date.now() - startWaitTime) / 1000);
  if (totalWaitTime >= MAX_WAIT_TIME_MS / 1000) {
    const missing = Array.from(session.participants.keys()).filter(email => !session.finalChunksReceived.has(email));
    if (missing.length > 0) {
      console.warn(`⚠️ Timeout waiting for final chunks (${totalWaitTime}s). Missing final chunks for: ${missing.join(', ')}. Proceeding anyway.`);
    } else {
      console.log(`✅ All final chunks received after ${totalWaitTime}s`);
    }
  }

  // Now close all audio streams to signal end of input
  for (const [email, stream] of session.audioStreams.entries()) {
    try {
      stream.push(null); // End stream
      console.log(`🔚 Ended audio stream for ${email}`);
    } catch (error: any) {
      console.error(`❌ Error closing audio stream for ${email}:`, error);
    }
  }

  // Wait for final transcripts to arrive (transcribers process remaining audio)
  console.log(`⏳ Waiting for final transcripts... (current transcript count: ${Array.from(session.transcripts.values()).reduce((sum, arr) => sum + arr.length, 0)})`);
  await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds for transcripts (increased for stability)

  // Now close all transcribers
  for (const [email, transcriber] of session.transcribers.entries()) {
    try {
      await transcriber.close();
      console.log(`🔚 Closed transcriber for ${email}`);
    } catch (error: any) {
      console.error(`❌ Error closing transcriber for ${email}:`, error);
    }
  }

  // Wait a bit more for any final transcript events
  await new Promise(resolve => setTimeout(resolve, 5000)); // Increased to 5 seconds

  // Update session status in DB
  if (session.orgId) {
    try {
      const pool = await getOrgPool(session.orgId);
      
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

      // Create notes for each participant
      if (participants && participants.length > 0) {
        const userInfoMap = await getUserInfoBatch(participants.map(p => p.email));
        const participantsWithNames = participants.map(p => {
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
          console.warn(`⚠️ No transcript content to include in notes for call ${callId}`);
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

        // Create note for each participant
        for (const participant of participantsWithNames) {
          try {
            const noteId = crypto.randomBytes(16).toString('hex');
            const noteTitle = `Meeting Notes - ${callDateStr}`;
            
            // Use transcript if available, otherwise show a message
            const transcriptContent = formattedTranscript && formattedTranscript.trim().length > 0
              ? formattedTranscript
              : '<p><em>No transcript available for this call.</em></p>';
            
            const noteContent = `
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

            await pool.query(`
              INSERT INTO notes (id, title, content, owner_email, project_id, team_id, tags, is_pinned, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            `, [
              noteId,
              noteTitle,
              noteContent,
              participant.email.toLowerCase(),
              projectId,
              teamId,
              JSON.stringify(['meeting', 'transcript']),
              false
            ]);

            console.log(`✅ Created meeting note for ${participant.email}`);
          } catch (noteError: any) {
            console.error(`❌ Error creating note for ${participant.email}:`, noteError);
          }
        }
      }
    } catch (error: any) {
      console.error(`❌ Error finalizing session for call ${callId}:`, error);
    }
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
  
  const { callId, roomName, participants, orgId } = data;

  console.log(`📝 Handling transcription started for call ${callId}`);

  try {
    await startTranscriptionSession(callId, roomName, participants || [], orgId);
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

