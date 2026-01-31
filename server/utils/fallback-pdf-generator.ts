/**
 * Fallback PDF Generator
 *
 * Generates a simple PDF from extracted text and layout information
 * when LibreOffice conversion is not available.
 * This is used as a fallback for local development environments.
 */

import { PDFDocument, PDFPage, rgb } from 'pdf-lib';

export interface TextElement {
  text: string;
  x?: number;
  y?: number;
  fontSize?: number;
  fontFamily?: string;
}

export class FallbackPDFGenerator {
  private readonly PAGE_WIDTH = 595; // A4 width in points
  private readonly PAGE_HEIGHT = 842; // A4 height in points
  private readonly MARGIN_LEFT = 40;
  private readonly MARGIN_RIGHT = 40;
  private readonly MARGIN_TOP = 40;
  private readonly MARGIN_BOTTOM = 40;

  /**
   * Generate a simple PDF from extracted text
   */
  async generatePDFFromText(text: string, title?: string): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();

    // Calculate text area dimensions
    const textWidth = this.PAGE_WIDTH - this.MARGIN_LEFT - this.MARGIN_RIGHT;
    const textHeight = this.PAGE_HEIGHT - this.MARGIN_TOP - this.MARGIN_BOTTOM;

    // Split text into lines
    const lines = text.split('\n');
    let currentPage = pdfDoc.addPage([this.PAGE_WIDTH, this.PAGE_HEIGHT]);
    let yPosition = this.PAGE_HEIGHT - this.MARGIN_TOP;

    const lineHeight = 14;
    const fontSize = 10;

    // Add title if provided
    if (title) {
      yPosition = await this.addTitle(currentPage, title, yPosition);
      yPosition -= lineHeight * 1.5; // Extra space after title
    }

    // Add text lines
    for (const line of lines) {
      if (yPosition < this.MARGIN_BOTTOM + lineHeight) {
        // Create new page if we run out of space
        currentPage = pdfDoc.addPage([this.PAGE_WIDTH, this.PAGE_HEIGHT]);
        yPosition = this.PAGE_HEIGHT - this.MARGIN_TOP;

        // Re-add title on new page
        if (title) {
          yPosition = await this.addTitle(currentPage, title, yPosition);
          yPosition -= lineHeight * 1.5;
        }
      }

      // Wrap long lines
      const wrappedLines = this.wrapText(line, textWidth, fontSize);
      for (const wrappedLine of wrappedLines) {
        currentPage.drawText(wrappedLine, {
          x: this.MARGIN_LEFT,
          y: yPosition,
          size: fontSize,
          color: rgb(0, 0, 0),
        });
        yPosition -= lineHeight;
      }
    }

    // Convert to buffer
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  /**
   * Generate a PDF from layout information (pages and elements)
   */
  async generatePDFFromLayout(
    pages: Array<{
      pageNumber: number;
      text: string;
      elements?: Array<{
        type: string;
        content: string;
        position?: { x: number; y: number; width: number; height: number };
        style?: { fontSize?: number; fontFamily?: string; fontWeight?: string };
      }>;
    }>,
    title?: string
  ): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();

    for (const pageData of pages) {
      const page = pdfDoc.addPage([this.PAGE_WIDTH, this.PAGE_HEIGHT]);
      let yPosition = this.PAGE_HEIGHT - this.MARGIN_TOP;

      // Add page number
      if (pages.length > 1) {
        page.drawText(`Page ${pageData.pageNumber}`, {
          x: this.PAGE_WIDTH - this.MARGIN_RIGHT - 50,
          y: this.MARGIN_BOTTOM - 20,
          size: 8,
          color: rgb(0.5, 0.5, 0.5),
        });
      }

      // Add text content
      const lineHeight = 12;
      const fontSize = 10;
      const textWidth = this.PAGE_WIDTH - this.MARGIN_LEFT - this.MARGIN_RIGHT;

      // Add title on first page
      if (pageData.pageNumber === 1 && title) {
        yPosition = await this.addTitle(page, title, yPosition);
        yPosition -= lineHeight * 1.5;
      }

      // Add page text
      const lines = pageData.text.split('\n');
      for (const line of lines) {
        if (yPosition < this.MARGIN_BOTTOM + lineHeight) {
          break; // Stop if we run out of space on this page
        }

        const wrappedLines = this.wrapText(line, textWidth, fontSize);
        for (const wrappedLine of wrappedLines) {
          page.drawText(wrappedLine, {
            x: this.MARGIN_LEFT,
            y: yPosition,
            size: fontSize,
            color: rgb(0, 0, 0),
          });
          yPosition -= lineHeight;
        }
      }
    }

    // Convert to buffer
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  /**
   * Add title to a PDF page
   */
  private async addTitle(page: PDFPage, title: string, yPosition: number): Promise<number> {
    const fontSize = 16;
    const titleLines = this.wrapText(title, this.PAGE_WIDTH - this.MARGIN_LEFT - this.MARGIN_RIGHT, fontSize);

    for (const line of titleLines) {
      page.drawText(line, {
        x: this.MARGIN_LEFT,
        y: yPosition,
        size: fontSize,
        color: rgb(0, 0, 0),
      });
      yPosition -= 20;
    }

    return yPosition;
  }

  /**
   * Wrap text to fit within a specified width
   */
  private wrapText(text: string, maxWidth: number, fontSize: number): string[] {
    if (!text) return [];

    // Approximate character width (this is rough, but good enough for display)
    const charWidth = (fontSize * 0.5);
    const charsPerLine = Math.floor(maxWidth / charWidth);

    const lines: string[] = [];
    let currentLine = '';

    for (const word of text.split(' ')) {
      if (currentLine.length + word.length + 1 > charsPerLine) {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = currentLine ? `${currentLine} ${word}` : word;
      }
    }

    if (currentLine) lines.push(currentLine);
    return lines;
  }
}

// Export singleton instance
export const fallbackPDFGenerator = new FallbackPDFGenerator();
