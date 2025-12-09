/**
 * Transcription Service - Helper Functions
 * 
 * Note: This service has been migrated to async architecture using Pub/Sub and workers.
 * This file now only contains utility functions for transcript formatting.
 * 
 * The actual transcription processing is handled by:
 * - server/services/audio-recorder.ts (records audio and publishes to Pub/Sub)
 * - server/workers/transcription-worker.ts (processes audio chunks and transcribes)
 */

/**
 * Format transcript with speaker labels
 * Used by the transcription worker to format final transcripts
 */
export function formatTranscriptWithSpeakers(
  transcripts: Map<string, string>,
  participants: Map<string, { email: string; name?: string }>
): string {
  const formattedLines: string[] = [];
  
  // Convert to array and sort by participant email for consistent ordering
  const transcriptEntries = Array.from(transcripts.entries());
  
  // Group transcripts by participant
  for (const [email, transcript] of transcriptEntries) {
    const participant = participants.get(email.toLowerCase());
    const speakerName = participant?.name || email;
    
    if (transcript && transcript.trim()) {
      formattedLines.push(`<p><strong>${speakerName}:</strong> ${transcript}</p>`);
    }
  }

  return formattedLines.join('\n');
}

/**
 * Legacy functions - kept for backward compatibility during migration
 * These are no longer used in the async architecture but may be referenced
 * by code that hasn't been fully migrated yet.
 */

export function isTranscriptionActive(callId: string): boolean {
  // In async architecture, transcription state is in PostgreSQL
  // This function is kept for compatibility but always returns false
  console.warn(`⚠️ isTranscriptionActive() called for ${callId} - this function is deprecated in async architecture`);
  return false;
}

export function getTranscriptionSession(callId: string): any {
  // In async architecture, sessions are in PostgreSQL
  // This function is kept for compatibility but always returns null
  console.warn(`⚠️ getTranscriptionSession() called for ${callId} - this function is deprecated in async architecture`);
  return null;
}

export function findActiveTranscriptionByRoom(roomName: string): string | null {
  // In async architecture, sessions are in PostgreSQL
  // This function is kept for compatibility but always returns null
  console.warn(`⚠️ findActiveTranscriptionByRoom() called for ${roomName} - this function is deprecated in async architecture`);
  return null;
}

export async function startTranscriptionSession(
  callId: string,
  roomName: string,
  participants: Array<{ email: string; name?: string }>,
  secretManagerClient?: any,
  projectId?: string
): Promise<void> {
  // In async architecture, transcription is started via Pub/Sub events
  // This function is kept for compatibility but does nothing
  console.warn(`⚠️ startTranscriptionSession() called for ${callId} - this function is deprecated in async architecture. Use publishCallEvent('transcription_started') instead.`);
}

export async function finalizeTranscriptionSession(
  callId: string
): Promise<Map<string, string>> {
  // In async architecture, transcription is finalized via Pub/Sub events
  // This function is kept for compatibility but returns empty map
  console.warn(`⚠️ finalizeTranscriptionSession() called for ${callId} - this function is deprecated in async architecture. Use publishCallEvent('call_ended') instead.`);
  return new Map();
}

export function processAudioChunk(
  callId: string,
  participantEmail: string,
  audioChunk: Buffer | Uint8Array
): void {
  // In async architecture, audio chunks are processed via Pub/Sub
  // This function is kept for compatibility but does nothing
  console.warn(`⚠️ processAudioChunk() called for ${callId}:${participantEmail} - this function is deprecated in async architecture. Use recordChunk() instead.`);
}
