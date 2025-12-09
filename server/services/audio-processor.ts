/**
 * Audio Stream Processor
 * Processes audio streams from LiveKit and routes to transcription service
 */

import { processAudioChunk } from './transcription.js';

/**
 * Process audio data from LiveKit egress/webhook
 * This receives audio chunks and routes them to the appropriate transcription stream
 */
export function processLiveKitAudio(
  callId: string,
  participantEmail: string,
  audioData: Buffer | Uint8Array
): void {
  try {
    // Convert to Buffer if needed
    const audioBuffer = Buffer.isBuffer(audioData) 
      ? audioData 
      : Buffer.from(audioData);

    // Route to transcription service
    processAudioChunk(callId, participantEmail, audioBuffer);
  } catch (error) {
    console.error(`❌ Error processing audio for ${participantEmail}:`, error);
  }
}

/**
 * Convert audio format if needed
 * LiveKit typically provides audio in Opus or PCM format
 */
export function convertAudioFormat(
  audioData: Buffer,
  sourceFormat: 'opus' | 'pcm' | 'linear16',
  targetFormat: 'linear16' = 'linear16'
): Buffer {
  // For now, assume LiveKit provides audio in a compatible format
  // In production, you may need to use ffmpeg or similar to convert formats
  // Google Speech-to-Text expects LINEAR16 PCM at 16kHz
  
  if (sourceFormat === targetFormat) {
    return audioData;
  }

  // TODO: Implement audio format conversion if needed
  // This would typically require ffmpeg or similar library
  console.warn(`⚠️ Audio format conversion from ${sourceFormat} to ${targetFormat} not implemented`);
  return audioData;
}

