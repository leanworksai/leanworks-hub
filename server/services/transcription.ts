/**
 * AssemblyAI Transcription Service
 * Handles live transcription of voice calls with speaker attribution
 */

import { AssemblyAI } from 'assemblyai';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Transcription session data
interface TranscriptionSession {
  callId: string;
  roomName: string;
  participants: Map<string, { email: string; name?: string }>;
  transcribers: Map<string, any>; // AssemblyAI StreamingTranscriber per participant
  audioStreams: Map<string, Readable>; // Readable streams for piping audio to transcribers
  transcripts: Map<string, string[]>; // Transcripts per participant
  startTime: Date;
  isActive: boolean;
}

// In-memory storage for active transcription sessions
const activeSessions = new Map<string, TranscriptionSession>();

// Initialize AssemblyAI client
let assemblyAIClient: AssemblyAI | null = null;

async function getAssemblyAIClient(secretManagerClient: SecretManagerServiceClient, projectId: string): Promise<AssemblyAI> {
  if (assemblyAIClient) {
    return assemblyAIClient;
  }

  // Get API key from Secret Manager (preferred) or environment variable
  let apiKey: string;
  
  // Priority: 1. Secret Manager, 2. Environment variable, 3. Local file
  try {
    // Try Secret Manager first
    const secretName = `projects/${projectId}/secrets/assemblyai-api-key/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
    apiKey = version.payload?.data?.toString()?.trim() || '';
    
    if (!apiKey) {
      throw new Error('AssemblyAI API key from Secret Manager is empty');
    }
    
    console.log('✅ Loaded AssemblyAI API key from Secret Manager');
  } catch (secretManagerError: any) {
    // Fallback to environment variable
    if (process.env.ASSEMBLYAI_API_KEY) {
      apiKey = process.env.ASSEMBLYAI_API_KEY;
      console.log('✅ Loaded AssemblyAI API key from environment variable');
    } else {
      // Last resort: try local file (for local development)
      const apiKeyPath = join(__dirname, '../../assemblyai_api_key.txt');
      if (existsSync(apiKeyPath)) {
        apiKey = readFileSync(apiKeyPath, 'utf8').trim();
        console.log('✅ Loaded AssemblyAI API key from local file');
      } else {
        console.error('❌ Failed to load from Secret Manager:', secretManagerError?.message || secretManagerError);
        throw new Error('AssemblyAI API key not found. Check Secret Manager (assemblyai-api-key), ASSEMBLYAI_API_KEY env var, or assemblyai_api_key.txt file.');
      }
    }
  }

  if (!apiKey) {
    throw new Error('AssemblyAI API key is required');
  }

  assemblyAIClient = new AssemblyAI({ apiKey });
  return assemblyAIClient;
}

/**
 * Start a transcription session for a call
 */
export async function startTranscriptionSession(
  callId: string,
  roomName: string,
  participants: Array<{ email: string; name?: string }>,
  secretManagerClient?: SecretManagerServiceClient,
  projectId?: string
): Promise<void> {
  try {
    // Get AssemblyAI client
    if (!secretManagerClient || !projectId) {
      // For local testing, try to get from env or file
      let apiKey = process.env.ASSEMBLYAI_API_KEY;
      if (!apiKey) {
        const apiKeyPath = join(__dirname, '../../assemblyai_api_key.txt');
        if (existsSync(apiKeyPath)) {
          apiKey = readFileSync(apiKeyPath, 'utf8').trim();
        }
      }
      if (!apiKey) {
        throw new Error('AssemblyAI API key not found. Set ASSEMBLYAI_API_KEY env var or create assemblyai_api_key.txt file.');
      }
      assemblyAIClient = new AssemblyAI({ apiKey });
    } else {
      await getAssemblyAIClient(secretManagerClient, projectId);
    }

    if (!assemblyAIClient) {
      throw new Error('Failed to initialize AssemblyAI client');
    }

    const session: TranscriptionSession = {
      callId,
      roomName,
      participants: new Map(participants.map(p => [p.email.toLowerCase(), p])),
      transcribers: new Map(),
      audioStreams: new Map(),
      transcripts: new Map(),
      startTime: new Date(),
      isActive: true,
    };

    // Create streaming transcriber for each participant
    // Note: AssemblyAI supports multiple speakers, but we'll create separate sessions
    // to attribute transcripts to specific participants using metadata
    for (const participant of participants) {
      const email = participant.email.toLowerCase();
      
      try {
        // Create streaming transcriber
        const transcriber = assemblyAIClient.streaming.transcriber({
          sampleRate: 16000, // 16kHz
          formatTurns: true, // Format transcripts as turns
        });

        // Set up event handlers
        transcriber.on('open', ({ id }: { id: string }) => {
          console.log(`✅ Transcription session opened for ${email}, ID: ${id}`);
        });

        transcriber.on('turn', (turn: any) => {
          if (turn.transcript && turn.transcript.trim()) {
            // Store transcript with participant attribution
            if (!session.transcripts.has(email)) {
              session.transcripts.set(email, []);
            }
            session.transcripts.get(email)!.push(turn.transcript);
            console.log(`📝 Transcript for ${email}: ${turn.transcript}`);
          }
        });

        transcriber.on('error', (error: any) => {
          console.error(`❌ Transcription error for ${email}:`, error.message || error);
        });

        transcriber.on('close', (code: number, reason: string) => {
          console.log(`🔌 Transcription connection closed for ${email}: ${code} - ${reason}`);
        });

        // Connect the transcriber
        await transcriber.connect();
        console.log(`✅ Transcription connected for ${email}`);

        // Create a readable stream for this participant's audio
        // We'll push audio chunks to this stream, which will be piped to the transcriber
        const audioStream = new Readable({
          read() {
            // This will be called when the stream needs data
            // We push data manually via processAudioChunk
          },
          objectMode: false, // Binary mode for audio data
        });

        // Pipe the audio stream to the transcriber's stream
        // transcriber.stream() returns a Web WritableStream, so we need to convert
        // the Node.js Readable stream to a Web ReadableStream and use pipeTo
        if (typeof Readable.toWeb === 'function') {
          // Node.js 16.5.0+ has Readable.toWeb
          Readable.toWeb(audioStream).pipeTo(transcriber.stream());
        } else {
          // Fallback: create a simple pass-through approach
          // For older Node.js versions, we might need a different approach
          throw new Error('Readable.toWeb is not available. Please use Node.js 16.5.0 or later.');
        }

        // Store transcriber and audio stream for this participant
        session.transcribers.set(email, transcriber);
        session.audioStreams.set(email, audioStream);
      } catch (error: any) {
        console.error(`❌ Error creating transcriber for ${email}:`, error.message || error);
        // Continue with other participants even if one fails
      }
    }

    activeSessions.set(callId, session);
    console.log(`✅ Transcription session started for call ${callId} with ${participants.length} participants`);
  } catch (error) {
    console.error('❌ Error starting transcription session:', error);
    throw error;
  }
}

/**
 * Process audio chunk for a participant
 */
export function processAudioChunk(
  callId: string,
  participantEmail: string,
  audioChunk: Buffer
): void {
  const session = activeSessions.get(callId);
  if (!session || !session.isActive) {
    console.warn(`⚠️ No active transcription session for call ${callId}`);
    return;
  }

  const email = participantEmail.toLowerCase();
  
  // Get the audio stream for this specific participant
  const audioStream = session.audioStreams.get(email);
  
  if (audioStream) {
    try {
      // Push audio chunk to the readable stream
      // This will be piped to the transcriber's stream
      audioStream.push(audioChunk);
    } catch (error: any) {
      console.error(`❌ Error sending audio chunk for ${email}:`, error.message || error);
    }
  } else {
    console.warn(`⚠️ No audio stream available for participant ${email} in call ${callId}`);
  }
}

/**
 * Finalize transcription session and get transcripts
 */
export async function finalizeTranscriptionSession(
  callId: string
): Promise<Map<string, string>> {
  const session = activeSessions.get(callId);
  if (!session) {
    console.warn(`⚠️ No transcription session found for call ${callId}`);
    return new Map();
  }

  session.isActive = false;

  // Close all audio streams and transcriber connections
  for (const [email, audioStream] of session.audioStreams.entries()) {
    try {
      // End the audio stream
      audioStream.push(null); // Signal end of stream
    } catch (error) {
      console.error(`❌ Error closing audio stream for ${email}:`, error);
    }
  }

  for (const [email, transcriber] of session.transcribers.entries()) {
    try {
      await transcriber.close();
      console.log(`✅ Transcriber closed for ${email}`);
    } catch (error) {
      console.error(`❌ Error closing transcriber for ${email}:`, error);
    }
  }

  // Aggregate transcripts per participant
  const finalTranscripts = new Map<string, string>();
  
  for (const [email, transcripts] of session.transcripts.entries()) {
    const fullTranscript = transcripts.join(' ');
    
    if (fullTranscript.trim()) {
      finalTranscripts.set(email, fullTranscript);
    }
  }

  // Clean up session
  activeSessions.delete(callId);

  console.log(`✅ Transcription finalized for call ${callId}`);
  return finalTranscripts;
}

/**
 * Get formatted transcript with speaker labels
 */
export function formatTranscriptWithSpeakers(
  transcripts: Map<string, string>,
  participants: Map<string, { email: string; name?: string }>
): string {
  const formattedLines: string[] = [];
  
  // Convert to array and sort by participant email for consistent ordering
  const transcriptEntries = Array.from(transcripts.entries());
  
  for (const [email, transcript] of transcriptEntries) {
    const participant = participants.get(email.toLowerCase());
    const speakerName = participant?.name || participant?.email || email;
    
    if (transcript.trim()) {
      formattedLines.push(`<p><strong>${speakerName}:</strong> ${transcript}</p>`);
    }
  }

  return formattedLines.join('\n');
}

/**
 * Stop transcription session (cleanup on error)
 */
export function stopTranscriptionSession(callId: string): void {
  const session = activeSessions.get(callId);
  if (!session) {
    return;
  }

  session.isActive = false;

  // Close all audio streams and transcribers
  for (const [email, audioStream] of session.audioStreams.entries()) {
    try {
      audioStream.push(null); // Signal end of stream
    } catch (error: any) {
      console.error(`❌ Error closing audio stream for ${email}:`, error);
    }
  }

  for (const [email, transcriber] of session.transcribers.entries()) {
    try {
      transcriber.close().catch((error: any) => {
        console.error(`❌ Error closing transcriber for ${email}:`, error);
      });
    } catch (error: any) {
      console.error(`❌ Error closing transcriber for ${email}:`, error);
    }
  }

  activeSessions.delete(callId);
  console.log(`🛑 Transcription session stopped for call ${callId}`);
}

/**
 * Check if transcription is active for a call
 */
export function isTranscriptionActive(callId: string): boolean {
  const session = activeSessions.get(callId);
  return session?.isActive || false;
}
