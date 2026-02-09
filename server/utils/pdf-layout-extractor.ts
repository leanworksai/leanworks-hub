/**
 * PDF Layout Extractor
 *
 * Extracts both text content and basic layout information from PDF files.
 * Uses pdf-parse for text extraction and creates basic layout structure.
 */

import { PDFParse } from 'pdf-parse';

export interface TextElement {
  type: 'text' | 'heading' | 'list' | 'table' | 'image';
  content: string;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
    pageNumber: number;
  };
  style: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: string;
    color?: string;
    isBold?: boolean;
    isItalic?: boolean;
  };
  confidence?: number; // How confident we are in the element type
}

export interface PageLayout {
  pageNumber: number;
  text: string;
  elements: TextElement[];
  dimensions: {
    width: number;
    height: number;
  };
}

export interface PDFLayoutResult {
  text: string; // Full extracted text for indexing
  pages: PageLayout[];
  metadata: {
    pageCount: number;
    wordCount: number;
    characterCount: number;
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    creationDate?: Date;
    modificationDate?: Date;
  };
}

export class PDFLayoutExtractor {
  private readonly MIN_HEADING_FONT_SIZE = 18; // Fonts larger than this are considered headings
  private readonly MAX_LIST_INDENT = 50; // Max indent for list detection
  private readonly TABLE_DETECTION_THRESHOLD = 0.7; // Confidence threshold for table detection

