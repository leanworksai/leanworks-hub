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
  // Log to console (raw JSON - can be piped through pino-pretty if needed)
  { stream: process.stdout },
]));

// Export base logger
export const logger = baseLogger;

// Audio pipeline specific logger
export const audioLogger = baseLogger.child({ component: 'audio-pipeline' });

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
  }
  // Warning action removed - too verbose
}

