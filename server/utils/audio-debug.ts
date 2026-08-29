/**
 * Audio Debugging Utilities
 * Provides functions for saving intermediate audio stages and analyzing audio characteristics
 * Used for debugging audio distortion issues
 */

import { Storage } from '@google-cloud/storage';
import { createWavHeader } from '../services/audio-recorder.js';
import { audioLogger } from './logger.js';
import { readFileSync, existsSync, mkdirSync, createWriteStream, writeFileSync } from 'fs';
import { join } from 'path';
import { getGoogleCloudConfig } from './google-cloud.js';

// Local debug audio directory
const DEBUG_AUDIO_DIR = join(process.cwd(), 'logs', 'debug-audio');

// Ensure debug audio directory exists
if (!existsSync(DEBUG_AUDIO_DIR)) {
  mkdirSync(DEBUG_AUDIO_DIR, { recursive: true });
}

// Initialize storage client (lazy initialization)
let storageClient: Storage | null = null;

// Stream directly to GCS and local filesystem for 45-second debug files
// Key: sessionKey (callId:participantEmail:type), Value: stream info
interface DebugStreamInfo {
  writeStream: NodeJS.WritableStream; // GCS stream
  file: any; // GCS File object
  localWriteStream?: NodeJS.WritableStream; // Local file stream
  localFilePath?: string; // Local file path
  pcmBytesWritten: number; // Track PCM bytes (excluding header)
  lastChunkNumber: number;
  targetSize: number;
  sampleRate: number;
  orgSlug?: string;
  callId: string;
  participantEmail: string;
  type: 'original_48khz' | 'resampled_16khz';
  finishHandlerSet: boolean; // Track if finish handler is already set up
}

const debugStreams = new Map<string, DebugStreamInfo>();

// 45 seconds of audio at different sample rates
const DEBUG_DURATION_SECONDS = 45;
const BYTES_PER_SECOND_48KHZ = 48000 * 2; // 48kHz * 2 bytes per sample
const BYTES_PER_SECOND_16KHZ = 16000 * 2; // 16kHz * 2 bytes per sample
const TARGET_SIZE_48KHZ = DEBUG_DURATION_SECONDS * BYTES_PER_SECOND_48KHZ; // 4,320,000 bytes
const TARGET_SIZE_16KHZ = DEBUG_DURATION_SECONDS * BYTES_PER_SECOND_16KHZ; // 1,440,000 bytes

function getStorageClient(): Storage {
  if (!storageClient) {
    const { projectId } = getGoogleCloudConfig();
    const retryOptions = {
      autoRetry: true,
      maxRetries: 8,
      retryDelayMultiplier: 2,
      totalTimeout: 900000, // 15 minutes
      maxRetryDelay: 120000, // Max 2 minutes between retries
    };
    
    storageClient = new Storage({ projectId, retryOptions });
  }
  return storageClient;
}

/**
 * Check if debug mode is enabled
 * @returns true if DEBUG_AUDIO environment variable is set to 'true'
 */
export function isDebugModeEnabled(): boolean {
  return process.env.DEBUG_AUDIO === 'true';
}

/**
 * Stream and save 45-second debug audio files directly to GCS
 * Streams chunks directly to GCS, stopping at exactly 45 seconds
 * 
 * INDUSTRY BEST PRACTICE: Streams directly to GCS without accumulating in memory
 * This matches the production pattern and ensures proper ordering naturally
 * 
 * @param pcmData - PCM16 audio buffer (typically 20ms chunks)
 * @param sampleRate - Sample rate in Hz (e.g., 48000 or 16000)
 * @param sessionKey - Unique session identifier (callId:participantEmail:type)
 * @param orgSlug - Organization slug for path construction (optional)
 * @param callId - Call ID for file naming
 * @param participantEmail - Participant email for file naming
 * @param type - Type of debug audio ('original_48khz' or 'resampled_16khz')
 * @param chunkNumber - Chunk sequence number for logging (optional)
 */
