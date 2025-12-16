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

/**
 * Remove DC offset from audio signal
 * Centers the audio signal around zero by subtracting the mean value
 * 
 * @param audioFloat - Float32Array of audio samples (-1.0 to 1.0)
 * @returns Float32Array with DC offset removed
 */
export function removeDCOffset(audioFloat: Float32Array): Float32Array {
  // Calculate mean value (DC offset)
  let sum = 0;
  for (let i = 0; i < audioFloat.length; i++) {
    sum += audioFloat[i];
  }
  const mean = sum / audioFloat.length;
  
  // Subtract mean from all samples
  const result = new Float32Array(audioFloat.length);
  for (let i = 0; i < audioFloat.length; i++) {
    result[i] = audioFloat[i] - mean;
  }
  
  return result;
}

/**
 * Apply high-pass filter to remove low-frequency noise
 * First-order RC high-pass filter implementation
 * Removes rumble, HVAC noise, and other low-frequency artifacts below cutoff frequency
 * 
 * @param audioFloat - Float32Array of audio samples
 * @param sampleRate - Sample rate in Hz (e.g., 48000 or 16000)
 * @param cutoffFreq - Cutoff frequency in Hz (default: 80Hz)
 * @returns Float32Array with high-pass filter applied
 */
export function applyHighPassFilter(
  audioFloat: Float32Array,
  sampleRate: number,
  cutoffFreq: number = 80
): Float32Array {
  // RC filter constant: alpha = rc / (rc + dt)
  // where rc = 1 / (2 * PI * cutoffFreq) and dt = 1 / sampleRate
  const rc = 1.0 / (2.0 * Math.PI * cutoffFreq);
  const dt = 1.0 / sampleRate;
  const alpha = rc / (rc + dt);
  
  const result = new Float32Array(audioFloat.length);
  
  // FIX: Initialize prevInput to 0, not first sample
  // Using audioFloat[0] as prevInput causes incorrect filtering at the start of each chunk
  // This creates artifacts and distortion, especially noticeable in voice
  let prevInput = 0;
  let prevOutput = 0;
  
  // First-order high-pass filter: y[n] = alpha * (y[n-1] + x[n] - x[n-1])
  for (let i = 0; i < audioFloat.length; i++) {
    const currentInput = audioFloat[i];
    const currentOutput = alpha * (prevOutput + currentInput - prevInput);
    result[i] = currentOutput;
    prevInput = currentInput;
    prevOutput = currentOutput;
  }
  
  return result;
}

/**
 * Normalize audio levels to prevent clipping and ensure consistent volume
 * Adjusts gain to target peak amplitude while preventing clipping
 * 
 * @param audioFloat - Float32Array of audio samples
 * @param targetPeak - Target peak amplitude (default: 0.95, range: 0.0 to 1.0)
 * @returns Float32Array with normalized levels
 */
export function normalizeAudio(
  audioFloat: Float32Array,
  targetPeak: number = 0.90
): Float32Array {
  // Find peak amplitude
  let peak = 0;
  for (let i = 0; i < audioFloat.length; i++) {
    const abs = Math.abs(audioFloat[i]);
    if (abs > peak) {
      peak = abs;
    }
  }
  
  // If audio is too quiet, don't amplify (would amplify noise)
  // Lower threshold to 0.005 to catch audio that's been filtered/processed
  // but is still valid speech (just quieter after processing)
  if (peak < 0.005) {
    // Very quiet audio (< 0.005) is likely silence or noise, don't amplify
    return new Float32Array(audioFloat);
  }
  
  // If already loud enough, don't amplify (would cause clipping)
  if (peak >= targetPeak) {
    return new Float32Array(audioFloat);
  }
  
  // Cap gain at 2x to avoid over-amplification and artifacts
  const gain = Math.min(targetPeak / peak, 2.0);
  
  // Apply gain
  const result = new Float32Array(audioFloat.length);
  for (let i = 0; i < audioFloat.length; i++) {
    result[i] = audioFloat[i] * gain;
  }
  
  return result;
}

/**
 * Detect if audio contains speech based on RMS energy
 * Useful for voice activity detection (VAD) in future enhancements
 * 
 * @param audioFloat - Float32Array of audio samples
 * @param threshold - RMS energy threshold (default: 0.01)
 * @returns true if RMS energy exceeds threshold (likely contains speech)
 */
export function hasSpeech(
  audioFloat: Float32Array,
  threshold: number = 0.01
): boolean {
  // Calculate RMS (Root Mean Square) energy
  let sumSquares = 0;
  for (let i = 0; i < audioFloat.length; i++) {
    sumSquares += audioFloat[i] * audioFloat[i];
  }
  const rms = Math.sqrt(sumSquares / audioFloat.length);
  
  return rms > threshold;
}

