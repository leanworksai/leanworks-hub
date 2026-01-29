/**
 * Document Processor Service
 * 
 * Provides a factory pattern for processing different document types.
 * Each processor extracts content and generates thumbnails for its specific file type.
 */

import { Buffer } from 'buffer';
import { v4 as uuidv4 } from 'uuid';
import {
  ProcessingFailedError,
  ExtractionFailedError,
  ThumbnailGenerationFailedError,
  UnsupportedVersionError,
} from '../utils/document-errors';

/**
 * Document type enumeration
 */
export enum DocumentType {
  RICH_TEXT = 'rich_text',
  PDF = 'pdf',
  DOCX = 'docx',
  PPTX = 'pptx',
  XLSX = 'xlsx',
}

/**
 * File metadata interface
 */
export interface FileMetadata {
  fileName: string;
  fileSize: number;
  mimeType: string;
  docType: DocumentType;
  uploadedAt: Date;
  userId?: string;
  orgSlug?: string;
}

/**
 * Processed document result
 */
export interface ProcessedDocument {
  docId: string;
  docType: DocumentType;
  title: string;
  content: string; // Extracted text content
  htmlContent?: string; // HTML representation (for Word, PPT)
  metadata: {
    pageCount?: number;
    slideCount?: number;
    sheetCount?: number;
    wordCount?: number;
    author?: string;
    createdAt?: Date;
    modifiedAt?: Date;
    [key: string]: any;
  };
  thumbnails: string[]; // Array of thumbnail URLs or base64 strings
  previewData?: any; // Type-specific preview data (e.g., Excel sheets)
}

/**
 * Base document processor interface
 */
export interface IDocumentProcessor {
  /**
   * Check if this processor can handle the given MIME type
   */
  canProcess(mimeType: string): boolean;

  /**
   * Check if this processor can handle the given file extension
   */
  canProcessExtension(extension: string): boolean;

  /**
   * Get the document type this processor handles
   */
  getDocumentType(): DocumentType;

  /**
   * Process a document file and extract content
   */
  process(file: Buffer, metadata: FileMetadata): Promise<ProcessedDocument>;

  /**
   * Generate thumbnails for a document
   */
  generateThumbnails(file: Buffer, metadata: FileMetadata): Promise<string[]>;

  /**
   * Validate that the file is not corrupted
   */
  validateFile(file: Buffer, metadata: FileMetadata): Promise<void>;
}

/**
 * Document processor factory
 */
export class DocumentProcessorFactory {
  private processors: Map<DocumentType, IDocumentProcessor> = new Map();

  /**
   * Register a document processor
   */
  registerProcessor(processor: IDocumentProcessor): void {
    this.processors.set(processor.getDocumentType(), processor);
  }

  /**
   * Get a processor for the given document type
   */
  getProcessor(docType: DocumentType): IDocumentProcessor {
    const processor = this.processors.get(docType);
    if (!processor) {
      throw new ProcessingFailedError(
        '',
        docType,
        `No processor registered for document type: ${docType}`
      );
    }
    return processor;
  }

  /**
   * Get a processor for the given MIME type
   */
  getProcessorByMimeType(mimeType: string): IDocumentProcessor {
    for (const processor of this.processors.values()) {
      if (processor.canProcess(mimeType)) {
        return processor;
      }
    }
    throw new ProcessingFailedError(
      '',
      'unknown',
      `No processor found for MIME type: ${mimeType}`
    );
  }

  /**
   * Get a processor for the given file extension
   */
  getProcessorByExtension(extension: string): IDocumentProcessor {
    for (const processor of this.processors.values()) {
      if (processor.canProcessExtension(extension)) {
        return processor;
      }
    }
    throw new ProcessingFailedError(
      '',
      'unknown',
      `No processor found for file extension: ${extension}`
    );
  }

  /**
   * Get all registered document types
   */
  getSupportedTypes(): DocumentType[] {
    return Array.from(this.processors.keys());
  }

  /**
   * Get all supported MIME types
   */
  getSupportedMimeTypes(): string[] {
    const mimeTypes: string[] = [];
    for (const processor of this.processors.values()) {
      // Each processor will need to expose its supported MIME types
      // This is a placeholder - actual implementation depends on processor
    }
    return mimeTypes;
  }

  /**
   * Get all supported file extensions
   */
  getSupportedExtensions(): string[] {
    const extensions: string[] = [];
    for (const processor of this.processors.values()) {
      // Each processor will need to expose its supported extensions
      // This is a placeholder - actual implementation depends on processor
    }
    return extensions;
  }
}

/**
 * Global processor factory instance
 */
export const documentProcessorFactory = new DocumentProcessorFactory();

/**
 * Utility function to extract title from filename
 */
export function extractTitleFromFileName(fileName: string): string {
  // Remove file extension
  const title = fileName.replace(/\.[^/.]+$/, '');
  // Replace underscores and hyphens with spaces
  return title.replace(/[_-]/g, ' ').trim();
}

/**
 * Utility function to count words in text
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Utility function to sanitize text for storage
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Utility function to generate a correlation ID for tracking
 */
export function generateCorrelationId(): string {
  return `doc-${uuidv4()}`;
}

/**
 * Base processor class with common functionality
 */
export abstract class BaseDocumentProcessor implements IDocumentProcessor {
  abstract canProcess(mimeType: string): boolean;
  abstract canProcessExtension(extension: string): boolean;
  abstract getDocumentType(): DocumentType;
  abstract process(file: Buffer, metadata: FileMetadata): Promise<ProcessedDocument>;
  abstract generateThumbnails(file: Buffer, metadata: FileMetadata): Promise<string[]>;

  /**
   * Default validation - can be overridden by subclasses
   */
  async validateFile(file: Buffer, metadata: FileMetadata): Promise<void> {
    if (!file || file.length === 0) {
      throw new ProcessingFailedError(
        '',
        this.getDocumentType(),
        'File is empty or null'
      );
    }

    if (file.length !== metadata.fileSize) {
      throw new ProcessingFailedError(
        '',
        this.getDocumentType(),
        `File size mismatch: expected ${metadata.fileSize}, got ${file.length}`
      );
    }
  }

  /**
   * Create a base processed document object
   */
  protected createBaseProcessedDocument(
    metadata: FileMetadata,
    content: string,
    additionalMetadata: any = {}
  ): ProcessedDocument {
    return {
      docId: uuidv4(),
      docType: this.getDocumentType(),
      title: extractTitleFromFileName(metadata.fileName),
      content: sanitizeText(content),
      metadata: {
        wordCount: countWords(content),
        ...additionalMetadata,
      },
      thumbnails: [],
    };
  }
}
