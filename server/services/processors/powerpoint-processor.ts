/**
 * PowerPoint Document Processor
 * 
 * Extracts slide content and generates thumbnails from PowerPoint (.pptx) files.
 */

import { Buffer } from 'buffer';
import JSZip from 'jszip';
import { createCanvas } from 'canvas';
import { createRequire } from 'module';
import {
  BaseDocumentProcessor,
  DocumentType,
  FileMetadata,
  ProcessedDocument,
  extractTitleFromFileName,
  sanitizeText,
  countWords,
} from '../document-processor.js';
import { v4 as uuidv4 } from 'uuid';
import {
  ExtractionFailedError,
  ThumbnailGenerationFailedError,
  ProcessingFailedError,
} from '../../utils/document-errors.js';
import { pptToPDFConverter } from '../../utils/ppt-to-pdf-converter.js';
import { pdfLayoutExtractor } from '../../utils/pdf-layout-extractor.js';
import { fallbackPDFGenerator } from '../../utils/fallback-pdf-generator.js';

// xml2js is a CommonJS module, so we use createRequire
const require = createRequire(import.meta.url);
const { parseString } = require('xml2js');

/**
 * XML parser options that preserve namespace prefixes and attributes
 */
const XML_PARSE_OPTIONS = {
  explicitArray: false,
  mergeAttrs: true,
  ignoreAttrs: false,
  xmlns: false,
  stripPrefix: false, // Keep namespace prefixes like p:, a:
  attrkey: '@',
  charkey: '#text',
  normalizeTagName: false,
};

/**
 * PowerPoint-specific metadata
 */
interface PowerPointMetadata {
  slideCount: number;
  wordCount?: number;
  author?: string;
  title?: string;
  subject?: string;
  keywords?: string;
  createdAt?: Date;
  modifiedAt?: Date;
}

/**
 * Slide content (legacy format for backward compatibility)
 */
interface SlideContent {
  slideNumber: number;
  title?: string;
  content: string;
  notes?: string;
}

/**
 * PowerPoint Document Processor
 */
export class PowerPointProcessor extends BaseDocumentProcessor {
  private readonly SUPPORTED_MIME_TYPES = [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
  ];

  private readonly SUPPORTED_EXTENSIONS = [
    '.pptx',
    '.ppt',
  ];

  private readonly THUMBNAIL_WIDTH = 800;
  private readonly THUMBNAIL_HEIGHT = 600;
  private readonly MAX_THUMBNAILS = 10; // Generate thumbnails for first 10 slides

  /**
   * Check if this processor can handle given MIME type
   */
  canProcess(mimeType: string): boolean {
    return this.SUPPORTED_MIME_TYPES.includes(mimeType.toLowerCase());
  }

  /**
   * Check if this processor can handle given file extension
   */
  canProcessExtension(extension: string): boolean {
    return this.SUPPORTED_EXTENSIONS.includes(extension.toLowerCase());
  }

  /**
   * Get the document type this processor handles
   */
  getDocumentType(): DocumentType {
    return DocumentType.PPTX;
  }