export async function accumulateAndSaveDebugAudio(
  pcmData: Buffer,
  sampleRate: number,
  sessionKey: string,
  orgSlug: string | undefined,
  callId: string,
  participantEmail: string,
  type: 'original_48khz' | 'resampled_16khz',
  chunkNumber: number
): Promise<void> {
  // Get or create write stream
  let streamInfo = debugStreams.get(sessionKey);
  
  if (!streamInfo) {
    // Create local file path
    const localFileName = `${type}_${callId}_${participantEmail}_45sec.wav`;
    const localFilePath = join(DEBUG_AUDIO_DIR, localFileName);
    
    // Create local file write stream
    const localWriteStream = createWriteStream(localFilePath);
    
    // Create GCS write stream
    const bucketName = process.env.AUDIO_STORAGE_BUCKET || 'leanworks-prod';
    const client = getStorageClient();
    const bucket = client.bucket(bucketName);
    const debugPath = `${type}_${callId}_${participantEmail}_45sec.wav`;
    const fullPath = orgSlug 
      ? `debug/${orgSlug}/${debugPath}`
      : `debug/${debugPath}`;
    const file = bucket.file(fullPath);
    
    const writeStream = file.createWriteStream({
      resumable: true,
      timeout: 600000, // 10 minutes
      metadata: {
        contentType: 'audio/wav',
        cacheControl: 'no-transform', // Prevent transcoding
        metadata: {
          debug: 'true',
          sampleRate: sampleRate.toString(),
          timestamp: Date.now().toString(),
        },
      },
    });
    
    const targetSize = sampleRate === 48000 ? TARGET_SIZE_48KHZ : TARGET_SIZE_16KHZ;
    
    // Write WAV header with target size (will be updated later with actual size)
    const header = createWavHeader(targetSize, sampleRate);
    writeStream.write(header);
    localWriteStream.write(header); // Also write to local file
    
    streamInfo = {
      writeStream,
      file,
      localWriteStream,
      localFilePath,
      pcmBytesWritten: 0,
      lastChunkNumber: 0,
      targetSize,
      sampleRate,
      orgSlug,
      callId,
      participantEmail,
      type,
      finishHandlerSet: false,
    };
    debugStreams.set(sessionKey, streamInfo);
    
    // Handle GCS stream errors
    writeStream.on('error', (error: any) => {
      audioLogger.error({
        event: 'debug_stream_error',
        sessionKey,
        type,
        error: error.message,
        stack: error.stack,
      }, `❌ Error in debug stream: ${error.message}`);
      debugStreams.delete(sessionKey);
    });
    
    // Handle local stream errors (non-blocking - GCS stream can continue)
    localWriteStream.on('error', (error: any) => {
      audioLogger.error({
        event: 'debug_local_stream_error',
        sessionKey,
        type,
        localFilePath,
        error: error.message,
      }, `❌ Error in local debug stream: ${error.message}`);
      // Don't delete streamInfo - GCS stream might still work
    });
    
    audioLogger.info({
      event: 'debug_streams_created',
      sessionKey,
      type,
      localFilePath,
      gcsPath: fullPath,
      sampleRate,
    }, `🔍 DEBUG: Created debug streams - local: ${localFilePath}, GCS: ${fullPath}`);
  }
  
  // CRITICAL: Validate sample rate matches the stream's sample rate
  // This prevents mixing different sample rates in the same file (causes distortion)
  if (streamInfo.sampleRate !== sampleRate) {
    audioLogger.error({
      event: 'debug_sample_rate_mismatch',
      sessionKey,
      type: streamInfo.type,
      streamSampleRate: streamInfo.sampleRate,
      chunkSampleRate: sampleRate,
      chunkNumber,
      lastChunkNumber: streamInfo.lastChunkNumber,
    }, `❌ DEBUG: Sample rate mismatch! Stream is ${streamInfo.sampleRate}Hz but chunk ${chunkNumber} is ${sampleRate}Hz. Rejecting chunk to prevent distortion.`);
    return; // Reject chunk - don't write mismatched sample rate
  }
  
  // Validate chunk size matches expected size for this sample rate
  // This helps catch sample rate detection errors early
  const expectedChunkSize = Math.floor((20 / 1000) * streamInfo.sampleRate * 2); // 20ms chunk
  const sizeDiff = Math.abs(pcmData.length - expectedChunkSize);
  const sizeDiffPercent = (sizeDiff / expectedChunkSize) * 100;
  
  if (sizeDiffPercent > 10) { // More than 10% difference
    audioLogger.warn({
      event: 'debug_unexpected_chunk_size',
      sessionKey,
      type: streamInfo.type,
      sampleRate: streamInfo.sampleRate,
      expectedSize: expectedChunkSize,
      actualSize: pcmData.length,
      sizeDiffPercent: sizeDiffPercent.toFixed(1),
      chunkNumber,
    }, `⚠️ DEBUG: Unexpected chunk size for ${streamInfo.sampleRate}Hz: expected ~${expectedChunkSize} bytes, got ${pcmData.length} bytes (${sizeDiffPercent.toFixed(1)}% difference)`);
  }
  
  // Check if we've already written 45 seconds
  if (streamInfo.pcmBytesWritten >= streamInfo.targetSize) {
    // Already saved 45 seconds, ignore this chunk
    return;
  }
  
  // Calculate how much we can write (don't exceed 45 seconds)
  const remainingBytes = streamInfo.targetSize - streamInfo.pcmBytesWritten;
  const bytesToWrite = Math.min(pcmData.length, remainingBytes);
  const chunkToWrite = pcmData.subarray(0, bytesToWrite);
  
  // Stream chunk directly to GCS and local file
  await new Promise<void>((resolve, reject) => {
    const canWrite = streamInfo.writeStream.write(chunkToWrite, (error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      
      // Also write to local file stream (non-blocking)
      if (streamInfo.localWriteStream && !streamInfo.localWriteStream.destroyed) {
        streamInfo.localWriteStream.write(chunkToWrite, (localError?: Error | null) => {
          if (localError) {
            audioLogger.warn({
              event: 'debug_local_write_error',
              sessionKey,
              chunkNumber,
              error: localError.message,
            }, `⚠️ Failed to write to local debug file: ${localError.message}`);
            // Continue even if local write fails
          }
        });
      }
      
      streamInfo.pcmBytesWritten += bytesToWrite;
      streamInfo.lastChunkNumber = chunkNumber;
      
      // Check if we've reached 45 seconds
      if (streamInfo.pcmBytesWritten >= streamInfo.targetSize) {
        // Set up finish handler before closing (only once)
        if (!streamInfo.writeStream.writableEnded && !streamInfo.finishHandlerSet) {
          streamInfo.finishHandlerSet = true;
          streamInfo.writeStream.once('finish', async () => {
            try {
              // Download GCS file to update header
              const [fileBuffer] = await streamInfo.file.download();
              
              // Update WAV header with actual sizes
              // RIFF chunk size (bytes 4-7): 36 + pcmBytesWritten
              fileBuffer.writeUInt32LE(36 + streamInfo.pcmBytesWritten, 4);
              // Data chunk size (bytes 40-43): pcmBytesWritten
              fileBuffer.writeUInt32LE(streamInfo.pcmBytesWritten, 40);
              
              // Save updated GCS file
              await streamInfo.file.save(fileBuffer, {
                metadata: {
                  contentType: 'audio/wav',
                  cacheControl: 'no-transform',
                  metadata: {
                    debug: 'true',
                    sampleRate: streamInfo.sampleRate.toString(),
                    timestamp: Date.now().toString(),
                  },
                },
              });
              
              // Update local file header
              if (streamInfo.localFilePath && existsSync(streamInfo.localFilePath)) {
                try {
                  const localFileBuffer = readFileSync(streamInfo.localFilePath);
                  localFileBuffer.writeUInt32LE(36 + streamInfo.pcmBytesWritten, 4);
                  localFileBuffer.writeUInt32LE(streamInfo.pcmBytesWritten, 40);
                  writeFileSync(streamInfo.localFilePath, localFileBuffer);
                } catch (localError: any) {
                  audioLogger.warn({
                    event: 'debug_local_header_update_error',
                    sessionKey,
                    localFilePath: streamInfo.localFilePath,
                    error: localError.message,
                  }, `⚠️ Failed to update local file header: ${localError.message}`);
                }
              }
              
              // Close local stream
              if (streamInfo.localWriteStream && !streamInfo.localWriteStream.destroyed) {
                streamInfo.localWriteStream.end();
              }
              
              // Cleanup
              debugStreams.delete(sessionKey);
              
              audioLogger.info({
                event: 'debug_45sec_saved',
                sessionKey,
                type: streamInfo.type,
                sampleRate: streamInfo.sampleRate,
                size: streamInfo.pcmBytesWritten,
                duration: DEBUG_DURATION_SECONDS,
                lastChunkNumber: chunkNumber,
                localFilePath: streamInfo.localFilePath,
              }, `🔍 DEBUG: Saved 45-second ${streamInfo.type} audio file (${streamInfo.pcmBytesWritten} bytes @ ${streamInfo.sampleRate}Hz, local: ${streamInfo.localFilePath})`);
            } catch (error: any) {
              audioLogger.error({
                event: 'debug_header_update_error',
                sessionKey,
                type: streamInfo.type,
                error: error.message,
                stack: error.stack,
              }, `❌ Failed to update WAV header: ${error.message}`);
              debugStreams.delete(sessionKey);
            }
          });
          
          // Close streams
          streamInfo.writeStream.end();
          if (streamInfo.localWriteStream && !streamInfo.localWriteStream.destroyed) {
            streamInfo.localWriteStream.end();
          }
        }
      }
      
      resolve();
    });
    
    if (!canWrite) {
      // Wait for drain event if stream is full
      streamInfo.writeStream.once('drain', resolve);
    }
  });
}

