/**
 * Audio Stream Processor
 * Processes audio streams from LiveKit and routes to transcription service
 */

import libsamplerate from '@alexanderolsen/libsamplerate-js';
const { create, ConverterType } = libsamplerate;
import { audioLogger } from '../utils/logger.js';

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

/**
 * Normalize input audio to prevent clipping before processing
 * Scales down high-amplitude input while preserving relative levels
 * 
 * @param inputArray - Int16Array of audio samples
 * @param maxThreshold - Maximum allowed amplitude (default: 80% of Int16 max = 26214)
 * @returns Normalized Int16Array
 */
export function normalizeInputAudio(
  inputArray: Int16Array,
  maxThreshold: number = 26214
): Int16Array {
  // Find max absolute value
  let maxAbs = 0;
  for (let i = 0; i < inputArray.length; i++) {
    maxAbs = Math.max(maxAbs, Math.abs(inputArray[i]));
  }
  
  // If below threshold, no normalization needed
  if (maxAbs <= maxThreshold) {
    return inputArray;
  }
  
  // Calculate scale factor to bring max down to threshold
  const scaleFactor = maxThreshold / maxAbs;
  
  // Apply scaling
  const normalized = new Int16Array(inputArray.length);
  for (let i = 0; i < inputArray.length; i++) {
    normalized[i] = Math.round(inputArray[i] * scaleFactor);
  }
  
  audioLogger.debug({
    event: 'input_normalization_applied',
    originalMax: maxAbs,
    normalizedMax: maxThreshold,
    scaleFactor,
    samples: inputArray.length,
  }, `Input normalization applied: ${maxAbs} -> ${maxThreshold} (scale: ${scaleFactor.toFixed(3)})`);
  
  return normalized;
}

/**
 * Apply Automatic Gain Control (AGC) to normalize audio levels
 * Adjusts gain based on RMS energy to target a consistent level
 * 
 * @param inputFloat - Float32Array of audio samples (-1.0 to 1.0)
 * @param targetRMS - Target RMS level in dB (default: -18dB, good for speech)
 * @returns Float32Array with AGC applied
 */
export function applyAutomaticGainControl(
  inputFloat: Float32Array,
  targetRMS: number = -18
): Float32Array {
  // Calculate current RMS
  let sumSquares = 0;
  for (let i = 0; i < inputFloat.length; i++) {
    sumSquares += inputFloat[i] * inputFloat[i];
  }
  const currentRMS = Math.sqrt(sumSquares / inputFloat.length);
  
  // Convert to dB
  const currentRMSDb = currentRMS > 0 ? 20 * Math.log10(currentRMS) : -Infinity;
  
  // If RMS is too low (likely silence), don't amplify (would amplify noise)
  if (currentRMSDb < -60 || currentRMS < 0.001) {
    return new Float32Array(inputFloat); // Return unchanged
  }
  
  // Calculate gain adjustment needed
  const targetRMSLinear = Math.pow(10, targetRMS / 20);
  let gainFactor = targetRMSLinear / currentRMS;
  
  // Limit gain adjustment to prevent over-amplification
  // Max gain: +12dB (4x), Min gain: -24dB (0.25x)
  gainFactor = Math.max(0.25, Math.min(4.0, gainFactor));
  
  // Apply smooth gain (avoid sudden changes that cause artifacts)
  const result = new Float32Array(inputFloat.length);
  for (let i = 0; i < inputFloat.length; i++) {
    result[i] = inputFloat[i] * gainFactor;
  }
  
  // Log if significant gain adjustment was applied
  if (Math.abs(gainFactor - 1.0) > 0.1) {
    const gainDb = 20 * Math.log10(gainFactor);
    audioLogger.debug({
      event: 'agc_applied',
      currentRMSDb: isFinite(currentRMSDb) ? currentRMSDb : -Infinity,
      targetRMS,
      gainFactor,
      gainDb: isFinite(gainDb) ? gainDb : 0,
      samples: inputFloat.length,
    }, `AGC applied: RMS ${currentRMSDb.toFixed(1)}dB -> ${targetRMS}dB (gain: ${gainDb.toFixed(1)}dB)`);
  }
  
  return result;
}

/**
 * Apply soft limiter to prevent clipping
 * Uses tanh-based compression for smooth limiting above threshold
 * 
 * @param outputFloat - Float32Array of audio samples
 * @param threshold - Limiting threshold (default: 0.95)
 * @returns Float32Array with soft limiting applied
 */