  /**
   * Extract layout information from PDF buffer
   */
  async extractLayout(pdfBuffer: Buffer): Promise<PDFLayoutResult> {
    try {
      console.log(`🔄 Extracting layout from PDF (${pdfBuffer.length} bytes)`);

      // Use pdf-parse to extract text and basic metadata
      const parser = new PDFParse({ data: pdfBuffer });
      const pdfData = await parser.getText();
      const infoData = await parser.getInfo({ parsePageInfo: true });

      let fullText = pdfData.text || '';
      
      // Clean extracted text to remove metadata/XML attributes
      fullText = this.cleanExtractedText(fullText);
      
      const pageCount = infoData.total || 1;

      console.log(`📄 PDF has ${pageCount} pages`);
      console.log(`📝 Extracted text preview (first 200 chars): ${fullText.substring(0, 200)}`);

      // Create basic page layouts from extracted text
      const pages: PageLayout[] = this.createBasicPageLayouts(fullText, pageCount);

      // Extract metadata
      const metadata = this.extractMetadataFromInfo(infoData);

      // Calculate word and character counts
      const wordCount = this.countWords(fullText);
      const characterCount = fullText.length;

      const result: PDFLayoutResult = {
        text: fullText.trim(),
        pages,
        metadata: {
          ...metadata,
          pageCount,
          wordCount,
          characterCount,
        },
      };

      console.log(`✅ Layout extraction completed: ${wordCount} words, ${characterCount} characters`);

      return result;

    } catch (error) {
      console.error(`❌ PDF layout extraction failed:`, error);
      throw new Error(
        `Failed to extract PDF layout: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Create basic page layouts from extracted text
   */
  private createBasicPageLayouts(fullText: string, pageCount: number): PageLayout[] {
    const pages: PageLayout[] = [];

    // Split text by double newlines (rough page separation)
    // This is a simplification - in a real implementation, you'd need better page detection
    const pageTexts = fullText.split('\n\n').filter(text => text.trim());

    for (let i = 0; i < pageCount; i++) {
      const pageText = pageTexts[i] || '';
      const elements = this.createBasicTextElements(pageText, i + 1);

      pages.push({
        pageNumber: i + 1,
        text: pageText,
        elements,
        dimensions: {
          width: 595, // Standard A4 width in points (72 DPI)
          height: 842, // Standard A4 height in points (72 DPI)
        },
      });
    }

    return pages;
  }

  /**
   * Create basic text elements from page text
   */
  private createBasicTextElements(pageText: string, pageNumber: number): TextElement[] {
    const elements: TextElement[] = [];
    const lines = pageText.split('\n').filter(line => line.trim());

    let yPosition = 50; // Start position
    const lineHeight = 20; // Approximate line height

    for (const line of lines) {
      if (!line.trim()) continue;

      // Determine element type based on simple heuristics
      const elementType = this.determineBasicElementType(line);

      elements.push({
        type: elementType,
        content: line.trim(),
        position: {
          x: 50, // Left margin
          y: yPosition,
          width: Math.min(line.length * 8, 500), // Estimate width
          height: lineHeight,
          pageNumber,
        },
        style: {
          fontFamily: 'Arial',
          fontSize: elementType === 'heading' ? 18 : 12,
          fontWeight: elementType === 'heading' ? 'bold' : 'normal',
          color: '#000000',
          isBold: elementType === 'heading',
          isItalic: false,
        },
        confidence: 0.5, // Basic confidence
      });

      yPosition += lineHeight + 5; // Add some spacing
    }

    return elements;
  }

  /**
   * Determine basic element type from text content
   */
  private determineBasicElementType(content: string): TextElement['type'] {
    const trimmed = content.trim();

    // Check for headings (short lines, all caps, etc.)
    if (trimmed.length < 50 && /^[A-Z\s]+$/.test(trimmed)) {
      return 'heading';
    }

    // Check for list items
    if (/^[\u2022•◦▪▫▸▹►▻▶▷◆◇◈◉◊○◌◍◎●◐◑◒◓◔◕◖◗◘◙◚◛◜◝◞◟◠◡◢◣◤◥◦◯◰◱◲◳◴◵◶◷◸◹◺◻◼◽◾◿\-\*\d+\.\s*]/.test(trimmed)) {
      return 'list';
    }

    // Check for table-like content
    if (trimmed.includes('\t') || trimmed.includes('|')) {
      return 'table';
    }

    return 'text';
  }

  /**
   * Extract metadata from PDF info
   */
  private extractMetadataFromInfo(infoResult: any): Omit<PDFLayoutResult['metadata'], 'pageCount' | 'wordCount' | 'characterCount'> {
    const info = infoResult.info || {};

    return {
      title: info.Title,
      author: info.Author,
      subject: info.Subject,
      creator: info.Creator,
      producer: info.Producer,
      creationDate: info.CreationDate ? new Date(info.CreationDate) : undefined,
      modificationDate: info.ModDate ? new Date(info.ModDate) : undefined,
    };
  }

  /**
   * Clean extracted text to remove metadata, XML attributes, and non-readable content
   */
  private cleanExtractedText(text: string): string {
    if (!text) return '';

    let cleaned = text;

    // Remove GUIDs/UUIDs (e.g., {FF2B5EF4-FFF2-40B4-BE49-F238E27FC236})
    cleaned = cleaned.replace(/\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}/gi, '');

    // Remove resource IDs (e.g., rId3, rId1)
    cleaned = cleaned.replace(/\brId\d+\b/gi, '');

    // Remove shape types that appear as text (rect, roundRect, etc.)
    cleaned = cleaned.replace(/\b(rect|roundRect|ellipse|line|polygon|path|group)\b/gi, '');

    // Remove language codes (e.g., en-US)
    cleaned = cleaned.replace(/\b[a-z]{2}-[A-Z]{2}\b/gi, '');

    // Remove hex color codes (e.g., FF0000, F9ECE4)
    cleaned = cleaned.replace(/\b[0-9A-F]{6}\b/gi, '');

    // Remove standalone numbers that are likely coordinates (4+ digits)
    cleaned = cleaned.replace(/\b\d{4,}\b/g, '');

    // Remove font names that appear standalone (common font names)
    const fontNames = [
      'Montserrat', 'Inconsolata', 'Arial', 'Times', 'Courier', 'Helvetica',
      'Calibri', 'Verdana', 'Georgia', 'Comic Sans', 'Trebuchet', 'Impact'
    ];
    fontNames.forEach(font => {
      const regex = new RegExp(`\\b${font}\\s+(Black|Bold|Regular|Light|Medium|SemiBold|Thin|ExtraBold|ExtraLight)?\\b`, 'gi');
      cleaned = cleaned.replace(regex, '');
    });

    // Remove shape properties (accent1, minor, lt1, ctr, etc.)
    cleaned = cleaned.replace(/\b(accent\d+|minor|major|lt\d+|ctr|none|auto|solid|dash|dot)\b/gi, '');

    // Remove coordinate-like patterns (e.g., "0 0 0 0 0")
    cleaned = cleaned.replace(/\b\d+\s+\d+\s+\d+\s+\d+\s+\d+\b/g, '');

    // Remove negative numbers that are likely coordinates (e.g., -122, -120)
    cleaned = cleaned.replace(/\b-\d{2,}\b/g, '');

    // Remove single character followed by space (likely metadata markers)
    cleaned = cleaned.replace(/\b[a-z]\s+/gi, '');

    // Clean up multiple spaces
    cleaned = cleaned.replace(/\s+/g, ' ');

    // Remove lines that are mostly metadata (contain mostly numbers, GUIDs, or short codes)
    const lines = cleaned.split('\n');
    const cleanedLines = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      
      // Skip lines that are mostly numbers or very short
      const numberRatio = (trimmed.match(/\d/g) || []).length / trimmed.length;
      if (numberRatio > 0.5 && trimmed.length < 20) return false;
      
      // Skip lines that are just single words (likely metadata)
      if (trimmed.split(/\s+/).length === 1 && trimmed.length < 10) return false;
      
      return true;
    });

    cleaned = cleanedLines.join('\n').trim();

    return cleaned;
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Validate PDF buffer
   */
  async validatePDF(pdfBuffer: Buffer): Promise<boolean> {
    try {
      const parser = new PDFParse({ data: pdfBuffer });
      await parser.getInfo();
      return true;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Singleton instance
 */
export const pdfLayoutExtractor = new PDFLayoutExtractor();