/**
 * PPT to PDF Converter Utility
 *
 * Converts PowerPoint files (.ppt, .pptx) to PDF using LibreOffice.
 * Uses headless LibreOffice to perform the conversion.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { tmpdir, platform } from 'os';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);

export interface ConversionOptions {
  /** Quality of output PDF (1-100, default: 90) */
  quality?: number;
  /** Page range to convert (e.g., "1-3", default: all) */
  pageRange?: string;
  /** Output PDF filename (without extension) */
  outputName?: string;
}

export interface ConversionResult {
  /** PDF buffer */
  pdfBuffer: Buffer;
  /** Size of PDF in bytes */
  pdfSize: number;
  /** Number of pages in PDF */
  pageCount?: number;
}

export class PPTToPDFConverter {
  // On macOS, use the full path to LibreOffice if available
  // On Linux/Windows, use the command from PATH
  private readonly LIBREOFFICE_COMMAND = this.getLibreOfficeCommand();

  /**
   * Get the LibreOffice command path
   * On macOS, check the standard installation location
   */
  private getLibreOfficeCommand(): string {
    // On macOS, check standard installation location
    if (platform() === 'darwin') {
      const macPath = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
      if (existsSync(macPath)) {
        return macPath;
      }
    }
    
    // Fallback to standard command name
    return 'libreoffice';
  }

  /**
   * Convert PowerPoint file to PDF using LibreOffice
   */
  async convertToPDF(
    pptBuffer: Buffer,
    fileName: string,
    options: ConversionOptions = {}
  ): Promise<ConversionResult> {
    const {
      quality = 90,
      pageRange,
      outputName = 'converted'
    } = options;

    // Create temporary directory and files
    const tempDir = join(tmpdir(), `ppt-conversion-${randomUUID()}`);
    const inputPath = join(tempDir, fileName);
    const outputPath = join(tempDir, `${outputName}.pdf`);

    try {
      // Ensure temp directory exists
      await mkdir(tempDir, { recursive: true });

      // Write input file
      await writeFile(inputPath, pptBuffer);

      // Build LibreOffice command
      const command = this.buildLibreOfficeCommand(inputPath, outputPath, {
        quality,
        pageRange
      });

      // Determine expected output filename (LibreOffice uses input filename without extension)
      const inputBaseName = fileName.replace(/\.(ppt|pptx)$/i, '');
      const expectedOutputName = `${inputBaseName}.pdf`;

      console.log(`🔄 Converting PPT to PDF: ${fileName} -> ${expectedOutputName}`);
      console.log(`🔄 Executing: ${command}`);
      console.log(`🔄 Expected output file: ${join(tempDir, expectedOutputName)}`);

      // Execute conversion
      const { stdout, stderr } = await execAsync(command, {
        timeout: 300000, // 5 minute timeout for large files
      });

      // Check for errors in stderr (LibreOffice often outputs warnings to stderr even on success)
      // But if there's a critical error, it will be in stderr
      if (stderr && stderr.includes('Error')) {
        console.error(`❌ LibreOffice error: ${stderr}`);
        throw new Error(`LibreOffice conversion error: ${stderr}`);
      } else if (stderr) {
        console.warn(`⚠️  LibreOffice warning: ${stderr}`);
      }

      if (stdout) {
        console.log(`ℹ️  LibreOffice output: ${stdout}`);
      }

      // LibreOffice outputs PDF with the same name as input file (without extension) + .pdf
      // So if input is "presentation.pptx", output will be "presentation.pdf"
      const actualOutputPath = join(tempDir, expectedOutputName);

      // Verify the PDF file exists
      const fs = await import('fs/promises');
      if (!existsSync(actualOutputPath)) {
        // List files in temp directory for debugging
        const files = await fs.readdir(tempDir);
        console.error(`❌ Expected PDF file not found: ${actualOutputPath}`);
        console.error(`📁 Files in temp directory:`, files);
        throw new Error(`PDF conversion failed: Output file not found. Expected: ${actualOutputPath}, Found files: ${files.join(', ')}`);
      }

      // Read output PDF
      const pdfBuffer = await fs.readFile(actualOutputPath);

      // Get PDF metadata (page count)
      const pageCount = await this.getPDFPageCount(pdfBuffer);

      console.log(`✅ PPT to PDF conversion successful: ${pdfBuffer.length} bytes, ${pageCount} pages`);

      return {
        pdfBuffer,
        pdfSize: pdfBuffer.length,
        pageCount
      };

    } catch (error) {
      console.error(`❌ PPT to PDF conversion failed:`, error);
      throw new Error(
        `Failed to convert PowerPoint to PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      // Clean up temporary files
      try {
        await this.cleanupTempFiles(tempDir);
      } catch (cleanupError) {
        console.warn(`⚠️  Failed to cleanup temp files: ${cleanupError}`);
      }
    }
  }

  /**
   * Build LibreOffice command for conversion
   */
  private buildLibreOfficeCommand(
    inputPath: string,
    outputPath: string,
    options: { quality: number; pageRange?: string }
  ): string {
    const { quality, pageRange } = options;

    // Base command
    let command = `${this.LIBREOFFICE_COMMAND} --headless --convert-to pdf`;

    // Add quality option (LibreOffice uses 1-100, higher is better)
    command += ` --pdf-quality ${Math.min(100, Math.max(1, quality))}`;

    // Add page range if specified
    if (pageRange) {
      command += ` --pdf-range ${pageRange}`;
    }

    // Add output directory and input file
    const outputDir = dirname(outputPath);
    const outputName = outputPath.replace('.pdf', '');

    command += ` --outdir "${outputDir}" "${inputPath}"`;

    return command;
  }

  /**
   * Get page count from PDF buffer
   * This is a simple implementation - in production you might want more robust PDF parsing
   */
  private async getPDFPageCount(pdfBuffer: Buffer): Promise<number> {
    try {
      // Simple approach: look for /Count in PDF metadata
      const pdfString = pdfBuffer.toString('latin1');
      const countMatch = pdfString.match(/\/Count\s+(\d+)/);

      if (countMatch) {
        return parseInt(countMatch[1], 10);
      }

      // Fallback: estimate based on file size (rough approximation)
      // Typical PDF page is around 50-100KB
      const estimatedPages = Math.max(1, Math.round(pdfBuffer.length / 75000));

      console.warn(`⚠️  Could not determine exact page count, estimating ${estimatedPages} pages`);
      return estimatedPages;

    } catch (error) {
      console.warn(`⚠️  Failed to get page count: ${error}`);
      return 1; // Default fallback
    }
  }

  /**
   * Clean up temporary files
   */
  private async cleanupTempFiles(tempDir: string): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');

      // Recursively remove temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn(`⚠️  Failed to cleanup temp directory ${tempDir}:`, error);
    }
  }

  /**
   * Check if LibreOffice is available on the system
   */
  async checkLibreOfficeAvailability(): Promise<boolean> {
    try {
      await execAsync(`${this.LIBREOFFICE_COMMAND} --version`);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate input file type
   */
  validateFileType(fileName: string): boolean {
    const ext = extname(fileName).toLowerCase();
    return ['.ppt', '.pptx'].includes(ext);
  }
}

/**
 * Singleton instance
 */
export const pptToPDFConverter = new PPTToPDFConverter();