export function applySoftLimiter(
  outputFloat: Float32Array,
  threshold: number = 0.95
): Float32Array {
  let limitedCount = 0;
  let maxValue = 0;
  
  const result = new Float32Array(outputFloat.length);
  
  for (let i = 0; i < outputFloat.length; i++) {
    const value = outputFloat[i];
    const absValue = Math.abs(value);
    maxValue = Math.max(maxValue, absValue);
    
    if (absValue > threshold) {
      limitedCount++;
      // Use tanh-based soft limiting for smooth compression
      // tanh(x) provides smooth compression curve
      const sign = value >= 0 ? 1 : -1;
      const normalized = absValue / threshold;
      // Apply tanh compression: tanh(x) where x is scaled to compress smoothly
      // Scale factor of 2.0 provides good compression curve
      const compressed = Math.tanh(normalized * 2.0) * threshold;
      result[i] = sign * compressed;
    } else {
      result[i] = value;
    }
  }
  
  // Log if limiting was applied
  if (limitedCount > 0) {
    const limitingPercent = (limitedCount / outputFloat.length) * 100;
    audioLogger.warn({
      event: 'soft_limiting_applied',
      limitedSamples: limitedCount,
      totalSamples: outputFloat.length,
      limitingPercent,
      maxValue,
      threshold,
    }, `Soft limiting applied: ${limitedCount} samples (${limitingPercent.toFixed(1)}%), max: ${maxValue.toFixed(3)}`);
  }
  
  return result;
}

