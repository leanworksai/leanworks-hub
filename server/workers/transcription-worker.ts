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
  transcriberReady: Map<string, boolean>; // Track which transcribers are actually connected and ready
  transcriberReadyTime: Map<string, number>; // Track when transcribers were last confirmed ready (timestamp)
  audioPipeStarted: Map<string, boolean>; // Track whether audio pipe has started for each participant
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
// Send chunks faster than real-time but with backpressure handling
// 50ms delay allows ~18x real-time max, but backpressure will naturally throttle
const CHUNK_INTERVAL_MS = 50; // Send 30KB chunks every 50ms (allows faster transmission, backpressure handles throttling)

/**
 * Push audio buffer to stream in chunks to meet AssemblyAI's requirements:
 * - Maximum frame size: 1MB
 * - Duration limit: 50-1000ms per chunk
 * - Rate limit: Must send at approximately real-time speed to avoid "Audio Transmission Rate Exceeded" error
 * At 16kHz PCM (16-bit), 1000ms = 32KB, so we use 30KB chunks to stay safe
 */
async function pushAudioInChunks(stream: Readable, audioBuffer: Buffer, email?: string): Promise<void> {
  let offset = 0;
  let totalPushed = 0;
  while (offset < audioBuffer.length) {
    const chunk = audioBuffer.slice(offset, Math.min(offset + MAX_CHUNK_SIZE, audioBuffer.length));
    
    // Push chunk and check for backpressure
    const canPush = stream.push(chunk);
    totalPushed += chunk.length;
    offset += MAX_CHUNK_SIZE;
    
    // If stream is backpressured, wait for drain event
    if (!canPush) {
      await new Promise<void>((resolve) => {
        stream.once('drain', resolve);
      });
    }
    
    // Small delay to prevent tight loops and allow stream processing
    // This is much faster than 900ms, allowing near real-time transmission
    if (offset < audioBuffer.length) {
      await new Promise(resolve => setTimeout(resolve, CHUNK_INTERVAL_MS));
    }
  }
  if (email) {
    console.log(`📤 Pushed ${totalPushed} bytes to audio stream for ${email}`);
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
      transcriberReady: new Map(), // Will be set when transcribers connect
      transcriberReadyTime: new Map(), // Will be set when transcribers connect
      audioPipeStarted: new Map(), // Will be set when audio pipes start
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
      formatText: true, // Enable punctuation and capitalization for better readability
      // Turn detection: 'aggressive' ends turns quickly, 'balanced' is natural, 'conservative' holds longer
      // Using 'balanced' for natural sentence completion
    });

    let transcriberReady = false;
    let promiseResolve: (() => void) | null = null;
    let promiseReject: ((error: Error) => void) | null = null;
    
    const transcriberReadyPromise = new Promise<void>((resolve, reject) => {
      promiseResolve = resolve;
      promiseReject = reject;
      
      // Set a timeout to detect if transcriber never connects
      const timeout = setTimeout(() => {
        if (!transcriberReady) {
          console.error(`❌ Transcriber connection timeout for ${email} after 30 seconds`);
          reject(new Error('Transcriber connection timeout'));
        }
      }, 30000); // 30 second timeout
      
      const openHandler = ({ id }: { id: string }) => {
        clearTimeout(timeout);
        transcriberReady = true;
        // Mark transcriber as ready in session
        if (!session.transcriberReady) {
          session.transcriberReady = new Map();
        }
        session.transcriberReady.set(email, true);
        if (!session.transcriberReadyTime) {
          session.transcriberReadyTime = new Map();
        }
        session.transcriberReadyTime.set(email, Date.now());
        console.log(`✅ Transcription session opened for ${email}, ID: ${id}`);
        resolve();
      };
      
      const errorHandler = (error: any) => {
        clearTimeout(timeout);
        // Mark transcriber as not ready in session
        if (!session.transcriberReady) {
          session.transcriberReady = new Map();
        }
        session.transcriberReady.set(email, false);
        console.error(`❌ Transcriber connection error for ${email}:`, error);
        reject(error);
      };
      
      transcriber.on('open', openHandler);
      transcriber.on('error', errorHandler);
    });

    // Add logging for all transcriber events to debug
    transcriber.on('close', () => {
      console.log(`🔌 Transcriber closed for ${email}`);
    });
    
    transcriber.on('error', (error: any) => {
      console.error(`❌ Transcriber error event for ${email}:`, error);
      if (!session.transcriberReady) {
        session.transcriberReady = new Map();
      }
      session.transcriberReady.set(email, false);
    });

    transcriber.on('turn', (turn: any) => {
      console.log(`🔄 Turn event received for ${email}:`, { 
        transcript: turn.transcript?.substring(0, 50) || '(empty)', 
        end_of_turn: turn.end_of_turn,
        hasTranscript: !!turn.transcript,
        fullTurn: JSON.stringify(turn).substring(0, 200) // Log first 200 chars of full turn object
      });
      if (turn.transcript && turn.transcript.trim()) {
        const existingTranscripts = session.transcripts.get(email) || [];
        const transcriptText = turn.transcript.trim();
        
        // Filter out partial/interim transcripts - only capture final ones
        // AssemblyAI's turn event has 'end_of_turn' property for final transcripts
        const isFinal = turn.end_of_turn === true;
        
        // Helper function to normalize text for comparison (remove punctuation, lowercase)
        const normalizeText = (text: string): string => {
          return text.toLowerCase()
            .replace(/[.,!?;:]/g, '') // Remove punctuation
            .trim();
        };
        
        // For final transcripts, accumulate short words into sentences
        // For partial transcripts, only filter very short ones
        if (isFinal) {
          // Check if transcript ends with sentence-ending punctuation
          const hasSentenceEnding = /[.!?]$/.test(transcriptText);
          
          // Final transcripts - accumulate short words into sentences
          const lastTranscript = existingTranscripts[existingTranscripts.length - 1];
          
          // If we have a last transcript and the current one is short (likely a word)
          // and doesn't have sentence-ending punctuation, try to combine them
          if (lastTranscript && transcriptText.length < 20 && !hasSentenceEnding) {
            const normalizedLast = normalizeText(lastTranscript);
            const normalizedCurrent = normalizeText(transcriptText);
            
            // If they're different words, combine them
            if (normalizedLast !== normalizedCurrent) {
              // Check if last transcript also doesn't end with punctuation
              const lastHasPunctuation = /[.!?]$/.test(lastTranscript);
              
              if (!lastHasPunctuation) {
                // Combine: "is" + "going" -> "is going"
                const combined = `${lastTranscript} ${transcriptText}`;
                existingTranscripts[existingTranscripts.length - 1] = combined;
                console.log(`📝 Combined transcript for ${email}: "${combined}" (from "${lastTranscript}" + "${transcriptText}")`);
                saveSessionToDB(session).catch(console.error);
                return; // Don't add as new, we combined it
              }
            } else {
              // Same word - skip duplicate
              console.log(`⏭️ Skipping duplicate final transcript for ${email}: "${transcriptText}"`);
              return;
            }
          }
          
          // Check for duplicates (normalized comparison)
          if (lastTranscript) {
            const normalizedLast = normalizeText(lastTranscript);
            const normalizedCurrent = normalizeText(transcriptText);
            
            // Skip if normalized versions are identical (handles "three" vs "Three.")
            if (normalizedLast === normalizedCurrent) {
              console.log(`⏭️ Skipping duplicate final transcript for ${email}: "${transcriptText}" (same as "${lastTranscript}")`);
              return; // Skip exact duplicates (case/punctuation variations)
            }
            
            // Replace if last is clearly a substring/refinement
            // Be conservative - only if the last one is significantly shorter and contained
            if (normalizedLast.length < normalizedCurrent.length && 
                normalizedCurrent.startsWith(normalizedLast) &&
                normalizedLast.length > 0 &&
                (normalizedCurrent.length - normalizedLast.length) > 2) {
              // Replace the last transcript with the more complete version
              existingTranscripts[existingTranscripts.length - 1] = transcriptText;
              console.log(`📝 Updated transcript for ${email}: "${transcriptText}" (refined from "${lastTranscript}")`);
              saveSessionToDB(session).catch(console.error);
              return; // Don't add as new transcript, we just updated the last one
            }
          }
          
          // Add final transcript
          if (!session.transcripts.has(email)) {
            session.transcripts.set(email, []);
          }
          session.transcripts.get(email)!.push(transcriptText);
          console.log(`📝 Transcript for ${email}: ${transcriptText} (final)`);
          
          // Save to DB periodically
          saveSessionToDB(session).catch(console.error);
        } else {
          // Partial/interim transcripts - only filter very short fragments
          // Skip very short fragments that are likely partial/interim (less than 3 characters)
          if (transcriptText.length < 3) {
            return; // Skip partial short fragments
          }
          
          // For partials, only add if they're substantial and different from the last one
          const lastTranscript = existingTranscripts[existingTranscripts.length - 1];
          if (lastTranscript) {
            const normalizedLast = normalizeText(lastTranscript);
            const normalizedCurrent = normalizeText(transcriptText);
            
            // Skip if it's a duplicate or substring of the last one
            if (normalizedLast === normalizedCurrent || 
                (normalizedCurrent.length < normalizedLast.length && normalizedLast.includes(normalizedCurrent))) {
              return; // Skip partial duplicates
            }
          }
          
          // Only add substantial partials (5+ characters)
          if (transcriptText.length >= 5) {
            if (!session.transcripts.has(email)) {
              session.transcripts.set(email, []);
            }
            session.transcripts.get(email)!.push(transcriptText);
            console.log(`📝 Transcript for ${email}: ${transcriptText} (partial)`);
            
            // Save to DB periodically
            saveSessionToDB(session).catch(console.error);
          }
        }
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

    // Connect transcriber and wait for it to be ready
    console.log(`🔌 Connecting transcriber for ${email}...`);
    
    // Start connection (non-blocking)
    transcriber.connect()
      .then(() => {
        console.log(`✅ Transcriber.connect() completed for ${email} (waiting for 'open' event)`);
      })
      .catch((error: any) => {
        console.error(`❌ Error connecting transcriber for ${email}:`, error);
        // Mark as not ready on connection error
        if (!session.transcriberReady) {
          session.transcriberReady = new Map();
        }
        session.transcriberReady.set(email, false);
        // Reject the promise so audio pipe doesn't wait forever
        if (promiseReject) {
          promiseReject(error);
        }
      });

    // Wait for transcriber to be ready in background (don't block, but track status)
    transcriberReadyPromise
      .then(() => {
        console.log(`✅ Transcriber ready for ${email}`);
      })
      .catch((error: any) => {
        console.error(`❌ Transcriber failed to become ready for ${email}:`, error);
        // Ensure it's marked as not ready on failure
        if (!session.transcriberReady) {
          session.transcriberReady = new Map();
        }
        session.transcriberReady.set(email, false);
      });

    // Pipe audio stream to transcriber
    if (typeof Readable.toWeb === 'function') {
      const webStream = Readable.toWeb(audioStream);
      const transcriberStream = transcriber.stream();
      const writer = transcriberStream.getWriter();
      const reader = webStream.getReader();

      (async () => {
        try {
          // Wait for transcriber to be ready before starting to pipe audio
          // Use Promise.race to timeout after 35 seconds (5 seconds after transcriber timeout)
          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => {
              reject(new Error('Audio pipe timeout: transcriber did not become ready within 35 seconds'));
            }, 35000);
          });
          
          await Promise.race([transcriberReadyPromise, timeoutPromise]);
          console.log(`✅ Transcriber ready, starting audio pipe for ${email}`);
          
          // Mark audio pipe as started
          if (!session.audioPipeStarted) {
            session.audioPipeStarted = new Map();
          }
          session.audioPipeStarted.set(email, true);
          
          let bytesRead = 0;
          let bytesWritten = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              console.log(`🔚 Audio pipe reader done for ${email}, closing writer (read ${bytesRead} bytes, wrote ${bytesWritten} bytes)`);
              await writer.close();
              break;
            }
            if (value) {
              bytesRead += value.length;
              // Verify audio format: should be Int16LE (2 bytes per sample)
              if (bytesRead <= 64 * 1024 && bytesRead % 1024 === 0) {
                // Convert Uint8Array to Buffer to use readInt16LE
                const buffer = Buffer.from(value);
                // Log first few samples to verify format
                const sample1 = buffer.readInt16LE(0);
                const sample2 = buffer.length >= 4 ? buffer.readInt16LE(2) : 0;
                console.log(`🔍 Audio format check for ${email}: first samples=${sample1}, ${sample2}, buffer length=${value.length}`);
              }
              await writer.write(value);
              bytesWritten += value.length;
              if (bytesRead % (64 * 1024) === 0 || bytesRead < 64 * 1024) {
                console.log(`📥 Audio pipe read ${bytesRead} bytes, wrote ${bytesWritten} bytes for ${email}`);
              }
            }
          }
        } catch (error: any) {
          // Check if this is a premature close error (expected when recreating transcribers)
          const isPrematureClose = error.code === 'ABORT_ERR' || 
                                  error.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
                                  error.cause?.code === 'ERR_STREAM_PREMATURE_CLOSE';
          
          if (isPrematureClose) {
            console.log(`ℹ️ Audio pipe closed for ${email} (expected when recreating transcribers)`);
          } else {
            console.error(`❌ Error piping audio to transcriber for ${email}:`, error);
            // Mark transcriber as not ready only for unexpected errors
            if (!session.transcriberReady) {
              session.transcriberReady = new Map();
            }
            session.transcriberReady.set(email, false);
          }
          
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

  // If session exists and wasn't loaded from DB, check if call is ending before recreating transcribers
  // This prevents interrupting transcription finalization for a call that's already ending
  if (session && !sessionLoadedFromDB) {
    // Check if call is already ending (all final chunks received)
    // If so, don't recreate transcribers - they're needed to finish processing remaining audio
    // session is guaranteed to be defined here because we're inside the if (session && !sessionLoadedFromDB) block
    const currentSession = session;
    if (currentSession.finalChunksReceived && currentSession.finalChunksReceived.size > 0) {
      const allParticipants = Array.from(currentSession.participants.keys());
      const allFinalChunksReceived = allParticipants.length > 0 && 
        allParticipants.every(email => currentSession.finalChunksReceived!.has(email));
      
      if (allFinalChunksReceived) {
        console.log(`⚠️ Call ${callId} is already ending (all final chunks received). Not recreating transcribers to avoid interrupting finalization.`);
        // Verify transcribers still exist and are working
        let allTranscribersActive = true;
        for (const participant of participants) {
          const email = participant.email.toLowerCase();
          if (!currentSession.transcribers.has(email) || !currentSession.audioStreams.has(email)) {
            allTranscribersActive = false;
            break;
          }
        }
        
        if (allTranscribersActive) {
          console.log(`✅ Transcribers are active for ending call ${callId}, not recreating`);
          return;
        } else {
          console.log(`⚠️ Some transcribers missing for ending call, but proceeding with recreation anyway`);
          // Fall through to recreate
        }
      }
    }
    
    console.log(`📝 Transcription session already exists for call ${callId}, cleaning up old transcribers and creating fresh ones`);
    
    // Initialize maps if they don't exist (for sessions created before this change)
    if (!currentSession.transcriberReady) {
      currentSession.transcriberReady = new Map();
    }
    if (!currentSession.transcriberReadyTime) {
      currentSession.transcriberReadyTime = new Map();
    }
    if (!currentSession.audioPipeStarted) {
      currentSession.audioPipeStarted = new Map();
    }
    
    // Clean up all existing transcribers to ensure fresh connections
    const assemblyAI = await getAssemblyAIClient();
    for (const participant of participants) {
      const email = participant.email.toLowerCase();
      
      // Clean up old transcriber if it exists
      const oldTranscriber = currentSession.transcribers.get(email);
      if (oldTranscriber) {
        console.log(`🧹 Cleaning up old transcriber for ${email}`);
        try {
          oldTranscriber.close?.();
        } catch (error: any) {
          console.warn(`⚠️ Error closing old transcriber for ${email}:`, error.message);
        }
        currentSession.transcribers.delete(email);
      }
      
      // Clean up old audio stream if it exists
      const oldAudioStream = currentSession.audioStreams.get(email);
      if (oldAudioStream) {
        try {
          if (!oldAudioStream.destroyed) {
            oldAudioStream.destroy();
          }
        } catch (error: any) {
          console.warn(`⚠️ Error destroying old audio stream for ${email}:`, error.message);
        }
        currentSession.audioStreams.delete(email);
      }
      
      // Clear state flags
      currentSession.transcriberReady.delete(email);
      currentSession.transcriberReadyTime.delete(email);
      currentSession.audioPipeStarted.delete(email);
      
      // Create fresh transcriber
      console.log(`🔄 Creating fresh transcriber for ${email}`);
      await setupTranscriberForParticipant(currentSession, participant, assemblyAI);
    }
    
    console.log(`✅ Recreated all transcribers for call ${callId}`);
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
      transcriberReady: new Map(), // Track which transcribers are actually connected and ready
      transcriberReadyTime: new Map(), // Track when transcribers were last confirmed ready
      audioPipeStarted: new Map(), // Track whether audio pipes have started for each participant
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
    
    // If transcriber already exists AND is ready (shouldn't happen for DB-loaded sessions, but check anyway)
    const hasTranscriber = session.transcribers.has(email) && session.audioStreams.has(email);
    const isReady = session.transcriberReady?.get(email) === true;
    
    if (hasTranscriber && isReady) {
      console.log(`📝 Transcriber already exists and is ready for ${email}, skipping recreation`);
      continue;
    }
    
    // If transcriber exists but isn't ready, clean it up first
    if (hasTranscriber && !isReady) {
      console.log(`⚠️ Transcriber exists for ${email} but is not ready, cleaning up before recreation`);
      const oldTranscriber = session.transcribers.get(email);
      if (oldTranscriber) {
        try {
          oldTranscriber.close?.();
        } catch {}
        session.transcribers.delete(email);
        session.audioStreams.delete(email);
        if (session.transcriberReady) {
          session.transcriberReady.delete(email);
        }
      }
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
    
    // If still no session, auto-start transcription session
    if (!session) {
      console.log(`📝 No transcription session found for call ${callId}, auto-starting...`);
      try {
        // Extract participants from the audio chunk data or use a default
        // We need at least the current participant
        const participants = [{ email: participantEmail }];
        
        // Try to get orgId from the data or use undefined
        const orgId = data.orgId;
        
        // Auto-start the session
        await startTranscriptionSession(callId, data.roomName || callId, participants, orgId);
        
        // Get the newly created session
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
    
    // Mark segment as processing BEFORE async download to prevent concurrent processing
    // This prevents the same segment from being processed multiple times concurrently
    processedSegments.add(segmentIdx);
    
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
        await pushAudioInChunks(audioStream, audioBuffer, email);
        session.lastProcessedBytes.set(email, lastProcessedByte + audioBuffer.length);
        console.log(`📥 Downloaded ${audioBuffer.length} new bytes for ${email} (total processed: ${lastProcessedByte + audioBuffer.length}/${currentSize}, chunked into ${Math.ceil(audioBuffer.length / MAX_CHUNK_SIZE)} pieces)`);
      }
      
      // Segment already marked as processed above (before async download)
      
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
          await pushAudioInChunks(audioStream, newData, email);
          // FIX: Should be lastSize + newData.length, not just audioBuffer.length
          // This correctly tracks total processed bytes
          session.lastProcessedBytes.set(email, lastSize + newData.length);
        }
      }
      
      // Segment already marked as processed above (before async download)
      
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

