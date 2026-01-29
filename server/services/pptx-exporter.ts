/**
 * PPTX Export Service
 *
 * Converts PresentationJSON back to PowerPoint (.pptx) files using pptxgenjs
 */

import PptxGenJS from 'pptxgenjs';
import type { PresentationJSON, SlideJSON, SlideElement } from '../../src/types/presentation';

export class PPTXExporter {
  /**
   * Export PresentationJSON to PPTX buffer
   */
  async exportToPPTX(presentationJson: PresentationJSON): Promise<Buffer> {
    const pptx = new PptxGenJS();

    // Set presentation properties
    pptx.author = presentationJson.metadata.author || 'LeanWorks';
    pptx.company = 'LeanWorks';
    pptx.title = presentationJson.metadata.title;
    pptx.subject = `Created from LeanWorks Presentation Editor`;

    // Process each slide
    for (const slideJson of presentationJson.slides) {
      const pptxSlide = pptx.addSlide();

      // Set slide background
      this.applySlideBackground(pptxSlide, slideJson);

      // Add all elements to the slide
      for (const element of slideJson.elements) {
        await this.addElementToSlide(pptxSlide, element);
      }

      // Set slide transitions (if supported)
      if (slideJson.transitions) {
        this.applySlideTransition(pptxSlide, slideJson.transitions);
      }
    }

    // Generate the PPTX file as a buffer
    const result = await pptx.write({ outputType: 'nodebuffer' });
    return Buffer.from(result as ArrayBuffer);
  }

  /**
   * Apply slide background
   */
  private applySlideBackground(pptxSlide: any, slideJson: SlideJSON): void {
    const background = slideJson.background;

    switch (background.type) {
      case 'solid':
        if (background.color) {
          pptxSlide.background = { color: background.color };
        }
        break;
      case 'gradient':
        // pptxgenjs has limited gradient support
        if (background.color) {
          pptxSlide.background = { color: background.color };
        }
        break;
      case 'image':
        // Would need to download and embed the image
        // For now, use solid color fallback
        if (background.color) {
          pptxSlide.background = { color: background.color };
        }
        break;
    }
  }

  /**
   * Add an element to a slide
   */
  private async addElementToSlide(pptxSlide: any, element: SlideElement): Promise<void> {
    try {
      switch (element.type) {
        case 'text':
          this.addTextElement(pptxSlide, element);
          break;
        case 'shape':
          this.addShapeElement(pptxSlide, element);
          break;
        case 'image':
          await this.addImageElement(pptxSlide, element);
          break;
        case 'table':
          this.addTableElement(pptxSlide, element);
          break;
        default:
          console.warn(`Unsupported element type: ${element.type}`);
      }
    } catch (error) {
      console.error(`Error adding element ${element.id}:`, error);
      // Continue with other elements
    }
  }

  /**
   * Add text element to slide
   */
  private addTextElement(pptxSlide: any, element: SlideElement): void {
    const textContent = element.content?.text || '';
    if (!textContent.trim()) return;

    const style = element.style || {};
    const options: any = {
      x: this.pixelsToInches(element.position.x),
      y: this.pixelsToInches(element.position.y),
      w: this.pixelsToInches(element.size.width),
      h: this.pixelsToInches(element.size.height),
    };

    // Text formatting
    if (style.fontSize) {
      options.fontSize = Math.max(8, Math.min(96, style.fontSize)); // Clamp font size
    }

    if (style.fontFamily) {
      options.fontFace = style.fontFamily;
    }

    if (style.fontWeight === 'bold') {
      options.bold = true;
    }

    if (style.color) {
      options.color = style.color;
    }

    if (style.textAlign) {
      options.align = style.textAlign;
    }

    // Handle multi-line text
    const lines = textContent.split('\n');
    if (lines.length > 1) {
      options.text = lines;
    } else {
      options.text = textContent;
    }

    pptxSlide.addText(options);
  }

  /**
   * Add shape element to slide
   */
  private addShapeElement(pptxSlide: any, element: SlideElement): void {
    const shapeType = element.content?.shapeType || 'rect';
    const style = element.style || {};

    const options: any = {
      x: this.pixelsToInches(element.position.x),
      y: this.pixelsToInches(element.position.y),
      w: this.pixelsToInches(element.size.width),
      h: this.pixelsToInches(element.size.height),
    };

    // Fill color
    if (style.fillColor) {
      options.fill = { color: style.fillColor };
    }

    // Border/stroke
    if (style.strokeColor && style.strokeWidth) {
      options.line = {
        color: style.strokeColor,
        width: Math.max(0.5, Math.min(10, style.strokeWidth)), // Clamp width
      };
    }

    // Map shape types to pptxgenjs shapes
    const shapeMap: Record<string, string> = {
      'rect': 'rect',
      'rectangle': 'rect',
      'circle': 'ellipse',
      'oval': 'ellipse',
      'triangle': 'triangle',
      'diamond': 'diamond',
      'star': 'star5',
      'line': 'line',
    };

    const pptxShape = shapeMap[shapeType] || 'rect';

    if (pptxShape === 'line') {
      // Special handling for lines
      pptxSlide.addShape({
        ...options,
        shape: 'line',
        line: options.line || { color: '#000000', width: 1 },
      });
    } else {
      pptxSlide.addShape({
        ...options,
        shape: pptxShape,
      });
    }
  }

  /**
   * Add image element to slide
   */
  private async addImageElement(pptxSlide: any, element: SlideElement): Promise<void> {
    const imageSrc = element.content?.src;
    if (!imageSrc) return;

    // For now, skip images that aren't data URLs or external URLs
    // In a production system, you'd need to:
    // 1. Download images from GCS/cloud storage
    // 2. Convert to supported formats
    // 3. Embed in PPTX

    console.warn(`Image export not fully implemented for element ${element.id}`);
    // Could add a placeholder text instead
    pptxSlide.addText('[Image]', {
      x: this.pixelsToInches(element.position.x),
      y: this.pixelsToInches(element.position.y),
      w: this.pixelsToInches(element.size.width),
      h: this.pixelsToInches(element.size.height),
      color: '#666666',
      fontSize: 12,
    });
  }

  /**
   * Add table element to slide
   */
  private addTableElement(pptxSlide: any, element: SlideElement): void {
    // Table support is complex and not fully implemented yet
    console.warn(`Table export not implemented for element ${element.id}`);
  }

  /**
   * Apply slide transition
   */
  private applySlideTransition(pptxSlide: any, transition: any): void {
    // pptxgenjs has limited transition support
    // This would require extending the library or using a different approach
    console.warn('Slide transitions not yet supported in export');
  }

  /**
   * Convert pixels to inches (PowerPoint uses inches)
   */
  private pixelsToInches(pixels: number): number {
    // Assuming 96 DPI (standard web)
    return pixels / 96;
  }

  /**
   * Convert inches to pixels
   */
  private inchesToPixels(inches: number): number {
    return inches * 96;
  }
}

// Export singleton instance
export const pptxExporter = new PPTXExporter();

// Convenience function
export async function exportPresentationToPPTX(presentationJson: PresentationJSON): Promise<Buffer> {
  return await pptxExporter.exportToPPTX(presentationJson);
}