  /**
   * Process a PowerPoint file and extract content
   * Converts PPT to PDF and extracts text + layout as structured JSON
   */
  async process(file: Buffer, metadata: FileMetadata): Promise<ProcessedDocument> {
    console.log(`🔄 Processing PowerPoint file: ${metadata.fileName} (${file.length} bytes)`);
    console.log(`🔄 PowerPoint processor called for MIME type: ${metadata.mimeType}`);

    try {
      // Validate file first
      await this.validateFile(file, metadata);

      let pdfBuffer: Buffer | undefined;
      let layoutResult: any;
      let conversionSuccessful = false;

      try {
        // Convert PPT to PDF using LibreOffice
        console.log(`🔄 Converting PPT to PDF for layout extraction`);
        const conversionResult = await pptToPDFConverter.convertToPDF(file, metadata.fileName);
        pdfBuffer = conversionResult.pdfBuffer;

        // Extract text and layout from PDF
        console.log(`🔄 Extracting text and layout from converted PDF`);
        layoutResult = await pdfLayoutExtractor.extractLayout(pdfBuffer);
        conversionSuccessful = true;

        console.log(`✅ PDF conversion successful: ${layoutResult.metadata.pageCount} pages`);
      } catch (conversionError) {
        console.warn(`⚠️  PDF conversion failed, falling back to text extraction + PDF generation: ${conversionError instanceof Error ? conversionError.message : 'Unknown error'}`);

        // Fallback: Extract text from PPT directly
        const zip = await JSZip.loadAsync(file);
        const slides = await this.extractSlides(zip);
        const text = slides.map(slide => slide.content).join('\n\n');

        // Create basic layout result
        layoutResult = {
          text,
          pages: slides.map((slide, index) => ({
            pageNumber: index + 1,
            text: slide.content,
            elements: [{
              type: 'text' as const,
              content: slide.content,
              position: { x: 50, y: 50, width: 500, height: 600, pageNumber: index + 1 },
              style: { fontFamily: 'Arial', fontSize: 12, fontWeight: 'normal' },
              confidence: 0.5,
            }],
            dimensions: { width: 595, height: 842 },
          })),
          metadata: {
            pageCount: slides.length,
            wordCount: countWords(text),
            characterCount: text.length,
          },
        };

        // Generate a fallback PDF from the extracted text
        try {
          console.log(`🔄 Generating fallback PDF from extracted text`);
          pdfBuffer = await fallbackPDFGenerator.generatePDFFromLayout(
            layoutResult.pages,
            extractTitleFromFileName(metadata.fileName)
          );
          conversionSuccessful = true;
          console.log(`✅ Fallback PDF generated: ${pdfBuffer.length} bytes`);
        } catch (pdfGenError) {
          console.warn(`⚠️  Fallback PDF generation failed: ${pdfGenError instanceof Error ? pdfGenError.message : 'Unknown error'}`);
          conversionSuccessful = false;
        }
      }

      // Extract basic metadata from original PPT for compatibility
      const zip = await JSZip.loadAsync(file);
      const slides = await this.extractSlides(zip);
      const pptMetadata = this.extractPowerPointMetadata(slides, metadata);

      // Create structured JSON with text + layout for indexing
      const layoutJson = {
        text: layoutResult.text, // Full text for search indexing
        pages: layoutResult.pages, // Layout information per page
        metadata: {
          ...layoutResult.metadata,
          ...pptMetadata,
          slideCount: slides.length,
          originalFileName: metadata.fileName,
          originalFileSize: metadata.fileSize,
          pdfConversionSuccessful: conversionSuccessful,
        },
      };

      // For the content field, store just the plain text (easier for display/preview)
      // The full layout JSON is stored in file_metadata for indexing
      const plainText = layoutResult.text || slides.map(s => s.content).join('\n\n');

      // Create processed document
      const processedDoc: ProcessedDocument = {
        docId: uuidv4(),
        docType: this.getDocumentType(),
        title: extractTitleFromFileName(metadata.fileName),
        content: plainText,
        metadata: {
          wordCount: layoutResult.metadata.wordCount,
          characterCount: layoutResult.metadata.characterCount,
          pageCount: layoutResult.metadata.pageCount,
          slideCount: slides.length,
          pdfConversionSuccessful: conversionSuccessful,
          // Store the full layout JSON in metadata for indexing
          layoutJson: JSON.stringify(layoutJson),
          ...pptMetadata,
        },
        thumbnails: [],
      };

      // Only include PDF buffer if conversion was successful
      if (pdfBuffer && conversionSuccessful) {
        processedDoc.pdfBuffer = pdfBuffer;
      }

      // Generate thumbnails from original PPT file
      processedDoc.thumbnails = await this.generateThumbnails(file, metadata);

      return processedDoc;
    } catch (error) {
      if (error instanceof ExtractionFailedError || error instanceof ThumbnailGenerationFailedError) {
        throw error;
      }
      throw new ProcessingFailedError(
        '',
        DocumentType.PPTX,
        error instanceof Error ? error.message : 'Unknown error processing PowerPoint presentation'
      );
    }
  }