export async function resample48kHzTo16kHz(audioData: Buffer): Promise<Buffer> {
  try {
    // Convert Buffer to Int16Array
    const inputSamples = audioData.length / 2; // 16-bit = 2 bytes per sample
    if (inputSamples === 0) {
      throw new Error('Empty audio buffer');
    }
    
    // CRITICAL FIX: Always use readInt16LE to ensure correct byte order
    // Never use direct Int16Array view as it uses platform byte order which may be wrong
    // LiveKit sends PCM16 in little-endian format, so we must always read as LE
    // Direct Int16Array view would use native byte order (could be big-endian on some systems)
    const inputArray = new Int16Array(inputSamples);
    for (let i = 0; i < inputSamples; i++) {
      inputArray[i] = audioData.readInt16LE(i * 2);
    }
    
    // CRITICAL: Validate input data before processing
    let inputZeroCount = 0;
    let inputMax = 0;
    let inputInvalidCount = 0;
    for (let i = 0; i < inputSamples; i++) {
      const sample = inputArray[i];
      if (sample === 0) inputZeroCount++;
      if (Math.abs(sample) > 32767) {
        inputInvalidCount++;
        audioLogger.error({
          event: 'invalid_input_sample',
          sampleIndex: i,
          sampleValue: sample,
          maxAllowed: 32767,
        }, `CRITICAL: Input sample ${i} exceeds valid range: ${sample} (max should be 32767)`);
      }
      inputMax = Math.max(inputMax, Math.abs(sample));
    }
    
    // Log input validation (first chunk or if issues detected)
    if (inputInvalidCount > 0) {
      audioLogger.error({
        event: 'corrupted_input',
        inputInvalidCount,
        inputSamples,
        message: 'Input samples exceed valid range - input data is corrupted',
      }, `CRITICAL: ${inputInvalidCount} input samples exceed valid range - input data is corrupted!`);
      throw new Error('Input audio data is corrupted or in wrong format');
    }
    
    if (inputSamples > 100 && inputMax === 0) {
      audioLogger.warn({
        event: 'all_zeros_input',
        inputSamples,
        message: 'Input audio appears to be all zeros - might be silence or corrupted input',
      }, 'WARNING: Input audio appears to be all zeros');
    }
    
    // Step 1: Convert Int16 to Float32 (normalize to -1.0 to 1.0)
    // FIX: Use proper normalization - Int16 range is -32768 to 32767
    // Divide by 32768.0 (not 32767) to get proper -1.0 to ~0.999 range
    let inputFloat = new Float32Array(inputSamples);
    for (let i = 0; i < inputSamples; i++) {
      // Normalize: -32768 -> -1.0, 0 -> 0.0, 32767 -> ~0.999
      inputFloat[i] = inputArray[i] / 32768.0;
    }
    
    // Step 1.5: Apply Automatic Gain Control (AGC) to normalize audio levels
    inputFloat = applyAutomaticGainControl(inputFloat);
    
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
      audioLogger.warn({
        event: 'resampler_fallback',
        message: 'Resampler does not have simple() method, using process() (may cause state issues)',
      }, 'Resampler does not have simple() method, using process()');
      // CRITICAL: Reset state before processing to avoid artifacts between chunks
      if (typeof resampler.reset === 'function') {
        resampler.reset();
      }
      outputFloat = resampler.process(inputFloat);
    } else {
      throw new Error('Resampler has neither simple() nor process() method');
    }
    
    if (!outputFloat || outputFloat.length === 0) {
      throw new Error('Resampling produced empty output');
    }
    
    // Step 3.5: Apply soft limiter to prevent clipping
    let outputFloatLimited = applySoftLimiter(outputFloat);
    
    // CRITICAL: Validate resampler output for corruption
    let nanCount = 0;
    let infCount = 0;
    let outOfRangeCount = 0;
    let maxAbsValue = 0;
    
    for (let i = 0; i < outputFloatLimited.length; i++) {
      const value = outputFloatLimited[i];
      
      if (isNaN(value)) {
        nanCount++;
        outputFloatLimited[i] = 0; // Replace NaN with 0
      } else if (!isFinite(value)) {
        infCount++;
        outputFloatLimited[i] = value > 0 ? 1.0 : -1.0; // Clamp Infinity
      } else if (Math.abs(value) > 1.0) {
        outOfRangeCount++;
        outputFloatLimited[i] = Math.max(-1.0, Math.min(1.0, value)); // Clamp to valid range
      }
      
      maxAbsValue = Math.max(maxAbsValue, Math.abs(outputFloatLimited[i]));
    }
    
    if (nanCount > 0 || infCount > 0 || outOfRangeCount > 0) {
      console.error(`❌ CRITICAL: Resampler produced corrupted output!`);
      console.error(`   NaN samples: ${nanCount}, Infinity samples: ${infCount}, Out-of-range samples: ${outOfRangeCount}`);
      console.error(`   Total samples: ${outputFloat.length}, Max absolute value: ${maxAbsValue}`);
      console.error(`   This will cause severe audio corruption!`);
      
      // If too many samples are corrupted, throw error
      const corruptionPercent = ((nanCount + infCount + outOfRangeCount) / outputFloatLimited.length) * 100;
      if (corruptionPercent > 10) {
        throw new Error(`Resampler output is too corrupted: ${corruptionPercent.toFixed(1)}% of samples are invalid`);
      }
    }
    
    // Step 4: Convert Float32 back to Int16 Buffer
    // FIX: Use proper denormalization - multiply by 32768.0 and clamp
    const outputSamples = outputFloatLimited.length;
    const outputBuffer = Buffer.alloc(outputSamples * 2);
    let invalidSampleCount = 0;
    
    for (let i = 0; i < outputSamples; i++) {
      // CRITICAL: Ensure value is in valid range before conversion
      const floatValue = Math.max(-1.0, Math.min(1.0, outputFloatLimited[i]));
      
      // Denormalize: -1.0 -> -32768, 0.0 -> 0, 1.0 -> 32768 (clamp to 32767)
      // Use Math.floor for more predictable rounding (avoids bias)
      const sample = Math.max(-32768, Math.min(32767, Math.floor(floatValue * 32768.0)));
      
      // CRITICAL: Validate the sample value before writing
      if (isNaN(sample) || !isFinite(sample)) {
        invalidSampleCount++;
        if (invalidSampleCount <= 5) {
          audioLogger.error({
            event: 'invalid_output_sample',
            sampleIndex: i,
            sampleValue: sample,
            floatValue: outputFloatLimited[i],
          }, `CRITICAL: Invalid sample value at index ${i}: ${sample}`);
        }
        outputBuffer.writeInt16LE(0, i * 2); // Write 0 instead of corrupted value
      } else {
        outputBuffer.writeInt16LE(sample, i * 2);
      }
    }
    
    if (invalidSampleCount > 5) {
      audioLogger.error({
        event: 'multiple_invalid_samples',
        invalidSampleCount,
        totalSamples: outputSamples,
        percentage: (invalidSampleCount / outputSamples) * 100,
        message: 'Multiple invalid samples detected in output buffer',
      }, `CRITICAL: ${invalidSampleCount} invalid samples detected in output buffer!`);
    }
    
    // CRITICAL: Verify output buffer contains valid audio data
    let zeroSamples = 0;
    let maxSample = 0;
    const checkSamples = Math.min(100, outputSamples);
    for (let i = 0; i < checkSamples; i++) {
      const sample = outputBuffer.readInt16LE(i * 2);
      if (sample === 0) zeroSamples++;
      maxSample = Math.max(maxSample, Math.abs(sample));
    }
    
    // If all samples are zero, something is wrong
    if (zeroSamples === checkSamples && maxSample === 0 && outputSamples > 100) {
      audioLogger.warn({
        event: 'zeros_in_output',
        checkSamples,
        message: 'First samples are all zeros - might indicate corruption or silence',
      }, `WARNING: First ${checkSamples} samples are all zeros`);
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
    const peakValue = Math.max(...Array.from(outputFloatLimited).map(Math.abs));
    const rmsValue = Math.sqrt(outputFloatLimited.reduce((sum, val) => sum + val * val, 0) / outputFloatLimited.length);
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
      audioLogger.warn({
        event: 'audio_clipping',
        peakValue,
        message: 'Audio clipping detected in resampled output',
      }, `Audio clipping detected in resampled output! Peak: ${peakValue.toFixed(4)}`);
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

