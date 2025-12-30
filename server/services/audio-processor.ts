/**
 * Audio Stream Processor
 * Processes audio streams from LiveKit and routes to transcription service
 */

import libsamplerate from '@alexanderolsen/libsamplerate-js';
const { create, ConverterType } = libsamplerate;
import { audioLogger } from '../utils/logger.js';
import { analyzeAudio, isDebugModeEnabled } from '../utils/audio-debug.js';

// Note: processAudioChunk is no longer used in async architecture
// Audio is now recorded via audio-recorder.ts and processed by transcription-worker.ts

/**
 * Audio Processing Configuration
 * Following industry best practices for voice recording/transcription:
 * - DC offset removal: DISABLED (high-pass filter removes DC naturally)
 * - AGC: DISABLED by default for recording (preserves original dynamics, prevents pumping artifacts)
 * - Normalization: DISABLED (preserves original levels)
 * - Soft limiter: DISABLED for recording (preserves dynamics, only for playback)
 * - High-pass filter: Optional (can be enabled via env var, stateful implementation)
 * - Dithering: DISABLED (not needed for 16-bit voice, causes artifacts)
 */
const AUDIO_PROCESSING_CONFIG = {
  // DC offset removal - DISABLED (high-pass filter removes DC naturally)
  // Per-chunk DC removal causes discontinuities - use high-pass filter instead
  removeDCOffset: false,
  
  // AGC - DISABLED by default for recording (causes distortion if enabled)
  // Enable only for real-time playback, not for archival/transcription
  enableAGC: process.env.ENABLE_AGC === 'true', // Default: false
  agcTargetRMS: parseFloat(process.env.AGC_TARGET_RMS || '-24'), // More conservative if enabled (-24dB)
  
  // Normalization - DISABLED for recording (preserves original dynamics)
  enableNormalization: false,
  
  // Soft limiting - ENABLED to prevent clipping from resampler amplification
  // Resamplers can slightly amplify signals, causing clipping even with moderate input
  // Soft limiter prevents clipping while preserving dynamics (tanh-based compression)
  enableSoftLimiter: true, // ENABLED to prevent clipping from resampler amplification
  limiterThreshold: 0.8, // Lower threshold to prevent clipping from loud input
  
  // High-pass filter - Enabled by default, for noise reduction (stateful implementation)
  // Removes DC offset naturally, so separate DC removal not needed
  enableHighPassFilter: process.env.ENABLE_HIGH_PASS_FILTER !== 'false', // Default: true
  highPassCutoff: parseInt(process.env.HIGH_PASS_CUTOFF || '80', 10), // Hz
};

/**
 * Process audio data from LiveKit egress/webhook
 * This receives audio chunks and routes them to the appropriate transcription stream
 * 
 * Note: LiveKit egress sends PCM16 at 48kHz, but AssemblyAI requires 16kHz
 * We resample the audio before sending to the transcription service
 * 
 * IMPORTANT: Byte order normalization happens in livekit.ts before this function is called.
 * This function receives data that is already normalized to little-endian format.
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

    // Create session key for per-session resampling
    const sessionKey = `${callId}:${participantEmail}`;

    // Resample from 48kHz to 16kHz (AssemblyAI requirement)
    // LiveKit Track Egress sends PCM16 at 48kHz
    // Use per-session resampler for stateful resampling
    const resampledAudio = await resample48kHzTo16kHz(audioBuffer, sessionKey);

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

// INDUSTRY BEST PRACTICE: Per-session resamplers for stateful resampling
// Each callId:participantEmail gets its own resampler instance to maintain continuity
// This prevents discontinuities at chunk boundaries (the "monster voice" issue)
const resamplerInstances = new Map<string, any>(); // Key: sessionKey (callId:participantEmail)
const resamplerInitPromises = new Map<string, Promise<any>>(); // Track initialization promises per session

// INDUSTRY BEST PRACTICE: Per-session filter state for high-pass filter
// Maintains continuity across chunks to prevent discontinuities at boundaries
interface FilterState {
  prevInput: number;
  prevOutput: number;
}
const filterStates = new Map<string, FilterState>(); // Key: sessionKey (callId:participantEmail)

/**
 * Get or create a resampler instance for a specific session
 * Industry best practice: One resampler per audio stream maintains continuity
 * 
 * @param sessionKey - Unique identifier for the session (format: "callId:participantEmail")
 * @returns Resampler instance for this session
 */
