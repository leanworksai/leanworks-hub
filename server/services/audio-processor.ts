/**
 * Audio Stream Processor
 * Processes audio streams from LiveKit and routes to transcription service
 */

import libsamplerate from '@alexanderolsen/libsamplerate-js';
const { create, ConverterType } = libsamplerate;

// Note: processAudioChunk is no longer used in async architecture
// Audio is now recorded via audio-recorder.ts and processed by transcription-worker.ts

/**
 * Process audio data from LiveKit egress/webhook
 * This receives audio chunks and routes them to the appropriate transcription stream
 * 
 * Note: LiveKit egress sends PCM16 at 48kHz, but AssemblyAI requires 16kHz
 * We resample the audio before sending to the transcription service
 */
export async function processLiveKitAudio(
  callId: string,
  participantEmail: string,
  audioData: Buffer | Uint8Array
): Promise<void> {
  try {
    // Convert to Buffer if needed
    const audioBuffer = Buffer.isBuffer(audioData) 
      ? audioData 
      : Buffer.from(audioData);

    // Resample from 48kHz to 16kHz (AssemblyAI requirement)
    // LiveKit Track Egress sends PCM16 at 48kHz
    const resampledAudio = await resample48kHzTo16kHz(audioBuffer);

    // Route resampled audio to transcription service
    processAudioChunk(callId, participantEmail, resampledAudio);
  } catch (error) {
    console.error(`❌ Error processing audio for ${participantEmail}:`, error);
  }
}

/**
 * Resample PCM16 audio from 48kHz to 16kHz
 * Uses high-quality resampling with anti-aliasing filter
 * 
 * @param audioData - PCM16 audio buffer at 48kHz
 * @returns Resampled PCM16 audio buffer at 16kHz
 */
// Track resampling stats for debugging
let resamplingStats = {
  totalChunks: 0,
  totalInputBytes: 0,
  totalOutputBytes: 0,
  lastLogTime: Date.now()
};

// Create a resampler instance (reused for efficiency, created lazily)
let resamplerInstance: any = null;
let resamplerInitPromise: Promise<any> | null = null;

async function getResampler(): Promise<any> {
  if (resamplerInstance) {
    return resamplerInstance;
  }
  
  if (resamplerInitPromise) {
    return resamplerInitPromise;
  }
  
  // Create resampler: 48kHz -> 16kHz, mono channel, best quality
  resamplerInitPromise = create(1, 48000, 16000, {
    converterType: ConverterType.SRC_SINC_BEST_QUALITY,
  }).then((resampler) => {
    resamplerInstance = resampler;
    resamplerInitPromise = null;
    return resampler;
  });
  
  return resamplerInitPromise;
}

// Initialize resampler eagerly at module load
getResampler().catch((error) => {
  console.error(`❌ Error initializing resampler at startup:`, error);
});

export async function resample48kHzTo16kHz(audioData: Buffer): Promise<Buffer> {
  try {
    // Convert Buffer to Int16Array
    const inputSamples = audioData.length / 2; // 16-bit = 2 bytes per sample
    const inputArray = new Int16Array(audioData.buffer, audioData.byteOffset, inputSamples);
    
    // Convert Int16 to Float32 (normalize to -1.0 to 1.0)
    const inputFloat = new Float32Array(inputSamples);
    for (let i = 0; i < inputSamples; i++) {
      inputFloat[i] = inputArray[i] / 32768.0;
    }
    
    // Get resampler (wait for initialization if needed)
    const resampler = await getResampler();
    
    // Resample using high-quality algorithm
    const outputFloat = resampler.simple(inputFloat);
    
    // Convert Float32 back to Int16 Buffer
    const outputSamples = outputFloat.length;
    const outputBuffer = Buffer.alloc(outputSamples * 2);
    for (let i = 0; i < outputSamples; i++) {
      // Clamp to valid Int16 range and convert back
      const sample = Math.max(-32768, Math.min(32767, Math.round(outputFloat[i] * 32768.0)));
      outputBuffer.writeInt16LE(sample, i * 2);
    }
    
    // Log resampling stats occasionally
    resamplingStats.totalChunks++;
    resamplingStats.totalInputBytes += audioData.length;
    resamplingStats.totalOutputBytes += outputBuffer.length;
    
    const now = Date.now();
    if (now - resamplingStats.lastLogTime > 10000) { // Log every 10 seconds
      console.log(`🔄 Resampling stats: ${resamplingStats.totalChunks} chunks, ${resamplingStats.totalInputBytes} bytes in → ${resamplingStats.totalOutputBytes} bytes out (ratio: ${(resamplingStats.totalOutputBytes / resamplingStats.totalInputBytes * 100).toFixed(1)}%)`);
      resamplingStats.lastLogTime = now;
    }
    
    return outputBuffer;
  } catch (error: any) {
    console.error(`❌ Error in resampling:`, error);
    // Fallback to simple decimation if resampling fails
    const inputSamples = audioData.length / 2;
    const outputSamples = Math.floor(inputSamples / 3);
    const outputBuffer = Buffer.alloc(outputSamples * 2);
    
    for (let i = 0; i < outputSamples; i++) {
      const inputIndex = i * 3;
      if (inputIndex * 2 + 1 < audioData.length) {
        const sample = audioData.readInt16LE(inputIndex * 2);
        outputBuffer.writeInt16LE(sample, i * 2);
      }
    }
    
    return outputBuffer;
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

