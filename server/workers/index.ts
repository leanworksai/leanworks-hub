/**
 * Workers Entry Point
 * Runs as a separate process to handle async processing
 */

import { startDocumentProcessingWorker, stopDocumentProcessingWorker } from './document-processing-worker.js';

// Start all workers
Promise.all([
  startDocumentProcessingWorker()
]).catch((error) => {
  console.error('❌ Fatal error starting workers:', error);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📝 Received SIGTERM, shutting down gracefully...');
  try {
    await stopDocumentProcessingWorker();
    console.log('✅ Workers stopped successfully');
  } catch (error) {
    console.error('❌ Error stopping workers:', error);
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('📝 Received SIGINT, shutting down gracefully...');
  try {
    await stopDocumentProcessingWorker();
    console.log('✅ Workers stopped successfully');
  } catch (error) {
    console.error('❌ Error stopping workers:', error);
  }
  process.exit(0);
});