export async function resample48kHzTo16kHz(audioData: Buffer): Promise<Buffer> {
  try {
    // Convert Buffer to Int16Array
    const inputSamples = audioData.length / 2; // 16-bit = 2 bytes per sample
    if (inputSamples === 0) {
      throw new Error('Empty audio buffer');
    }
    
    // FIX: Ensure proper buffer alignment for Int16Array
    // If the buffer isn't aligned, create a copy
    let inputArray: Int16Array;
    if (audioData.byteOffset % 2 === 0 && audioData.length % 2 === 0) {
      // Buffer is properly aligned
      inputArray = new Int16Array(audioData.buffer, audioData.byteOffset, inputSamples);
    } else {
      // Buffer not aligned, create aligned copy
      inputArray = new Int16Array(inputSamples);
      for (let i = 0; i < inputSamples; i++) {
        inputArray[i] = audioData.readInt16LE(i * 2);
      }
    }
    
    // Step 1: Convert Int16 to Float32 (normalize to -1.0 to 1.0)
    // FIX: Use proper normalization - Int16 range is -32768 to 32767
    // Divide by 32768.0 (not 32767) to get proper -1.0 to ~0.999 range
    const inputFloat = new Float32Array(inputSamples);
    for (let i = 0; i < inputSamples; i++) {
      // Normalize: -32768 -> -1.0, 0 -> 0.0, 32767 -> ~0.999
      inputFloat[i] = inputArray[i] / 32768.0;
    }
    
    // Step 2: Get resampler (wait for initialization if needed)
    const resampler = await getResampler();
    
    if (!resampler) {
      throw new Error('Resampler not initialized');
    }
    
    // Step 3: Resample using high-quality algorithm (48kHz -> 16kHz)
    // CRITICAL: Use simple() for stateless resampling (more reliable for independent chunks)
    // process() is stateful and can cause issues with streaming chunks
    // simple() processes each chunk independently, ensuring correct resampling
    let outputFloat: Float32Array;
    
    // Always prefer simple() for stateless resampling (safer for independent chunks)
    if (typeof resampler.simple === 'function') {
      outputFloat = resampler.simple(inputFloat);
    } else if (typeof resampler.process === 'function') {
      // Fallback to process() only if simple() not available
      console.warn('⚠️ Resampler does not have simple() method, using process() (may cause state issues)');
      outputFloat = resampler.process(inputFloat);
    } else {
      throw new Error('Resampler has neither simple() nor process() method');
    }
    
    if (!outputFloat || outputFloat.length === 0) {
      throw new Error('Resampling produced empty output');
    }
    
    // Step 4: Convert Float32 back to Int16 Buffer
    // FIX: Use proper denormalization - multiply by 32768.0 and clamp
    const outputSamples = outputFloat.length;
    const outputBuffer = Buffer.alloc(outputSamples * 2);
    for (let i = 0; i < outputSamples; i++) {
      // Denormalize: -1.0 -> -32768, 0.0 -> 0, 1.0 -> 32768 (clamp to 32767)
      const sample = Math.max(-32768, Math.min(32767, Math.round(outputFloat[i] * 32768.0)));
      outputBuffer.writeInt16LE(sample, i * 2);
    }
    
    // CRITICAL: Verify resampling ratio (should be ~0.333 for 48kHz -> 16kHz)
    const actualRatio = outputSamples / inputSamples;
    const expectedRatio = 16000 / 48000; // Should be exactly 1/3 = 0.333...
    const ratioDiff = Math.abs(actualRatio - expectedRatio);
    
    // Also verify output size is approximately 1/3 of input
    const expectedOutputSamples = Math.floor(inputSamples / 3);
    const sizeDiff = Math.abs(outputSamples - expectedOutputSamples);
    const sizeDiffPercent = (sizeDiff / expectedOutputSamples) * 100;
    
    // Ratio check is more critical - catches incorrect resampling even if size is close
    if (ratioDiff > 0.05) {
      const speedMultiplier = 1 / actualRatio;
      console.error(
        `❌ CRITICAL: Resampling ratio incorrect! ` +
        `Expected ~${expectedRatio.toFixed(3)} (16kHz/48kHz), ` +
        `got ${actualRatio.toFixed(3)}. ` +
        `Audio will sound ${speedMultiplier.toFixed(1)}x wrong speed!`
      );
      console.error(`   Input: ${inputSamples} samples (${(inputSamples/48000).toFixed(3)}s at 48kHz)`);
      console.error(`   Output: ${outputSamples} samples (${(outputSamples/16000).toFixed(3)}s at 16kHz)`);
      console.error(`   If audio is actually 48kHz, it would sound ${(48000/16000).toFixed(1)}x slower (deep and slow)`);
      console.error(`   If audio is actually 16kHz, it would sound ${(16000/48000).toFixed(1)}x faster (chipmunks)`);
      
      // Throw error to prevent saving incorrectly resampled audio
      throw new Error(
        `Resampling failed: ratio ${actualRatio.toFixed(3)} is too far from expected ${expectedRatio.toFixed(3)}`
      );
    }
    
    // Size check as secondary verification
    if (sizeDiffPercent > 10) {
      console.warn(`⚠️ Resampling output size unexpected: input=${inputSamples} samples, output=${outputSamples} samples, expected~${expectedOutputSamples} samples (${sizeDiffPercent.toFixed(1)}% difference)`);
      // Don't throw for size mismatch alone if ratio is correct (ratio is more important)
    }
    
    // Enhanced quality metrics logging
    resamplingStats.totalChunks++;
    resamplingStats.totalInputBytes += audioData.length;
    resamplingStats.totalOutputBytes += outputBuffer.length;
    
    // Calculate quality metrics
    const peakValue = Math.max(...Array.from(outputFloat).map(Math.abs));
    const rmsValue = Math.sqrt(outputFloat.reduce((sum, val) => sum + val * val, 0) / outputFloat.length);
    const inputPeak = Math.max(...Array.from(inputFloat).map(Math.abs));
    const inputRMS = Math.sqrt(inputFloat.reduce((sum, val) => sum + val * val, 0) / inputFloat.length);
    
    // Check for clipping (should be < 1.0)
    const clippingDetected = peakValue >= 0.99;
    
    const now = Date.now();
    if (now - resamplingStats.lastLogTime > 10000) { // Log every 10 seconds
      const overallRatio = resamplingStats.totalOutputBytes / resamplingStats.totalInputBytes;
      const expectedOverallRatio = 16000 / 48000;
      const ratioAccuracy = (1 - Math.abs(overallRatio - expectedOverallRatio) / expectedOverallRatio) * 100;
      
      console.log(`🔄 Resampling stats: ${resamplingStats.totalChunks} chunks, ${resamplingStats.totalInputBytes} bytes in → ${resamplingStats.totalOutputBytes} bytes out`);
      console.log(`   Overall ratio: ${(overallRatio * 100).toFixed(1)}% (expected ${(expectedOverallRatio * 100).toFixed(1)}%, accuracy: ${ratioAccuracy.toFixed(1)}%)`);
      console.log(`🔍 Input audio: peak=${inputPeak.toFixed(4)}, RMS=${inputRMS.toFixed(4)}, samples=${inputSamples} (${(inputSamples/48000).toFixed(3)}s)`);
      console.log(`🔍 Output audio: peak=${peakValue.toFixed(4)}, RMS=${rmsValue.toFixed(4)}, samples=${outputSamples} (${(outputSamples/16000).toFixed(3)}s)${clippingDetected ? ' ⚠️ CLIPPING!' : ''}`);
      console.log(`   Resampling ratio: ${actualRatio.toFixed(3)} (expected ${expectedRatio.toFixed(3)}, diff: ${(ratioDiff * 100).toFixed(2)}%)`);
      resamplingStats.lastLogTime = now;
    }
    
    // Warn about clipping on every chunk (important for quality)
    if (clippingDetected) {
      console.warn(`⚠️ Audio clipping detected in resampled output! Peak: ${peakValue.toFixed(4)}`);
    }
    
    return outputBuffer;
  } catch (error: any) {
    console.error(`❌ Error in resampling:`, error);
    console.error(`   Input size: ${audioData.length} bytes (${audioData.length / 2} samples)`);
    
    // Fallback to simple decimation if resampling fails
    const inputSamples = audioData.length / 2;
    const outputSamples = Math.floor(inputSamples / 3);
    
    if (outputSamples === 0) {
      console.error(`❌ Cannot create fallback resampling: input too small (${inputSamples} samples)`);
      throw new Error('Resampling failed and fallback cannot be applied');
    }
    
    const outputBuffer = Buffer.alloc(outputSamples * 2);
    
    for (let i = 0; i < outputSamples; i++) {
      const inputIndex = i * 3;
      if (inputIndex * 2 + 1 < audioData.length) {
        const sample = audioData.readInt16LE(inputIndex * 2);
        outputBuffer.writeInt16LE(sample, i * 2);
      }
    }
    
    console.warn(`⚠️ Used fallback decimation resampling: ${inputSamples} samples → ${outputSamples} samples`);
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

