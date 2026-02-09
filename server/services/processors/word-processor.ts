/**
 * Word Document Processor
 * 
 * Extracts text and HTML from Word (.docx) files.
 */

import { Buffer } from 'buffer';
import mammoth from 'mammoth';
import { createCanvas } from 'canvas';
import {
  BaseDocumentProcessor,
  DocumentType,
  FileMetadata,
  ProcessedDocument,
  extractTitleFromFileName,
  sanitizeText,
  countWords,
} from '../document-processor.js';
import {
  ExtractionFailedError,
  ThumbnailGenerationFailedError,
  ProcessingFailedError,
} from '../../utils/document-errors.js';

/**
 * Word-specific metadata
 */
interface WordMetadata {
  pageCount?: number;
  paragraphCount?: number;
  wordCount?: number;
  author?: string;
  title?: string;
  subject?: string;
  keywords?: string;
  createdAt?: Date;
  modifiedAt?: Date;
}

/**
 * Word Document Processor
 */
export class WordProcessor extends BaseDocumentProcessor {
  private readonly SUPPORTED_MIME_TYPES = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
  ];

  private readonly SUPPORTED_EXTENSIONS = [
    '.docx',
    '.doc',
  ];

  private readonly THUMBNAIL_WIDTH = 800;
  private readonly THUMBNAIL_HEIGHT = 600;

  /**
   * Check if this processor can handle the given MIME type
   */
  canProcess(mimeType: string): boolean {
    return this.SUPPORTED_MIME_TYPES.includes(mimeType.toLowerCase());
  }

  /**
   * Check if this processor can handle the given file extension
   */
  canProcessExtension(extension: string): boolean {
    return this.SUPPORTED_EXTENSIONS.includes(extension.toLowerCase());
  }

  /**
   * Get the document type this processor handles
   */
  getDocumentType(): DocumentType {
    return DocumentType.DOCX;
  }

  /**
   * Process a Word file and extract content
   */
  async process(file: Buffer, metadata: FileMetadata): Promise<ProcessedDocument> {
    try {
      // Validate file first
      await this.validateFile(file, metadata);

      // Extract text and HTML using mammoth
      const [textResult, htmlResult] = await Promise.all([
        mammoth.extractRawText({ buffer: file }),
        mammoth.convertToHtml({ buffer: file }),
      ]);

      const text = textResult.value || '';
      const html = htmlResult.value || '';

      if (!text || text.trim().length === 0) {
        throw new ExtractionFailedError(
          '',
          DocumentType.DOCX,
          'Word document contains no extractable text'
        );
      }

      // Extract metadata
      const wordMetadata = this.extractWordMetadata(text, html, metadata);

      // Create processed document
      const processedDoc = this.createBaseProcessedDocument(
        metadata,
        text,
        wordMetadata
      );

      // Add HTML content
      processedDoc.htmlContent = html;

      // Generate thumbnails
      processedDoc.thumbnails = await this.generateThumbnails(file, metadata);

      return processedDoc;
    } catch (error) {
      if (error instanceof ExtractionFailedError || error instanceof ThumbnailGenerationFailedError) {
        throw error;
      }
      throw new ProcessingFailedError(
        '',
        DocumentType.DOCX,
        error instanceof Error ? error.message : 'Unknown error processing Word document'
      );
    }
  }

  /**
   * Generate thumbnails for a Word document
   * Note: This is a simplified implementation. For production, you would use
   * LibreOffice or a similar library to render the document to images.
   */
  async generateThumbnails(file: Buffer, metadata: FileMetadata): Promise<string[]> {
    try {
      const thumbnails: string[] = [];

      // For now, we'll create a single placeholder thumbnail
      // In a real implementation, you would:
      // 1. Use LibreOffice or similar to render the document to PDF
      // 2. Use pdf.js to render the PDF pages to images
      // 3. Upload to GCS or return as base64

      const thumbnail = await this.createPlaceholderThumbnail(metadata.fileName);
      thumbnails.push(thumbnail);

      return thumbnails;
    } catch (error) {
      throw new ThumbnailGenerationFailedError(
        '',
        DocumentType.DOCX,
        error instanceof Error ? error.message : 'Unknown error generating thumbnails'
      );
    }
  }

  /**
   * Extract Word metadata
   */
  private extractWordMetadata(text: string, html: string, fileMetadata: FileMetadata): WordMetadata {
    // Count paragraphs (HTML <p> tags)
    const paragraphCount = (html.match(/<p[^>]*>/g) || []).length;

    // Count words
    const wordCount = countWords(text);

    return {
      paragraphCount,
      wordCount,
      title: extractTitleFromFileName(fileMetadata.fileName),
      // Note: mammoth doesn't extract document properties like author, created date, etc.
      // For production, you would use a library like officegen or unzipx to extract docx/core.xml
    };
  }

  /**
   * Create a placeholder thumbnail
   * In production, this would render the actual Word document
   */
  private async createPlaceholderThumbnail(fileName: string): Promise<string> {
    const canvas = createCanvas(this.THUMBNAIL_WIDTH, this.THUMBNAIL_HEIGHT);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, this.THUMBNAIL_WIDTH, this.THUMBNAIL_HEIGHT);

    // Border
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, this.THUMBNAIL_WIDTH - 20, this.THUMBNAIL_HEIGHT - 20);

    // Text
    ctx.fillStyle = '#333';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Word Document', this.THUMBNAIL_WIDTH / 2, this.THUMBNAIL_HEIGHT / 2 - 20);

    ctx.font = '16px Arial';
    ctx.fillText(fileName, this.THUMBNAIL_WIDTH / 2, this.THUMBNAIL_HEIGHT / 2 + 20);

    // Word icon
    ctx.fillStyle = '#2563eb';
    ctx.font = 'bold 48px Arial';
    ctx.fillText('DOCX', this.THUMBNAIL_WIDTH / 2, this.THUMBNAIL_HEIGHT / 2 + 80);

    // Convert to base64
    return canvas.toDataURL('image/png');
  }

  /**
   * Validate Word file
   */
  async validateFile(file: Buffer, metadata: FileMetadata): Promise<void> {
    await super.validateFile(file, metadata);

    // Check if it's a .docx file (ZIP archive with specific structure)
    // .docx files are ZIP archives starting with PK magic bytes
    const zipMagicBytes = Buffer.from([0x50, 0x4B, 0x03, 0x04]); // PK..
    if (!file.subarray(0, 4).equals(zipMagicBytes)) {
      throw new ProcessingFailedError(
        '',
        DocumentType.DOCX,
        'Invalid Word document: not a valid .docx file'
      );
    }

    // Try to extract text to ensure it's valid
    try {
      const result = await mammoth.extractRawText({ buffer: file });
      if (result.messages && result.messages.length > 0) {
        const errors = result.messages.filter((m: any) => m.type === 'error');
        if (errors.length > 0) {
          throw new ProcessingFailedError(
            '',
            DocumentType.DOCX,
            `Invalid Word document: ${errors.map((e: any) => e.message).join(', ')}`
          );
        }
      }
    } catch (error) {
      if (error instanceof ProcessingFailedError) {
        throw error;
      }
      throw new ProcessingFailedError(
        '',
        DocumentType.DOCX,
        `Invalid Word document: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

/**
 * Export singleton instance
 */
export const wordProcessor = new WordProcessor();