async function getResamplerForSession(sessionKey: string): Promise<any> {
  // Return existing resampler if available
  if (resamplerInstances.has(sessionKey)) {
    // #region agent log
    const existingResampler = resamplerInstances.get(sessionKey);
    const hasFull = existingResampler && typeof existingResampler.full === 'function';
    const hasSimple = existingResampler && typeof existingResampler.simple === 'function';
    fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'audio-processor.ts:119',message:'Reusing existing resampler',data:{sessionKey,hasFull,hasSimple,resamplerExists:!!existingResampler},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return resamplerInstances.get(sessionKey);
  }
  
  // Wait for existing initialization if in progress
  if (resamplerInitPromises.has(sessionKey)) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'audio-processor.ts:126',message:'Waiting for resampler init',data:{sessionKey},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return resamplerInitPromises.get(sessionKey);
  }
  
  // Create new resampler for this session
  // INDUSTRY BEST PRACTICE: Use MEDIUM_QUALITY for real-time streaming
  // BEST_QUALITY uses longer filters that can introduce latency and artifacts in streaming
  // MEDIUM_QUALITY provides optimal balance of quality and performance for real-time audio
  const initPromise = create(1, 48000, 16000, {
    converterType: ConverterType.SRC_SINC_MEDIUM_QUALITY,
  }).then(async (resampler) => {
    // CRITICAL FIX: Pre-initialize resampler with silence to warm up internal state
    // The full() method produces fewer samples on first call due to filter initialization
    // Pre-feeding silence ensures first real chunk produces correct output size
    if (typeof resampler.full === 'function') {
      // Create a small silence buffer (20ms at 48kHz = 960 samples)
      const warmupSamples = 960; // Same size as typical input chunk
      const warmupFloat = new Float32Array(warmupSamples); // All zeros (silence)
      
      // Warm up the resampler - this initializes internal filter state
      // CRITICAL: The first call to full() produces fewer samples due to filter initialization
      // We need to warm up multiple times to ensure the resampler is fully initialized
      const warmupOutput1 = resampler.full(warmupFloat);
      // Second warmup call to ensure state is fully initialized
      const warmupOutput2 = resampler.full(warmupFloat);
      
      // Discard the warmup output (it's just silence anyway)
      // The important part is that the resampler's internal state is now initialized
      audioLogger.debug({
        event: 'resampler_warmed_up',
        sessionKey,
        warmupInputSamples: warmupSamples,
        warmupOutput1Samples: warmupOutput1.length,
        warmupOutput2Samples: warmupOutput2.length,
      }, `Resampler warmed up: ${warmupSamples} input samples → ${warmupOutput1.length}, ${warmupOutput2.length} output samples (discarded)`);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'audio-processor.ts:153',message:'Resampler warmup complete',data:{sessionKey,warmupInputSamples:warmupSamples,warmupOutput1Samples:warmupOutput1.length,warmupOutput2Samples:warmupOutput2.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    }
    
    resamplerInstances.set(sessionKey, resampler);
    resamplerInitPromises.delete(sessionKey);
    audioLogger.info({
      event: 'resampler_created',
      sessionKey,
      message: 'Created per-session resampler for stateful resampling (warmed up)',
    }, `✅ Created resampler for session: ${sessionKey} (warmed up)`);
    // #region agent log
    const hasFull = resampler && typeof resampler.full === 'function';
    const hasSimple = resampler && typeof resampler.simple === 'function';
    fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'audio-processor.ts:135',message:'Resampler created and warmed up',data:{sessionKey,hasFull,hasSimple,resamplerType:typeof resampler},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return resampler;
  }).catch((error) => {
    resamplerInitPromises.delete(sessionKey);
    audioLogger.error({
      event: 'resampler_creation_failed',
      sessionKey,
      error: error.message,
    }, `❌ Failed to create resampler for session ${sessionKey}:`, error);
    throw error;
  });
  
  resamplerInitPromises.set(sessionKey, initPromise);
  return initPromise;
}

/**
 * Clear all resampler and filter state (called on server startup/restart)
 * Prevents state from persisting across server restarts
 */
