/**
 * Excel Document Processor
 * 
 * Extracts sheet data and generates previews from Excel (.xlsx) files.
 */

import { Buffer } from 'buffer';
import * as XLSX from 'xlsx';
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
 * Excel-specific metadata
 */
interface ExcelMetadata {
  sheetCount: number;
  totalRows: number;
  totalCells: number;
  author?: string;
  title?: string;
  subject?: string;
  keywords?: string;
  createdAt?: Date;
  modifiedAt?: Date;
}

/**
 * Sheet data
 */
interface SheetData {
  sheetName: string;
  rowCount: number;
  columnCount: number;
  data: any[][];
  preview: any[][]; // First 100 rows for preview
}

/**
 * Excel Document Processor
 */
export class ExcelProcessor extends BaseDocumentProcessor {
  private readonly SUPPORTED_MIME_TYPES = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ];

  private readonly SUPPORTED_EXTENSIONS = [
    '.xlsx',
    '.xls',
  ];

  private readonly THUMBNAIL_WIDTH = 800;
  private readonly THUMBNAIL_HEIGHT = 600;
  private readonly MAX_PREVIEW_ROWS = 100; // Limit preview to first 100 rows
  private readonly MAX_PREVIEW_COLS = 20; // Limit preview to first 20 columns

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
    return DocumentType.XLSX;
  }

  /**
   * Process an Excel file and extract content
   */
  async process(file: Buffer, metadata: FileMetadata): Promise<ProcessedDocument> {
    try {
      // Validate file first
      await this.validateFile(file, metadata);

      // Parse Excel file
      const workbook = XLSX.read(file, { type: 'buffer' });

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new ExtractionFailedError(
          '',
          DocumentType.XLSX,
          'Excel file contains no sheets'
        );
      }

      // Extract data from all sheets
      const sheets = this.extractSheets(workbook);

      // Combine all sheet data into a single text for search
      const text = sheets
        .map(sheet => {
          const sheetText = sheet.data
            .map(row => row.join(' '))
            .join('\n');
          return `Sheet: ${sheet.sheetName}\n${sheetText}`;
        })
        .join('\n\n');

      if (!text || text.trim().length === 0) {
        throw new ExtractionFailedError(
          '',
          DocumentType.XLSX,
          'Excel file contains no extractable data'
        );
      }

      // Extract metadata
      const excelMetadata = this.extractExcelMetadata(workbook, sheets, metadata);

      // Create processed document
      const processedDoc = this.createBaseProcessedDocument(
        metadata,
        text,
        excelMetadata
      );

      // Store sheet data in previewData
      processedDoc.previewData = {
        sheets: sheets.map(sheet => ({
          sheetName: sheet.sheetName,
          rowCount: sheet.rowCount,
          columnCount: sheet.columnCount,
          preview: sheet.preview,
        })),
      };

      // Generate thumbnails
      processedDoc.thumbnails = await this.generateThumbnails(file, metadata);

      return processedDoc;
    } catch (error) {
      if (error instanceof ExtractionFailedError || error instanceof ThumbnailGenerationFailedError) {
        throw error;
      }
      throw new ProcessingFailedError(
        '',
        DocumentType.XLSX,
        error instanceof Error ? error.message : 'Unknown error processing Excel file'
      );
    }
  }

  /**
   * Generate thumbnails for an Excel file
   * Note: This is a simplified implementation. For production, you would use
   * LibreOffice or a similar library to render sheets to images.
   */
  async generateThumbnails(file: Buffer, metadata: FileMetadata): Promise<string[]> {
    try {
      const thumbnails: string[] = [];

      // Parse Excel file to get sheet count
      const workbook = XLSX.read(file, { type: 'buffer' });
      const sheetCount = workbook.SheetNames.length;

      // Generate a single thumbnail showing all sheets
      const thumbnail = await this.createPlaceholderThumbnail(sheetCount, workbook.SheetNames);
      thumbnails.push(thumbnail);

      return thumbnails;
    } catch (error) {
      throw new ThumbnailGenerationFailedError(
        '',
        DocumentType.XLSX,
        error instanceof Error ? error.message : 'Unknown error generating thumbnails'
      );
    }
  }

  /**
   * Extract data from all sheets
   */
  private extractSheets(workbook: XLSX.WorkBook): SheetData[] {
    const sheets: SheetData[] = [];

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert sheet to array of arrays
      const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      // Get dimensions
      const rowCount = data.length;
      const columnCount = data.length > 0 ? Math.max(...data.map(row => row.length)) : 0;

      // Create preview (first N rows and columns)
      const preview = data
        .slice(0, this.MAX_PREVIEW_ROWS)
        .map(row => row.slice(0, this.MAX_PREVIEW_COLS));

      sheets.push({
        sheetName,
        rowCount,
        columnCount,
        data,
        preview,
      });
    }

    return sheets;
  }

  /**
   * Extract Excel metadata
   */
  private extractExcelMetadata(
    workbook: XLSX.WorkBook,
    sheets: SheetData[],
    fileMetadata: FileMetadata
  ): ExcelMetadata {
    // Calculate total rows and cells
    const totalRows = sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0);
    const totalCells = sheets.reduce(
      (sum, sheet) => sum + sheet.rowCount * sheet.columnCount,
      0
    );

    // Extract document properties if available
    const props = workbook.Props || {};

    return {
      sheetCount: sheets.length,
      totalRows,
      totalCells,
      title: props.Title || extractTitleFromFileName(fileMetadata.fileName),
      author: props.Author,
      subject: props.Subject,
      keywords: props.Keywords,
      createdAt: props.CreatedDate ? new Date(props.CreatedDate) : undefined,
      modifiedAt: props.ModifiedDate ? new Date(props.ModifiedDate) : undefined,
    };
  }

  /**
   * Create a placeholder thumbnail
   * In production, this would render the actual Excel sheet
   */
  private async createPlaceholderThumbnail(sheetCount: number, sheetNames: string[]): Promise<string> {
    const canvas = createCanvas(this.THUMBNAIL_WIDTH, this.THUMBNAIL_HEIGHT);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, this.THUMBNAIL_WIDTH, this.THUMBNAIL_HEIGHT);

    // Border
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, this.THUMBNAIL_WIDTH - 20, this.THUMBNAIL_HEIGHT - 20);

    // Title
    ctx.fillStyle = '#333';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Excel Spreadsheet', this.THUMBNAIL_WIDTH / 2, 60);

    // Sheet count
    ctx.font = '16px Arial';
    ctx.fillText(`${sheetCount} sheet${sheetCount !== 1 ? 's' : ''}`, this.THUMBNAIL_WIDTH / 2, 90);

    // List first few sheet names
    const maxSheetNamesToShow = 5;
    const sheetsToShow = sheetNames.slice(0, maxSheetNamesToShow);
    
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    let y = 140;
    for (const sheetName of sheetsToShow) {
      const truncatedName = sheetName.length > 40 ? sheetName.substring(0, 37) + '...' : sheetName;
      ctx.fillText(`• ${truncatedName}`, 50, y);
      y += 25;
    }

    if (sheetNames.length > maxSheetNamesToShow) {
      ctx.fillText(`... and ${sheetNames.length - maxSheetNamesToShow} more`, 50, y);
    }

    // Excel icon
    ctx.fillStyle = '#16a34a';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('XLSX', this.THUMBNAIL_WIDTH / 2, this.THUMBNAIL_HEIGHT - 60);

    // Convert to base64
    return canvas.toDataURL('image/png');
  }

  /**
   * Validate Excel file
   */
  async validateFile(file: Buffer, metadata: FileMetadata): Promise<void> {
    await super.validateFile(file, metadata);

    // Check if it's an .xlsx file (ZIP archive with specific structure)
    // .xlsx files are ZIP archives starting with PK magic bytes
    const zipMagicBytes = Buffer.from([0x50, 0x4B, 0x03, 0x04]); // PK..
    if (!file.subarray(0, 4).equals(zipMagicBytes)) {
      throw new ProcessingFailedError(
        '',
        DocumentType.XLSX,
        'Invalid Excel file: not a valid .xlsx file'
      );
    }

    // Try to parse the Excel file to ensure it's valid
    try {
      const workbook = XLSX.read(file, { type: 'buffer' });
      
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new ProcessingFailedError(
          '',
          DocumentType.XLSX,
          'Invalid Excel file: no sheets found'
        );
      }
    } catch (error) {
      if (error instanceof ProcessingFailedError) {
        throw error;
      }
      throw new ProcessingFailedError(
        '',
        DocumentType.XLSX,
        `Invalid Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

/**
 * Export singleton instance
 */
export const excelProcessor = new ExcelProcessor();