  /**
   * Generate thumbnails for a PowerPoint presentation
   * Note: This is a simplified implementation. For production, you would use
   * LibreOffice or a similar library to render slides to images.
   */
  async generateThumbnails(file: Buffer, metadata: FileMetadata): Promise<string[]> {
    try {
      const thumbnails: string[] = [];

      // Load the .pptx file as a ZIP archive
      const zip = await JSZip.loadAsync(file);

      // Get slide files
      const slideFiles = Object.keys(zip.files)
        .filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
        .sort();

      // Generate thumbnails for first N slides
      const slidesToThumbnail = Math.min(slideFiles.length, this.MAX_THUMBNAILS);

      for (let i = 0; i < slidesToThumbnail; i++) {
        // In a real implementation, you would:
        // 1. Use LibreOffice or similar to render the slide to an image
        // 2. Upload to GCS or return as base64
        
        // For now, we'll create a placeholder thumbnail
        const thumbnail = await this.createPlaceholderThumbnail(i + 1, slideFiles.length);
        thumbnails.push(thumbnail);
      }

      return thumbnails;
    } catch (error) {
      throw new ThumbnailGenerationFailedError(
        '',
        DocumentType.PPTX,
        error instanceof Error ? error.message : 'Unknown error generating thumbnails'
      );
    }
  }

  /**
   * Extract slide content from the ZIP archive
   */
  private async extractSlides(zip: JSZip): Promise<SlideContent[]> {
    const slides: SlideContent[] = [];

    // Get slide files
    const slideFiles = Object.keys(zip.files)
      .filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
      .sort();

    for (let i = 0; i < slideFiles.length; i++) {
      const slideFile = slideFiles[i];
      const slideContent = await zip.file(slideFile)?.async('string');

      if (slideContent) {
        const slide = await this.parseSlideContent(slideContent, i + 1);
        slides.push(slide);
      }
    }

    return slides;
  }


