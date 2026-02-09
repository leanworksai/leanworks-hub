/**
 * PDF Document Processor
 * 
 * Extracts text and generates thumbnails from PDF files.
 */

import { Buffer } from 'buffer';
import { createCanvas, loadImage } from 'canvas';
import { v4 as uuidv4 } from 'uuid';
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
 * PDF-specific metadata
 */
interface PDFMetadata {
  pageCount: number;
  author?: string;
  title?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
  isEncrypted?: boolean;
}

/**
 * PDF Document Processor
 */
export class PDFProcessor extends BaseDocumentProcessor {
  private readonly SUPPORTED_MIME_TYPES = [
    'application/pdf',
  ];

  private readonly SUPPORTED_EXTENSIONS = [
    '.pdf',
  ];

  private readonly THUMBNAIL_WIDTH = 800;
  private readonly THUMBNAIL_HEIGHT = 600;
  private readonly MAX_THUMBNAILS = 10; // Generate thumbnails for first 10 pages

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
    return DocumentType.PDF;
  }

  /**
   * Process a PDF file and extract content
   */
  async process(file: Buffer, metadata: FileMetadata): Promise<ProcessedDocument> {
    // Import PDFParse class from pdf-parse v2
    const { PDFParse } = await import('pdf-parse');

    // Create parser instance with buffer
    const parser = new PDFParse({ data: file });

    try {
      // Validate file first
      await this.validateFile(file, metadata);

      // Extract text
      const textResult = await parser.getText();
      const text = textResult.text || '';

      if (!text || text.trim().length === 0) {
        throw new ExtractionFailedError(
          '',
          DocumentType.PDF,
          'PDF contains no extractable text (may be image-based or encrypted)'
        );
      }

      // Extract metadata using getInfo()
      const infoResult = await parser.getInfo({ parsePageInfo: true });
      const pdfMetadata = this.extractPDFMetadata(infoResult, metadata);

      // Create processed document
      const processedDoc = this.createBaseProcessedDocument(
        metadata,
        text,
        pdfMetadata
      );

      // Generate thumbnails
      processedDoc.thumbnails = await this.generateThumbnails(file, metadata);

      return processedDoc;
    } catch (error) {
      if (error instanceof ExtractionFailedError || error instanceof ThumbnailGenerationFailedError) {
        throw error;
      }
      throw new ProcessingFailedError(
        '',
        DocumentType.PDF,
        error instanceof Error ? error.message : 'Unknown error processing PDF'
      );
    } finally {
      // Always clean up resources (best practice for v2.x)
      await parser.destroy();
    }
  }

  /**
   * Generate thumbnails for a PDF
   * Note: This is a simplified implementation. For production, you would use
   * pdf.js or a similar library to render PDF pages to images.
   */
  async generateThumbnails(file: Buffer, metadata: FileMetadata): Promise<string[]> {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: file });

    try {
      const thumbnails: string[] = [];

      // Get page count
      const infoResult = await parser.getInfo({ parsePageInfo: true });
      const pageCount = infoResult.total || 0;

      // Generate thumbnails for first N pages
      const pagesToThumbnail = Math.min(pageCount, this.MAX_THUMBNAILS);

      for (let i = 0; i < pagesToThumbnail; i++) {
        // In a real implementation, you would:
        // 1. Use pdf.js to render the page to a canvas
        // 2. Convert canvas to image
        // 3. Upload to GCS or return as base64

        // For now, we'll create a placeholder thumbnail
        const thumbnail = await this.createPlaceholderThumbnail(i + 1, pageCount);
        thumbnails.push(thumbnail);
      }

      return thumbnails;
    } catch (error) {
      throw new ThumbnailGenerationFailedError(
        '',
        DocumentType.PDF,
        error instanceof Error ? error.message : 'Unknown error generating thumbnails'
      );
    } finally {
      await parser.destroy();
    }
  }

  /**
   * Extract PDF metadata
   */
  private extractPDFMetadata(infoResult: any, fileMetadata: FileMetadata): PDFMetadata {
    const info = infoResult.info || {};

    return {
      pageCount: infoResult.total || 0, // ✅ v2 API property
      author: info.Author,
      title: info.Title || extractTitleFromFileName(fileMetadata.fileName),
      subject: info.Subject,
      keywords: info.Keywords,
      creator: info.Creator,
      producer: info.Producer,
      creationDate: info.CreationDate ? new Date(info.CreationDate) : undefined,
      modificationDate: info.ModDate ? new Date(info.ModDate) : undefined,
      isEncrypted: info.IsEncrypted || false,
    };
  }

  /**
   * Create a placeholder thumbnail
   * In production, this would render the actual PDF page
   */
  private async createPlaceholderThumbnail(pageNumber: number, totalPages: number): Promise<string> {
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
    ctx.fillText(`Page ${pageNumber}`, this.THUMBNAIL_WIDTH / 2, this.THUMBNAIL_HEIGHT / 2 - 20);

    ctx.font = '16px Arial';
    ctx.fillText(`of ${totalPages}`, this.THUMBNAIL_WIDTH / 2, this.THUMBNAIL_HEIGHT / 2 + 20);

    // PDF icon
    ctx.fillStyle = '#dc2626';
    ctx.font = 'bold 48px Arial';
    ctx.fillText('PDF', this.THUMBNAIL_WIDTH / 2, this.THUMBNAIL_HEIGHT / 2 + 80);

    // Convert to base64
    return canvas.toDataURL('image/png');
  }

  /**
   * Validate PDF file
   */
  async validateFile(file: Buffer, metadata: FileMetadata): Promise<void> {
    await super.validateFile(file, metadata);

    // Check PDF magic bytes
    const pdfMagicBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
    if (!file.subarray(0, 4).equals(pdfMagicBytes)) {
      throw new ProcessingFailedError(
        '',
        DocumentType.PDF,
        'Invalid PDF file: missing PDF magic bytes'
      );
    }

    // Validate PDF by attempting to parse it
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: file });

    try {
      // Try to get document info to verify it's a valid PDF
      await parser.getInfo();
    } catch (error) {
      throw new ProcessingFailedError(
        '',
        DocumentType.PDF,
        `Invalid PDF file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      await parser.destroy();
    }
  }
}

/**
 * Export singleton instance
 */
export const pdfProcessor = new PDFProcessor();
