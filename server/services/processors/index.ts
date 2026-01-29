/**
 * Document Processors Registration
 * 
 * Registers all document processors with the factory and exports
 * the configured factory instance for use throughout the application.
 */

import { documentProcessorFactory } from '../document-processor.js';
import { pdfProcessor } from './pdf-processor.js';
import { wordProcessor } from './word-processor.js';
import { powerPointProcessor } from './powerpoint-processor.js';
import { excelProcessor } from './excel-processor.js';

// Register all processors
documentProcessorFactory.registerProcessor(pdfProcessor);
documentProcessorFactory.registerProcessor(wordProcessor);
documentProcessorFactory.registerProcessor(powerPointProcessor);
documentProcessorFactory.registerProcessor(excelProcessor);

// Export the configured factory
export { documentProcessorFactory };

// Export individual processors for direct use if needed
export {
  pdfProcessor,
  wordProcessor,
  powerPointProcessor,
  excelProcessor,
};

// Export types
export * from '../document-processor.js';