export function clearAllResamplerState(): void {
  const resamplerCount = resamplerInstances.size;
  const filterCount = filterStates.size;
  const promiseCount = resamplerInitPromises.size;
  
  resamplerInstances.clear();
  resamplerInitPromises.clear();
  filterStates.clear();
  
  audioLogger.info({
    event: 'all_resampler_state_cleared',
    resamplerCount,
    filterCount,
    promiseCount,
  }, `🧹 Cleared all resampler state on server startup (${resamplerCount} resamplers, ${filterCount} filters, ${promiseCount} promises)`);
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'audio-processor.ts:206',message:'Cleared all resampler state',data:{resamplerCount,filterCount,promiseCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
  // #endregion
}

/**
 * Clean up resampler and filter state for a session when it ends
 * Prevents memory leaks by removing unused resamplers and filter states
 * 
 * @param sessionKey - Session identifier to clean up
 */
export function cleanupResamplerForSession(sessionKey: string): void {
  if (resamplerInstances.has(sessionKey)) {
    const resampler = resamplerInstances.get(sessionKey);
    // Reset resampler state before cleanup
    if (resampler && typeof resampler.reset === 'function') {
      try {
        resampler.reset();
      } catch (error: any) {
        audioLogger.warn({
          event: 'resampler_reset_failed',
          sessionKey,
          error: error.message,
        }, `⚠️ Failed to reset resampler for session ${sessionKey}:`, error);
      }
    }
    resamplerInstances.delete(sessionKey);
    audioLogger.info({
      event: 'resampler_cleaned_up',
      sessionKey,
      remainingResamplers: resamplerInstances.size,
    }, `🧹 Cleaned up resampler for session: ${sessionKey} (${resamplerInstances.size} remaining)`);
  }
  
  // Also clean up any pending initialization promises
  if (resamplerInitPromises.has(sessionKey)) {
    resamplerInitPromises.delete(sessionKey);
  }
  
  // Clean up filter state for this session
  if (filterStates.has(sessionKey)) {
    filterStates.delete(sessionKey);
    audioLogger.debug({
      event: 'filter_state_cleaned_up',
      sessionKey,
      remainingFilters: filterStates.size,
    }, `🧹 Cleaned up filter state for session: ${sessionKey}`);
  }
}

// Log audio processing configuration at startup
console.log('🎙️ Audio Processing Configuration:');
const dcOffsetStatus = AUDIO_PROCESSING_CONFIG.enableHighPassFilter 
  ? '✅ Enabled (via high-pass filter)' 
  : (AUDIO_PROCESSING_CONFIG.removeDCOffset ? '⚠️ Enabled (per-chunk)' : '❌ Disabled');
console.log(`   DC Offset Removal: ${dcOffsetStatus} (high-pass filter removes DC naturally, per-chunk removal causes discontinuities)`);
console.log(`   AGC: ${AUDIO_PROCESSING_CONFIG.enableAGC ? '⚠️ Enabled' : '✅ Disabled'} (disabled by default for recording - preserves dynamics)`);
if (AUDIO_PROCESSING_CONFIG.enableAGC) {
  console.log(`   AGC Target RMS: ${AUDIO_PROCESSING_CONFIG.agcTargetRMS}dB`);
}
console.log(`   Soft Limiter: ${AUDIO_PROCESSING_CONFIG.enableSoftLimiter ? '⚠️ Enabled' : '❌ Disabled'} (disabled for recording - preserves dynamics, only for playback)`);
console.log(`   High-Pass Filter: ${AUDIO_PROCESSING_CONFIG.enableHighPassFilter ? '✅ Enabled' : '❌ Disabled'} (stateful - removes DC naturally)`);
if (AUDIO_PROCESSING_CONFIG.enableHighPassFilter) {
  console.log(`   High-Pass Cutoff: ${AUDIO_PROCESSING_CONFIG.highPassCutoff}Hz`);
}
console.log(`   Dithering: ❌ Disabled (not needed for 16-bit voice - causes artifacts)`);
console.log(`   Configuration: Following industry best practices for voice recording/transcription`);

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
 * First-order RC high-pass filter implementation (STATEFUL)
 * Removes rumble, HVAC noise, and other low-frequency artifacts below cutoff frequency
 * 
 * INDUSTRY BEST PRACTICE: Stateful filter maintains continuity across chunks
 * Prevents discontinuities at chunk boundaries that cause distortion
 * 
 * @param audioFloat - Float32Array of audio samples
 * @param sampleRate - Sample rate in Hz (e.g., 48000 or 16000)
 * @param cutoffFreq - Cutoff frequency in Hz (default: 80Hz)
 * @param sessionKey - Optional session identifier for stateful filtering
 * @returns Float32Array with high-pass filter applied
 */
export function applyHighPassFilter(
  audioFloat: Float32Array,
  sampleRate: number,
  cutoffFreq: number = 80,
  sessionKey?: string
): Float32Array {
  // RC filter constant: alpha = rc / (rc + dt)
  // where rc = 1 / (2 * PI * cutoffFreq) and dt = 1 / sampleRate
  const rc = 1.0 / (2.0 * Math.PI * cutoffFreq);
  const dt = 1.0 / sampleRate;
  const alpha = rc / (rc + dt);
  
  const result = new Float32Array(audioFloat.length);
  
  // INDUSTRY BEST PRACTICE: Maintain filter state across chunks
  // Get or initialize filter state for this session
  const stateKey = sessionKey || 'default';
  let state = filterStates.get(stateKey);
  if (!state) {
    // Initialize state for new session
    state = { prevInput: 0, prevOutput: 0 };
    filterStates.set(stateKey, state);
  }
  
  let prevInput = state.prevInput;
  let prevOutput = state.prevOutput;
  
  // First-order high-pass filter: y[n] = alpha * (y[n-1] + x[n] - x[n-1])
  for (let i = 0; i < audioFloat.length; i++) {
    const currentInput = audioFloat[i];
    const currentOutput = alpha * (prevOutput + currentInput - prevInput);
    result[i] = currentOutput;
    prevInput = currentInput;
    prevOutput = currentOutput;
  }
  
  // Update state for next chunk
  state.prevInput = prevInput;
  state.prevOutput = prevOutput;
  filterStates.set(stateKey, state);
  
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

/**
 * Resample PCM16 audio from 48kHz to 16kHz using stateful resampling
 * Industry best practice: Uses per-session resamplers with process() method
 * to maintain continuity between chunks and prevent discontinuities
 * 
 * @param audioData - PCM16 audio buffer at 48kHz (already normalized to little-endian)
 * @param sessionKey - Optional session identifier (callId:participantEmail) for per-session resampling
 * @returns Resampled PCM16 audio buffer at 16kHz (little-endian)
 * 
 * IMPORTANT: This function assumes input data is already in little-endian format.
 * Byte order normalization happens in livekit.ts before this function is called.
 */
export async function resample48kHzTo16kHz(
  audioData: Buffer,
  sessionKey?: string
): Promise<Buffer> {
  try {
    // Convert Buffer to Int16Array
    const inputSamples = audioData.length / 2; // 16-bit = 2 bytes per sample
    if (inputSamples === 0) {
      throw new Error('Empty audio buffer');
    }
    
    // CRITICAL: Always use readInt16LE to ensure correct byte order
    // IMPORTANT: Input data is already normalized to little-endian by livekit.ts before this function is called
    // Byte order normalization happens at the system boundary (livekit.ts) before resampling
    // Never use direct Int16Array view as it uses platform byte order which may be wrong
    // Direct Int16Array view would use native byte order (could be big-endian on some systems)
    const inputArray = new Int16Array(inputSamples);
    for (let i = 0; i < inputSamples; i++) {
      inputArray[i] = audioData.readInt16LE(i * 2);
    }
    
    // CRITICAL: Validate input data before processing
    // Valid range for signed 16-bit PCM: -32768 to 32767
    let inputZeroCount = 0;
    let inputMax = 0;
    let inputInvalidCount = 0;
    for (let i = 0; i < inputSamples; i++) {
      const sample = inputArray[i];
      if (sample === 0) inputZeroCount++;
      // Valid range for signed 16-bit: -32768 to 32767
      if (sample < -32768 || sample > 32767) {
        inputInvalidCount++;
        audioLogger.error({
          event: 'invalid_input_sample',
          sampleIndex: i,
          sampleValue: sample,
          minAllowed: -32768,
          maxAllowed: 32767,
        }, `CRITICAL: Input sample ${i} exceeds valid range: ${sample} (valid range: -32768 to 32767)`);
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
    // Use standard 32768.0 normalization (industry standard, avoids asymmetry)
    // This maps -32768 → -1.0 (exact), 0 → 0.0, 32767 → ~0.99997
    // CRITICAL: Apply input gain reduction (0.5x = ~6dB) to prevent clipping
    // Input audio from LiveKit can be very loud (peaks of 30721-32512)
    // Resamplers can slightly amplify signals, causing clipping even with moderate input
    // Very aggressive gain reduction needed to bring loud input to reasonable levels
    const INPUT_GAIN = 0.5; // ~6dB reduction, prevents clipping from very loud input
    let inputFloat = new Float32Array(inputSamples);
    for (let i = 0; i < inputSamples; i++) {
      // Normalize: -32768 → -1.0, 0 → 0.0, 32767 → ~0.99997
      // Using 32768.0 is the standard approach and avoids normalization asymmetry
      // Apply gain reduction to prevent resampler amplification from causing clipping
      inputFloat[i] = (inputArray[i] / 32768.0) * INPUT_GAIN;
    }
    
    // Step 1.1: Optional high-pass filter (for noise reduction and DC removal)
    // INDUSTRY BEST PRACTICE: Stateful filter maintains continuity across chunks
    // High-pass filter naturally removes DC offset, so separate DC removal not needed
    // Note: Applied before resampling, so use input sample rate (48kHz)
    // #region agent log
    const filterStateBefore = filterStates.get(sessionKey || 'default');
    fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'audio-processor.ts:605',message:'Before high-pass filter',data:{sessionKey:sessionKey||'default',enabled:AUDIO_PROCESSING_CONFIG.enableHighPassFilter,hasState:!!filterStateBefore,prevInput:filterStateBefore?.prevInput||0,prevOutput:filterStateBefore?.prevOutput||0,inputSamples:inputFloat.length,chunkNumber:resamplingStats.totalChunks+1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    if (AUDIO_PROCESSING_CONFIG.enableHighPassFilter) {
      inputFloat = applyHighPassFilter(inputFloat, 48000, AUDIO_PROCESSING_CONFIG.highPassCutoff, sessionKey);
      // #region agent log
      const filterStateAfter = filterStates.get(sessionKey || 'default');
      fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'audio-processor.ts:608',message:'After high-pass filter',data:{sessionKey:sessionKey||'default',hasState:!!filterStateAfter,prevInput:filterStateAfter?.prevInput||0,prevOutput:filterStateAfter?.prevOutput||0,outputSamples:inputFloat.length,chunkNumber:resamplingStats.totalChunks+1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
    }
    
    // Step 1.1.5: DC offset removal (only if high-pass filter is disabled)
    // INDUSTRY BEST PRACTICE: Per-chunk DC removal causes discontinuities
    // High-pass filter removes DC naturally, so this is only needed if HPF is disabled
    // However, per-chunk removal causes artifacts, so it's better to use high-pass filter
    if (AUDIO_PROCESSING_CONFIG.removeDCOffset && !AUDIO_PROCESSING_CONFIG.enableHighPassFilter) {
      const dcOffsetBefore = inputFloat.reduce((sum, val) => sum + val, 0) / inputFloat.length;
      inputFloat = removeDCOffset(inputFloat);
      const dcOffsetAfter = inputFloat.reduce((sum, val) => sum + val, 0) / inputFloat.length;
      
      // Log DC offset removal (always log first chunk, then only if significant offset detected)
      if (resamplingStats.totalChunks === 0 || Math.abs(dcOffsetBefore) > 0.001) {
        const logLevel = resamplingStats.totalChunks === 0 ? 'info' : 'debug';
        audioLogger[logLevel]({
          event: 'dc_offset_removed',
          dcOffsetBefore: dcOffsetBefore.toFixed(6),
          dcOffsetAfter: dcOffsetAfter.toFixed(6),
          samples: inputSamples,
          chunkNumber: resamplingStats.totalChunks + 1,
          note: 'Consider using high-pass filter instead to avoid per-chunk discontinuities',
        }, `DC offset removed (chunk ${resamplingStats.totalChunks + 1}): ${dcOffsetBefore.toFixed(6)} -> ${dcOffsetAfter.toFixed(6)}`);
      }
    }
    
    // Step 1.3: AGC - DISABLED by default for recording (preserves original dynamics)
    // Industry best practice: AGC causes pumping artifacts and distortion when applied per-chunk
    // Enable only for real-time playback, not for archival/transcription recordings
    if (AUDIO_PROCESSING_CONFIG.enableAGC) {
      audioLogger.debug({
        event: 'agc_enabled',
        targetRMS: AUDIO_PROCESSING_CONFIG.agcTargetRMS,
        note: 'AGC is enabled - this may cause distortion for recording',
      }, `⚠️ AGC enabled (target RMS: ${AUDIO_PROCESSING_CONFIG.agcTargetRMS}dB) - not recommended for recording`);
      inputFloat = applyAutomaticGainControl(inputFloat, AUDIO_PROCESSING_CONFIG.agcTargetRMS);
    }
    
    // Step 2: Get resampler for this session (or create if needed)
    // INDUSTRY BEST PRACTICE: Use per-session resamplers for stateful resampling
    // This maintains continuity between chunks, preventing discontinuities and artifacts
    const resampler = sessionKey 
      ? await getResamplerForSession(sessionKey)
      : await getResamplerForSession('default'); // Fallback for backward compatibility
    
    if (!resampler) {
      throw new Error('Resampler not initialized');
    }
    
    // Step 3: Resample using stateful full() method (INDUSTRY BEST PRACTICE)
    // CRITICAL FIX: Use full() instead of simple() for continuous audio streams
    // full() maintains state between chunks, ensuring smooth transitions
    // simple() processes each chunk independently, causing discontinuities at boundaries
    // Note: libsamplerate-js uses 'full()' for stateful resampling, not 'process()'
    let outputFloat: Float32Array;
    
    // #region agent log
    const resamplerMethod = typeof resampler.full === 'function' ? 'full' : (typeof resampler.simple === 'function' ? 'simple' : 'none');
    const resamplerHasFull = typeof resampler.full === 'function';
    const resamplerHasSimple = typeof resampler.simple === 'function';
    fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'audio-processor.ts:662',message:'Resampler method check',data:{sessionKey:sessionKey||'default',hasFull:resamplerHasFull,hasSimple:resamplerHasSimple,method:resamplerMethod,inputSamples:inputFloat.length,chunkNumber:resamplingStats.totalChunks+1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    if (typeof resampler.full === 'function') {
      // Use stateful resampling - maintains continuity between chunks
      // This is the industry standard for continuous audio streams
      // full() maintains internal state for smooth transitions between chunks
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'audio-processor.ts:666',message:'Using full() method',data:{sessionKey:sessionKey||'default',inputSamples:inputFloat.length,chunkNumber:resamplingStats.totalChunks+1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      outputFloat = resampler.full(inputFloat);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'audio-processor.ts:669',message:'After full() call',data:{sessionKey:sessionKey||'default',inputSamples:inputFloat.length,outputSamples:outputFloat.length,chunkNumber:resamplingStats.totalChunks+1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    } else if (typeof resampler.simple === 'function') {
      // Fallback to simple() only if full() not available (not recommended)
      audioLogger.warn({
        event: 'resampler_fallback_to_simple',
        sessionKey: sessionKey || 'default',
        message: 'Using stateless simple() - may cause discontinuities at chunk boundaries',
      }, '⚠️ WARNING: Resampler does not have full() method, using simple() (may cause artifacts)');
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'audio-processor.ts:674',message:'Using simple() fallback',data:{sessionKey:sessionKey||'default',inputSamples:inputFloat.length,chunkNumber:resamplingStats.totalChunks+1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      outputFloat = resampler.simple(inputFloat);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'audio-processor.ts:677',message:'After simple() call',data:{sessionKey:sessionKey||'default',inputSamples:inputFloat.length,outputSamples:outputFloat.length,chunkNumber:resamplingStats.totalChunks+1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    } else {
      throw new Error('Resampler has neither full() nor simple() method');
    }
    
    if (!outputFloat || outputFloat.length === 0) {
      throw new Error('Resampling produced empty output');
    }
    
    // DEBUG: Analyze audio characteristics after resampling
    if (isDebugModeEnabled()) {
      const analysis = analyzeAudio(outputFloat, 16000);
      resamplingStats.totalChunks++;
      const chunkNumber = resamplingStats.totalChunks;
      
      // Log analysis for first chunk or every 100 chunks
      if (chunkNumber === 1 || chunkNumber % 100 === 0) {
        audioLogger.info({
          event: 'audio_analysis',
          sessionKey: sessionKey || 'default',
          chunkNumber,
          peak: analysis.peak,
          rms: analysis.rms,
          zeroCrossings: analysis.zeroCrossings,
          estimatedFreq: analysis.estimatedFreq,
          frequencyContent: analysis.frequencyContent,
        }, `🔍 Audio analysis (chunk ${chunkNumber}): peak=${analysis.peak.toFixed(3)}, RMS=${analysis.rms.toFixed(3)}, zeroCrossings=${analysis.zeroCrossings}, estFreq=${analysis.estimatedFreq.toFixed(1)}Hz`);
      }
    }
    
    // Step 3.5: Apply soft limiter to prevent clipping (only if enabled)
    // Industry best practice: Soft limiter prevents clipping but doesn't normalize
    // This preserves dynamics while preventing digital distortion
    let outputFloatLimited = AUDIO_PROCESSING_CONFIG.enableSoftLimiter
      ? applySoftLimiter(outputFloat, AUDIO_PROCESSING_CONFIG.limiterThreshold)
      : outputFloat;
    
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
      const corruptionPercent = ((nanCount + infCount + outOfRangeCount) / outputFloatLimited.length) * 100;
      
      // If too many samples are corrupted, throw error
      if (corruptionPercent > 10) {
        console.error(`❌ CRITICAL: Resampler produced corrupted output!`);
        console.error(`   NaN samples: ${nanCount}, Infinity samples: ${infCount}, Out-of-range samples: ${outOfRangeCount}`);
        console.error(`   Total samples: ${outputFloat.length}, Max absolute value: ${maxAbsValue}`);
        console.error(`   Corruption: ${corruptionPercent.toFixed(1)}% - This will cause severe audio corruption!`);
        throw new Error(`Resampler output is too corrupted: ${corruptionPercent.toFixed(1)}% of samples are invalid`);
      } else {
        // Low corruption (< 10%) is expected for loud/clipping audio - values are clamped correctly
        // Log at warning level, not error, since this is handled gracefully
        audioLogger.warn({
          event: 'resampler_minor_clipping',
          nanCount,
          infCount,
          outOfRangeCount,
          totalSamples: outputFloatLimited.length,
          corruptionPercent: corruptionPercent.toFixed(2),
          maxAbsValue,
          message: 'Resampler detected minor clipping/out-of-range values (expected for loud audio). Values have been clamped to valid range.',
        }, `⚠️ Resampler minor clipping: ${outOfRangeCount} out-of-range samples (${corruptionPercent.toFixed(2)}%) - clamped to valid range. This is normal for loud/clipping audio.`);
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
      
      // Denormalize: -1.0 → -32768, 0.0 → 0, 1.0 → 32767
      // Use 32768.0 to match normalization (standard approach, avoids asymmetry)
      // Math.round() prevents DC bias (Math.floor() introduces -0.5 sample bias)
      // NO DITHERING for 16-bit voice recording - dithering introduces artifacts
      // Dithering is only needed when reducing bit depth (24-bit → 16-bit), not for 16-bit voice
      const sample = Math.max(-32768, Math.min(32767, Math.round(floatValue * 32768.0)));
      
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
    // We write with writeInt16LE(), so data is definitely little-endian
    // No need to check BE interpretation - that was causing false positives
    let zeroSamples = 0;
    let maxSample = 0;
    let avgSample = 0;
    let sum = 0;
    const checkSamples = Math.min(500, outputSamples); // Check more samples for better statistics
    const step = Math.max(1, Math.floor(outputSamples / checkSamples)); // Sample evenly across buffer
    
    for (let i = 0; i < outputSamples; i += step) {
      const sample = outputBuffer.readInt16LE(i * 2);
      const abs = Math.abs(sample);
      
      if (sample === 0) zeroSamples++;
      maxSample = Math.max(maxSample, abs);
      sum += abs;
    }
    
    avgSample = sum / checkSamples;
    
    // Validate that samples are in reasonable range for PCM16
    // Valid range: -32768 to 32767
    // If maxSample > 32767, something is wrong (shouldn't happen with our clamping)
    if (maxSample > 32767) {
      audioLogger.error({
        event: 'resampler_output_invalid_range',
        sessionKey: sessionKey || 'default',
        maxSample,
        avgSample: avgSample.toFixed(1),
        checkSamples,
        message: 'CRITICAL: Resampler output contains values outside PCM16 range! This should never happen with proper clamping.',
      }, `❌ CRITICAL: Resampler output contains invalid sample values! Max=${maxSample} (should be ≤32767)`);
      throw new Error(`Resampler output contains invalid sample values: max=${maxSample} (should be ≤32767)`);
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