/**
 * Cleanup debug stream for a session
 * Call this when a session ends to ensure streams are properly closed
 * CRITICAL: Updates WAV headers with actual data size if call ended early
 * 
 * @param sessionKey - Unique session identifier
 */
export function cleanupDebugStream(sessionKey: string): void {
  const streamInfo = debugStreams.get(sessionKey);
  if (!streamInfo) {
    return;
  }
  
  // Helper function to update headers with actual data size
  const updateHeaders = async () => {
    try {
      // Update WAV headers with actual data size (call may have ended early)
      if (streamInfo.pcmBytesWritten > 0) {
        // Update GCS file header
        if (!streamInfo.writeStream.destroyed) {
          try {
            const [fileBuffer] = await streamInfo.file.download();
            fileBuffer.writeUInt32LE(36 + streamInfo.pcmBytesWritten, 4);
            fileBuffer.writeUInt32LE(streamInfo.pcmBytesWritten, 40);
            await streamInfo.file.save(fileBuffer, {
              metadata: {
                contentType: 'audio/wav',
                cacheControl: 'no-transform',
                metadata: {
                  debug: 'true',
                  sampleRate: streamInfo.sampleRate.toString(),
                  timestamp: Date.now().toString(),
                },
              },
            });
          } catch (gcsError: any) {
            audioLogger.warn({
              event: 'debug_cleanup_gcs_header_error',
              sessionKey,
              error: gcsError.message,
            }, `⚠️ Failed to update GCS header on cleanup: ${gcsError.message}`);
          }
        }
        
        // Update local file header
        if (streamInfo.localFilePath && existsSync(streamInfo.localFilePath)) {
          try {
            const localFileBuffer = readFileSync(streamInfo.localFilePath);
            localFileBuffer.writeUInt32LE(36 + streamInfo.pcmBytesWritten, 4);
            localFileBuffer.writeUInt32LE(streamInfo.pcmBytesWritten, 40);
            writeFileSync(streamInfo.localFilePath, localFileBuffer);
          } catch (localError: any) {
            audioLogger.warn({
              event: 'debug_cleanup_local_header_error',
              sessionKey,
              localFilePath: streamInfo.localFilePath,
              error: localError.message,
            }, `⚠️ Failed to update local file header on cleanup: ${localError.message}`);
          }
        }
      }
      
      audioLogger.info({
        event: 'debug_stream_cleanup',
        sessionKey,
        type: streamInfo.type,
        pcmBytesWritten: streamInfo.pcmBytesWritten,
        expectedSize: streamInfo.targetSize,
        wasEarlyTermination: streamInfo.pcmBytesWritten < streamInfo.targetSize,
        localFilePath: streamInfo.localFilePath,
      }, `🔍 DEBUG: Cleaned up debug stream (${streamInfo.pcmBytesWritten} bytes written, expected ${streamInfo.targetSize}, early termination: ${streamInfo.pcmBytesWritten < streamInfo.targetSize})`);
    } catch (error: any) {
      audioLogger.error({
        event: 'debug_cleanup_error',
        sessionKey,
        error: error.message,
        stack: error.stack,
      }, `❌ Error during debug stream cleanup: ${error.message}`);
    } finally {
      // Clean up after header updates complete
      debugStreams.delete(sessionKey);
    }
  };
  
  // Close GCS stream and update header with actual size
  if (!streamInfo.writeStream.destroyed && !streamInfo.writeStream.writableEnded) {
    streamInfo.writeStream.once('finish', updateHeaders);
    streamInfo.writeStream.end();
  } else {
    // Stream already ended, update headers immediately
    updateHeaders();
  }
  
  // Close local stream
  if (streamInfo.localWriteStream && !streamInfo.localWriteStream.destroyed) {
    streamInfo.localWriteStream.end();
  }
}