  /**
   * Parse slide content from XML
   */
  private async parseSlideContent(xml: string, slideNumber: number): Promise<SlideContent> {
    return new Promise((resolve, reject) => {
      parseString(xml, XML_PARSE_OPTIONS, (err: any, result: any) => {
        if (err) {
          reject(err);
          return;
        }

        try {
          // Extract text from the slide
          const textElements = this.extractTextFromXML(result);
          const content = textElements.join(' ').trim();

          // Extract title (usually the first text element)
          const title = textElements.length > 0 ? textElements[0] : undefined;

          resolve({
            slideNumber,
            title,
            content,
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Parse slide elements with positioning and styling
   */
  private async parseSlideElements(xml: string, slideNumber: number): Promise<SlideElement[]> {
    return new Promise((resolve, reject) => {
      parseString(xml, XML_PARSE_OPTIONS, (err: any, result: any) => {
        if (err) {
          reject(err);
          return;
        }

        try {
          const elements: SlideElement[] = [];
          let elementCounter = 0;

          // Parse text elements
          const textElements = this.extractTextElements(result, slideNumber);
          elements.push(...textElements.map(el => ({ ...el, id: `elem-${slideNumber}-${++elementCounter}` })));

          // Parse shape elements (rectangles, etc.)
          const shapeElements = this.extractShapeElements(result, slideNumber);
          elements.push(...shapeElements.map(el => ({ ...el, id: `elem-${slideNumber}-${++elementCounter}` })));

          // Parse image elements
          const imageElements = this.extractImageElements(result, slideNumber);
          elements.push(...imageElements.map(el => ({ ...el, id: `elem-${slideNumber}-${++elementCounter}` })));

          resolve(elements);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Extract text elements with positioning and styling
   */
  private extractTextElements(obj: any, slideNumber: number): Omit<SlideElement, 'id'>[] {
    const elements: Omit<SlideElement, 'id'>[] = [];

    // Find all shapes with text, including nested ones in groups
    const shapes = this.findAllShapesRecursively(obj);
    
    for (const shape of shapes) {
      // Check for text body keys with multiple variations
      const txBodyKeys = ['p:txBody', 'p_txBody', 'a:txBody', 'a_txBody', 'txBody'];
      let hasTxBody = false;
      
      for (const key of txBodyKeys) {
        if (shape[key]) {
          hasTxBody = true;
          break;
        }
      }
      
      if (hasTxBody) {
        const text = this.extractTextContent(shape);

        if (text) {
          const position = this.extractPosition(shape);
          const size = this.extractSize(shape);
          const style = this.extractTextStyle(shape);
          
          elements.push({
            type: 'text',
            position,
            size,
            style,
            content: {
              text,
            },
          });
        }
      }
    }

    return elements;
  }

  /**
   * Find all shapes recursively, including those nested in groups
   */
  private findAllShapesRecursively(obj: any, depth: number = 0): any[] {
    const shapes: any[] = [];

    if (!obj || typeof obj !== 'object') return shapes;

    // Check for individual shape
    const shapeKeys = ['p:sp', 'p_sp', 'sp'];
    for (const key of shapeKeys) {
      if (obj[key]) {
        const sp = obj[key];
        shapes.push(...(Array.isArray(sp) ? sp : [sp]));
      }
    }

    // Check for group shapes which contain nested shapes
    const groupShapeKeys = ['p:grpSp', 'p_grpSp', 'grpSp'];
    for (const key of groupShapeKeys) {
      if (obj[key]) {
        const grp = obj[key];
        const groupArray = Array.isArray(grp) ? grp : [grp];
        for (const g of groupArray) {
          if (g) {
            // Recursively extract shapes from within groups
            shapes.push(...this.findAllShapesRecursively(g, depth + 1));
          }
        }
      }
    }

    // Recursively search all properties for spTree or other containers
    const searchKeys = ['p:spTree', 'p_spTree', 'spTree', 'p:grpSpPr', 'p_grpSpPr', 'grpSpPr'];
    for (const key of searchKeys) {
      if (obj[key] && typeof obj[key] === 'object') {
        shapes.push(...this.findAllShapesRecursively(obj[key], depth + 1));
      }
    }

    // Generic recursive search for nested objects
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object' && obj[key] !== null && depth < 5) {
        // Avoid infinite recursion and already-searched keys
        const skipKeys = [...shapeKeys, ...groupShapeKeys, ...searchKeys];
        if (!skipKeys.includes(key)) {
          shapes.push(...this.findAllShapesRecursively(obj[key], depth + 1));
        }
      }
    }

    return shapes.flat().filter(Boolean);
  }

  /**
   * Extract shape elements
   */
  private extractShapeElements(obj: any, slideNumber: number): Omit<SlideElement, 'id'>[] {
    const elements: Omit<SlideElement, 'id'>[] = [];

    const shapes = this.findShapes(obj);
    for (const shape of shapes) {
      // Skip text shapes (handled separately)
      if (shape['p:txBody'] || shape['a:txBody']) continue;

      const position = this.extractPosition(shape);
      const size = this.extractSize(shape);
      const shapeType = this.extractShapeType(shape);

      if (position && shapeType) {
        elements.push({
          type: 'shape',
          position,
          size: size || { width: 200, height: 200 },
          style: {
            fillColor: this.extractFillColor(shape),
            strokeColor: this.extractStrokeColor(shape),
            strokeWidth: this.extractStrokeWidth(shape),
          },
          content: {
            shapeType,
          },
        });
      }
    }

    return elements;
  }

  /**
   * Extract image elements
   */
  private extractImageElements(obj: any, slideNumber: number): Omit<SlideElement, 'id'>[] {
    // Image extraction from PPTX is complex and requires:
    // 1. Extracting image relationships from rels files
    // 2. Decoding image data from the PPTX ZIP
    // 3. Encoding images as data URLs or uploading them
    // For now, return empty array - images will not be shown but won't break layout
    // TODO: Implement proper image extraction using jszip to read image files
    return [];
  }

  /**
   * Extract position from PowerPoint XML (improved with better fallbacks)
   */
  private extractPosition(obj: any): { x: number; y: number } {
    try {
      // Look for transform information in spPr (shape properties)
      const spPr = obj['p:spPr'] || obj['p_spPr'] || obj['spPr'];
      
      if (spPr) {
        // Try multiple xfrm key variations
        const xfrmKeys = ['a:xfrm', 'a_xfrm', 'xfrm'];
        for (const xfrmKey of xfrmKeys) {
          const xfrm = spPr[xfrmKey];
          if (!xfrm) continue;
          
          // Try multiple offset key variations
          const offKeys = ['a:off', 'a_off', 'off'];
          for (const offKey of offKeys) {
            const off = xfrm[offKey];
            if (!off) continue;
            
            // Convert from EMUs to pixels
            const rawX = off['@_x'] || off['x'] || '0';
            const rawY = off['@_y'] || off['y'] || '0';
            const x = Math.round((parseInt(rawX) / 914400) * 96);
            const y = Math.round((parseInt(rawY) / 914400) * 96);
            
            if (!isNaN(x) && !isNaN(y) && (x > 0 || y > 0)) {
              return { x, y };
            }
          }
        }
      }
    } catch (error) {
      // Silently handle errors
    }
    
    // Generate semi-random positioning for fallback (stagger elements vertically)
    const fallbackX = 50 + (Math.random() * 100);
    const fallbackY = 50 + (Math.random() * 200);
    return { x: Math.round(fallbackX), y: Math.round(fallbackY) };
  }

  /**
   * Extract size from PowerPoint XML (improved with better fallbacks)
   */
  private extractSize(obj: any): { width: number; height: number } {
    try {
      // Look for transform in shape properties
      const spPr = obj['p:spPr'] || obj['p_spPr'] || obj['spPr'];
      
      if (spPr) {
        // Try multiple xfrm key variations
        const xfrmKeys = ['a:xfrm', 'a_xfrm', 'xfrm'];
        for (const xfrmKey of xfrmKeys) {
          const xfrm = spPr[xfrmKey];
          if (!xfrm) continue;
          
          // Try multiple extent key variations
          const extKeys = ['a:ext', 'a_ext', 'ext'];
          for (const extKey of extKeys) {
            const ext = xfrm[extKey];
            if (!ext) continue;
            
            const rawCx = ext['@_cx'] || ext['cx'] || '2438400';
            const rawCy = ext['@_cy'] || ext['cy'] || '1828800';
            const width = Math.round((parseInt(rawCx) / 914400) * 96);
            const height = Math.round((parseInt(rawCy) / 914400) * 96);
            
            if (!isNaN(width) && !isNaN(height) && (width > 0 || height > 0)) {
              return { width, height };
            }
          }
        }
      }
    } catch (error) {
      // Silently handle errors
    }
    
    // Fallback: Return reasonable default size for text element
    return { width: 800, height: 100 };
  }

  /**
   * Extract text content (improved hierarchy traversal)
   */
  private extractTextContent(obj: any): string {
    // Try multiple possible text body keys (handle namespace variations)
    const txBodyCandidates = [
      obj['p:txBody'], 
      obj['p_txBody'], 
      obj['a:txBody'], 
      obj['a_txBody'],
      obj['txBody']
    ];
    
    let txBody = null;
    for (const candidate of txBodyCandidates) {
      if (candidate) {
        txBody = candidate;
        break;
      }
    }
    
    if (!txBody) return '';

    const paragraphs = Array.isArray(txBody['a:p']) ? txBody['a:p'] : [txBody['a:p']].filter(Boolean);
    const textParts: string[] = [];

    for (const para of paragraphs) {
      if (!para) continue;
      
      // Handle text runs (a:r elements)
      const runs = Array.isArray(para['a:r']) ? para['a:r'] : [para['a:r']].filter(Boolean);
      for (const run of runs) {
        if (!run) continue;
        
        // Extract text from run
        if (run['a:t']) {
          const textContent = run['a:t'];
          if (typeof textContent === 'string') {
            textParts.push(textContent);
          }
        }
        
        // Also handle direct text in run (in case a:t is not wrapped)
        if (run['#text']) {
          textParts.push(run['#text']);
        }
      }
      
      // Also check for text directly in paragraph (less common but possible)
      if (para['a:t']) {
        textParts.push(para['a:t']);
      }
    }

    return textParts.join(' ').trim();
  }

  /**
   * Extract text styling
   */
  private extractTextStyle(obj: any): ElementStyle {
    const style: ElementStyle = {};

    try {
      const txBody = obj['p:txBody'] || obj['a:txBody'];
      if (txBody && txBody['a:p']) {
        const para = txBody['a:p'];
        const run = para['a:r'];

        if (run && run['a:rPr']) {
          const rPr = run['a:rPr'];

          // Font size (in points, half-points in XML)
          if (rPr['@_sz']) {
            style.fontSize = parseInt(rPr['@_sz']) / 100; // Convert from half-points
          }

          // Font family
          if (rPr['a:latin'] && rPr['a:latin']['@_typeface']) {
            style.fontFamily = rPr['a:latin']['@_typeface'];
          }

          // Bold
          if (rPr['@_b'] === '1') {
            style.fontWeight = 'bold';
          }

          // Color
          if (rPr['a:solidFill'] && rPr['a:solidFill']['a:srgbClr']) {
            style.color = `#${rPr['a:solidFill']['a:srgbClr']['@_val']}`;
          }
        }
      }
    } catch (error) {
      // Ignore styling errors
    }

    return style;
  }

  /**
   * Extract shape type
   */
  private extractShapeType(obj: any): string | null {
    // Look for shape type in XML
    if (obj['@_prst'] || obj['p:prstGeom']) {
      return obj['@_prst'] || obj['p:prstGeom']['@_prst'] || 'rect';
    }
    return null;
  }

  /**
   * Extract fill color
   */
  private extractFillColor(obj: any): string {
    try {
      const spPr = obj['p:spPr'];
      if (spPr && spPr['a:solidFill'] && spPr['a:solidFill']['a:srgbClr']) {
        return `#${spPr['a:solidFill']['a:srgbClr']['@_val']}`;
      }
    } catch (error) {
      // Ignore
    }
    return '#FFFFFF'; // Default white
  }

  /**
   * Extract stroke color and width
   */
  private extractStrokeColor(obj: any): string {
    try {
      const spPr = obj['p:spPr'];
      if (spPr && spPr['a:ln'] && spPr['a:ln']['a:solidFill'] && spPr['a:ln']['a:solidFill']['a:srgbClr']) {
        return `#${spPr['a:ln']['a:solidFill']['a:srgbClr']['@_val']}`;
      }
    } catch (error) {
      // Ignore
    }
    return '#000000'; // Default black
  }

  private extractStrokeWidth(obj: any): number {
    try {
      const spPr = obj['p:spPr'];
      if (spPr && spPr['a:ln'] && spPr['a:ln']['@_w']) {
        // Convert from EMUs to pixels
        return Math.round((parseInt(spPr['a:ln']['@_w']) / 914400) * 96);
      }
    } catch (error) {
      // Ignore
    }
    return 1; // Default width
  }

  /**
   * Find all shapes in the XML (improved namespace handling)
   */
  private findShapes(obj: any): any[] {
    const shapes: any[] = [];

    if (!obj || typeof obj !== 'object') return shapes;

    // First, check for spTree which contains the actual shapes
    const spTreeKeys = ['p:spTree', 'p_spTree', 'spTree'];
    for (const key of spTreeKeys) {
      if (obj[key]) {
        const spTree = obj[key];
        // Extract individual p:sp elements from spTree
        const shapeKeys = ['p:sp', 'p_sp', 'sp'];
        for (const shapeKey of shapeKeys) {
          if (spTree[shapeKey]) {
            const sp = spTree[shapeKey];
            const toAdd = Array.isArray(sp) ? sp : [sp];
            shapes.push(...toAdd.filter(Boolean));
          }
        }
      }
    }

    // Also try direct p:sp keys (for non-tree layouts)
    const directShapeKeys = ['p:sp', 'p_sp', 'sp'];
    for (const key of directShapeKeys) {
      if (obj[key] && !['p:spTree', 'p_spTree', 'spTree'].includes(key)) {
        const sp = obj[key];
        shapes.push(...(Array.isArray(sp) ? sp : [sp]));
      }
    }

    // Recursively search all properties for nested structures
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        // Don't re-search already processed keys
        if (!['p:sp', 'p_sp', 'sp', 'p:spTree', 'p_spTree', 'spTree'].includes(key)) {
          shapes.push(...this.findShapes(obj[key]));
        }
      }
    }

    return shapes.flat().filter(Boolean);
  }

  /**
   * Find all images in the XML (improved namespace handling)
   */
  private findImages(obj: any): any[] {
    const images: any[] = [];

    if (!obj || typeof obj !== 'object') return images;

    // Try both with and without namespace prefix (handle xml2js variations)
    const picKeys = ['p:pic', 'p_pic', 'pic'];
    for (const key of picKeys) {
      if (obj[key]) {
        const pic = obj[key];
        images.push(...(Array.isArray(pic) ? pic : [pic]));
      }
    }

    // Recursively search all properties
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        // Don't re-search picture keys
        if (!['p:pic', 'p_pic', 'pic'].includes(key)) {
          images.push(...this.findImages(obj[key]));
        }
      }
    }

    return images.flat().filter(Boolean);
  }

  /**
   * Extract text from XML structure (legacy method for backward compatibility)
   */
  private extractTextFromXML(obj: any): string[] {
    const texts: string[] = [];

    if (typeof obj === 'string') {
      texts.push(obj);
    } else if (Array.isArray(obj)) {
      for (const item of obj) {
        texts.push(...this.extractTextFromXML(item));
      }
    } else if (typeof obj === 'object' && obj !== null) {
      // Look for text elements in PowerPoint XML structure
      if (obj['a:t']) {
        texts.push(obj['a:t']);
      }
      if (obj['a:txBody']) {
        texts.push(...this.extractTextFromXML(obj['a:txBody']));
      }
      if (obj['a:p']) {
        texts.push(...this.extractTextFromXML(obj['a:p']));
      }
      if (obj['a:r']) {
        texts.push(...this.extractTextFromXML(obj['a:r']));
      }

      // Only recursively search child elements, not attributes
      // Attributes start with '@' or are metadata-like (xmlns, cx, cy, etc.)
      for (const key of Object.keys(obj)) {
        // Skip attributes and metadata properties
        const isAttribute = key.startsWith('@') || key.startsWith('xmlns');
        const isMetadata = ['cx', 'cy', 'x', 'y', 'rot', 'flipH', 'flipV', 'id', 'name', 'descr', 'rId', 'type', 'preset', 'rect', 'ln', 'fill', 'effectLst', 'spPr'].includes(key);
        
        // Skip if this is a key we already processed
        const alreadyProcessed = ['a:t', 'a:txBody', 'a:p', 'a:r'].includes(key);

        if (!isAttribute && !isMetadata && !alreadyProcessed) {
          texts.push(...this.extractTextFromXML(obj[key]));
        }
      }
    }

    return texts;
  }

  /**
   * Extract PowerPoint metadata
   */
  private extractPowerPointMetadata(slides: SlideContent[], fileMetadata: FileMetadata): PowerPointMetadata {
    // Count total words across all slides
    const wordCount = slides.reduce((sum, slide) => sum + countWords(slide.content), 0);

    return {
      slideCount: slides.length,
      wordCount,
      title: extractTitleFromFileName(fileMetadata.fileName),
      // Note: For production, you would extract document properties from ppt/core.xml
    };
  }

  /**
   * Create a placeholder thumbnail
   * In production, this would render the actual PowerPoint slide
   */
  private async createPlaceholderThumbnail(slideNumber: number, totalSlides: number): Promise<string> {
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
    ctx.fillText(`Slide ${slideNumber}`, this.THUMBNAIL_WIDTH / 2, this.THUMBNAIL_HEIGHT / 2 - 20);

    ctx.font = '16px Arial';
    ctx.fillText(`of ${totalSlides}`, this.THUMBNAIL_WIDTH / 2, this.THUMBNAIL_HEIGHT / 2 + 20);

    // PowerPoint icon
    ctx.fillStyle = '#ea580c';
    ctx.font = 'bold 48px Arial';
    ctx.fillText('PPTX', this.THUMBNAIL_WIDTH / 2, this.THUMBNAIL_HEIGHT / 2 + 80);

    // Convert to base64
    return canvas.toDataURL('image/png');
  }

  /**
   * Validate PowerPoint file
   */
  async validateFile(file: Buffer, metadata: FileMetadata): Promise<void> {
    await super.validateFile(file, metadata);

    // Check if it's a .pptx file (ZIP archive with specific structure)
    // .pptx files are ZIP archives starting with PK magic bytes
    const zipMagicBytes = Buffer.from([0x50, 0x4B, 0x03, 0x04]); // PK..
    if (!file.subarray(0, 4).equals(zipMagicBytes)) {
      throw new ProcessingFailedError(
        '',
        DocumentType.PPTX,
        'Invalid PowerPoint presentation: not a valid .pptx file'
      );
    }

    // Try to load as ZIP to ensure it's valid
    try {
      const zip = await JSZip.loadAsync(file);

      // Check for required PowerPoint structure
      if (!zip.file('ppt/presentation.xml')) {
        throw new ProcessingFailedError(
          '',
          DocumentType.PPTX,
          'Invalid PowerPoint presentation: missing presentation.xml'
        );
      }

      if (!zip.file('[Content_Types].xml')) {
        throw new ProcessingFailedError(
          '',
          DocumentType.PPTX,
          'Invalid PowerPoint presentation: missing [Content_Types].xml'
        );
      }
    } catch (error) {
      if (error instanceof ProcessingFailedError) {
        throw error;
      }
      throw new ProcessingFailedError(
        '',
        DocumentType.PPTX,
        `Invalid PowerPoint presentation: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

/**
 * Export singleton instance
 */
export const powerPointProcessor = new PowerPointProcessor();
