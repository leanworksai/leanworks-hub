/**
 * Transcription Worker Entry Point
 * Runs as a separate process to handle async transcription
 */

import { startWorker } from './transcription-worker.js';

// Start the worker
startWorker().catch((error) => {
  console.error('❌ Fatal error in transcription worker:', error);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('📝 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📝 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