/**
 * Analyze audio characteristics
 * Calculates peak, RMS, zero crossings, and estimated frequency
 * 
 * @param audioFloat - Float32Array of audio samples (-1.0 to 1.0)
 * @param sampleRate - Sample rate in Hz
 * @returns Analysis object with audio characteristics
 */
export function analyzeAudio(
  audioFloat: Float32Array,
  sampleRate: number
): {
  peak: number;
  rms: number;
  zeroCrossings: number;
  estimatedFreq: number;
  frequencyContent: {
    low: number;
    mid: number;
    high: number;
  };
} {
  let peak = 0;
  let rmsSum = 0;
  let zeroCrossings = 0;
  
  // Calculate peak, RMS, and zero crossings
  for (let i = 0; i < audioFloat.length; i++) {
    const abs = Math.abs(audioFloat[i]);
    peak = Math.max(peak, abs);
    rmsSum += audioFloat[i] * audioFloat[i];
    
    // Count zero crossings (sign changes)
    if (i > 0 && (audioFloat[i - 1] >= 0) !== (audioFloat[i] >= 0)) {
      zeroCrossings++;
    }
  }
  
  const rms = Math.sqrt(rmsSum / audioFloat.length);
  
  // Estimate frequency from zero crossings
  // Each zero crossing represents half a cycle
  // Frequency = (zeroCrossings / 2) / duration
  const duration = audioFloat.length / sampleRate;
  const estimatedFreq = duration > 0 ? (zeroCrossings / 2) / duration : 0;
  
  // Simple frequency content analysis (rough estimation)
  // This is a simplified version - proper FFT would be more accurate
  // Low: 0-500Hz, Mid: 500-3000Hz, High: 3000Hz+
  const frequencyContent = {
    low: estimatedFreq < 500 ? 1 : 0,
    mid: estimatedFreq >= 500 && estimatedFreq < 3000 ? 1 : 0,
    high: estimatedFreq >= 3000 ? 1 : 0,
  };
  
  return {
    peak,
    rms,
    zeroCrossings,
    estimatedFreq,
    frequencyContent,
  };
}
