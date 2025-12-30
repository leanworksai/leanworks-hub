/**
 * Structured Logging Utility
 * Uses Pino for fast, structured JSON logging with file output
 */

import pino from 'pino';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { Transform } from 'stream';

// Create logs directory
const logsDir = join(process.cwd(), 'logs');
if (!existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}

// Create file streams for different log types (overwrite on each run)
// Using createWriteStream with 'w' flag to overwrite files on each run
const audioLogStream = createWriteStream(join(logsDir, 'audio-pipeline.log'), { flags: 'w' });
const errorLogStream = createWriteStream(join(logsDir, 'error.log'), { flags: 'w' });
const combinedLogStream = createWriteStream(join(logsDir, 'combined.log'), { flags: 'w' });

// Custom transform stream for transcription.log - only writes chunk number and transcript text
// Pino writes JSON strings, so we parse them and format to simplified output
const transcriptionLogFile = createWriteStream(join(logsDir, 'transcription.log'), { flags: 'w' });

const transcriptionLogTransform = new Transform({
  objectMode: false, // Pino writes strings (JSON), not objects
  transform(chunk: Buffer, encoding, callback) {
    try {
      const logLine = chunk.toString().trim();
      if (logLine) {
        const logObj = JSON.parse(logLine);
        // Only process transcription_completed events with transcript
        if (
          logObj.component === 'transcription' &&
          logObj.event === 'transcription_completed' &&
          typeof logObj.chunkIndex === 'number' &&
          typeof logObj.transcript === 'string' &&
          logObj.transcript.trim().length > 0
        ) {
          // Write simplified format: "Chunk X: transcript text"
          const simplified = `Chunk ${logObj.chunkIndex}: ${logObj.transcript}\n`;
          this.push(simplified);
        }
      }
      callback();
    } catch (error) {
      // If JSON parsing fails, skip this line silently
      callback();
    }
  },
});

// Pipe transform to file
transcriptionLogTransform.pipe(transcriptionLogFile);

const transcriptionLogStream = transcriptionLogTransform;

// Base logger configuration
// NOTE: Cannot use 'transport' option with multistream - they are mutually exclusive
// Using multistream allows us to write to multiple destinations simultaneously
const baseLogger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: {
    service: 'leanworks-hub',
    env: process.env.NODE_ENV || 'development',
  },
}, pino.multistream([
  // Write all logs to combined.log (raw JSON)
  { stream: combinedLogStream },
  // Write errors to error.log (raw JSON)
  { level: 'error', stream: errorLogStream },
  // Write audio pipeline logs to audio-pipeline.log (raw JSON)
  // Filter: only logs with component === 'audio-pipeline'
  {
    stream: audioLogStream,
    level: 'debug',
    filter: (log: any) => log.component === 'audio-pipeline',
  },
  // Write transcription logs to transcription.log (simplified format: chunk number and transcript only)
  // The transform stream will format the output to only include chunk number and transcript text
  {
    stream: transcriptionLogStream,
    level: 'info',
    filter: (log: any) => {
      // Only include transcription_completed events that have transcript text
      const hasComponent = log.component === 'transcription';
      const hasEvent = log.event === 'transcription_completed';
      const hasTranscript = typeof log.transcript === 'string' && log.transcript.trim().length > 0;
      const hasChunkIndex = typeof log.chunkIndex === 'number';
      
      return hasComponent && hasEvent && hasTranscript && hasChunkIndex;
    },
  },
  // Log to console (raw JSON - can be piped through pino-pretty if needed)
  { stream: process.stdout },
]));

// Export base logger
export const logger = baseLogger;

// Audio pipeline specific logger
export const audioLogger = baseLogger.child({ component: 'audio-pipeline' });

// Transcription specific logger
export const transcriptionLogger = baseLogger.child({ component: 'transcription' });

// Helper function for audio chunk validation logging
export function logAudioChunk(
  level: 'info' | 'warn' | 'error' | 'debug',
  event: string,
  data: {
    chunkNumber?: number;
    participantEmail?: string;
    callId?: string;
    maxAmplitude?: number;
    dbLevel?: number;
    nonZeroSamples?: number;
    totalSamples?: number;
    chunkSize?: number;
    isSilence?: boolean;
    [key: string]: any;
  }
) {
  const logData = {
    event,
    timestamp: new Date().toISOString(),
    ...data,
  };

  switch (level) {
    case 'error':
      audioLogger.error(logData, event);
      break;
    case 'warn':
      audioLogger.warn(logData, event);
      break;
    case 'debug':
      audioLogger.debug(logData, event);
      break;
    default:
      audioLogger.info(logData, event);
  }
}

// Helper for backpressure logging
export function logBackpressure(
  participantEmail: string,
  sessionKey: string,
  queueDepth: number,
  pending: number,
  action: 'warning' | 'pause' | 'resume' | 'drop'
) {
  const logData = {
    event: 'backpressure',
    participantEmail,
    sessionKey,
    queueDepth,
    pending,
    action,
    timestamp: new Date().toISOString(),
  };

  if (action === 'drop') {
    audioLogger.error(logData, `Backpressure: Dropping chunk (queue: ${queueDepth}, pending: ${pending})`);
  } else if (action === 'pause') {
    audioLogger.warn(logData, `Backpressure: Pausing WebSocket (queue: ${queueDepth})`);
  } else if (action === 'resume') {
    audioLogger.info(logData, `Backpressure: Resuming WebSocket (queue: ${queueDepth})`);
  } else {
    audioLogger.warn(logData, `Backpressure: Warning (queue: ${queueDepth})`);
  }
}

