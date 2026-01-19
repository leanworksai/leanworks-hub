/**
 * PDF Export Utility
 * Exports document content to PDF format on the client side
 */

/**
 * Dynamically load a script from CDN
 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Dynamically load a stylesheet from CDN
 */
function loadStylesheet(href: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load stylesheet: ${href}`));
    document.head.appendChild(link);
  });
}

/**
 * Convert image to base64 data URL to avoid CORS issues
 * @param imgSrc - Image source URL
 * @returns Promise that resolves to base64 data URL or null if failed
 */
async function convertImageToBase64(imgSrc: string): Promise<string | null> {
  try {
    console.log('Attempting to convert image to base64:', imgSrc.substring(0, 100), '...');

    // Check if we're in development vs production
    const isDevelopment = window.location.hostname === 'localhost' ||
                         window.location.hostname === '127.0.0.1' ||
                         window.location.hostname.includes('dev') ||
                         window.location.hostname.includes('staging');

    let proxyUrl: string;

    if (isDevelopment) {
      // Use public CORS proxy for development
      proxyUrl = `https://cors-anywhere.herokuapp.com/${imgSrc}`;
      console.log('Using development CORS proxy for image conversion');
    } else {
      // Use our backend proxy for production
      const encodedUrl = encodeURIComponent(imgSrc);
      proxyUrl = `/api/images/proxy?url=${encodedUrl}`;
      console.log('Using production backend proxy for image conversion');
    }

    try {
      console.log('Trying proxy approach...');
      const response = await fetch(proxyUrl);
      if (response.ok) {
        const blob = await response.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            console.log('Proxy successful, base64 length:', (reader.result as string).length);
            resolve(reader.result as string);
          };
          reader.onerror = () => {
            console.log('Proxy FileReader failed');
            resolve(null);
          };
          reader.readAsDataURL(blob);
        });
      } else {
        console.log('Proxy returned non-OK status:', response.status);
      }
    } catch (proxyError) {
      console.log('Proxy approach failed:', proxyError);
    }

    // Fallback: Direct fetch
    try {
      console.log('Trying direct fetch approach...');
      const response = await fetch(imgSrc, { mode: 'cors' });
      if (response.ok) {
        const blob = await response.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            console.log('Direct fetch successful, base64 length:', (reader.result as string).length);
            resolve(reader.result as string);
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      }
    } catch (fetchError) {
      console.log('Direct fetch approach failed:', fetchError);
    }

    // Final fallback: Image with crossOrigin
    console.log('Trying Image element approach...');
    const img = new Image();
    img.crossOrigin = 'anonymous';

    return new Promise((resolve) => {
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }

          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          ctx.drawImage(img, 0, 0);

          const base64 = canvas.toDataURL('image/png');
          console.log('Image element approach successful, base64 length:', base64.length);
          resolve(base64);
        } catch (canvasError) {
          console.warn('Canvas toDataURL failed (CORS):', canvasError);
          resolve(null);
        }
      };

      img.onerror = () => {
        console.warn('Image element failed to load:', imgSrc);
        resolve(null);
      };

      setTimeout(() => {
        if (!img.complete) {
          console.warn('Image load timeout:', imgSrc);
          resolve(null);
        }
      }, 8000); // Increased timeout

      img.src = imgSrc;
    });
  } catch (error) {
    console.warn('Error in convertImageToBase64:', imgSrc, error);
    return null;
  }
}

/**
 * Wait for all images in a container to load, with CORS fallback
 * @param container - DOM element containing images
 */
async function waitForImages(container: HTMLElement): Promise<void> {
  return new Promise(async (resolve) => {
    const images = container.querySelectorAll('img');
    console.log('Found', images.length, 'images in container');

    if (images.length === 0) {
      resolve();
      return;
    }

    let processedCount = 0;

    const checkComplete = () => {
      processedCount++;
      console.log('Processed', processedCount, 'of', images.length, 'images');
      if (processedCount === images.length) {
        console.log('All images processed, resolving');
        resolve();
      }
    };

    for (const img of images) {
      const htmlImg = img as HTMLImageElement;
      console.log('Processing image:', htmlImg.src.substring(0, 100), '...');

      // Test if image can actually be drawn to canvas (not just if it's loaded)
      const canUseImage = async (): Promise<boolean> => {
        if (!htmlImg.complete || htmlImg.naturalHeight === 0) {
          return false;
        }
        
        try {
          // Try to actually draw it to a test canvas to verify CORS
          const testCanvas = document.createElement('canvas');
          const testCtx = testCanvas.getContext('2d');
          if (!testCtx) return false;
          
          testCanvas.width = 1;
          testCanvas.height = 1;
          testCtx.drawImage(htmlImg, 0, 0, 1, 1);
          // Try to read the canvas data - this will fail if CORS is blocked
          testCanvas.toDataURL();
          return true;
        } catch (error) {
          console.log('Image loaded but cannot be used due to CORS:', error);
          return false;
        }
      };

      const originalSrc = htmlImg.src;
      const imageUsable = await canUseImage();

      if (imageUsable) {
        console.log('Image already loaded and verified usable');
        checkComplete();
      } else {
        // Try to convert image to base64 to avoid CORS issues
        console.log('Attempting to convert image to base64:', originalSrc);
        const base64Data = await convertImageToBase64(originalSrc);

        if (base64Data) {
          console.log('Successfully converted image to base64, setting src');
          htmlImg.src = base64Data;
          htmlImg.onload = () => {
            console.log('Base64 image loaded successfully');
            checkComplete();
          };
          htmlImg.onerror = () => {
            console.warn('Base64 image failed to load, reverting to original src');
            htmlImg.src = originalSrc; // Revert to original
            checkComplete();
          };
        } else {
          console.warn('Failed to convert image to base64, keeping original src for html2canvas');
          // Keep original src - html2canvas will attempt to load it with allowTaint
          htmlImg.src = originalSrc;
          checkComplete();
        }

        // Set a timeout as fallback
        setTimeout(() => {
          if (!htmlImg.complete) {
            console.warn('Image processing timeout, keeping original src');
            htmlImg.src = originalSrc; // Ensure original src
            checkComplete();
          }
        }, 8000); // Increased timeout to match base64 function
      }
    }
  });
}

/**
 * Export document content to PDF
 * @param content - HTML content to export
 * @param filename - Name of the PDF file
 * @param title - Title of the document
 */
export async function exportToPDF(
  content: string,
  filename: string = 'document.pdf',
  title: string = 'Document'
): Promise<void> {
  try {
    // Validate that content is not empty
    if (!content || !content.trim()) {
      throw new Error('Document content is empty. Please add content before exporting.');
    }

    // Load required libraries from CDN
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');

    // Create a temporary container for the content
    const container = document.createElement('div');
    console.log('Setting container innerHTML, content length:', content.length);
    console.log('Content preview:', content.substring(0, 500), '...');
    container.innerHTML = content;
    console.log('Container innerHTML length after setting:', container.innerHTML.length);
    console.log('Container textContent length:', container.textContent?.length);
    console.log('Container children count:', container.children.length);
    
    container.style.padding = '20px';
    container.style.fontFamily = 'Arial, sans-serif';
    container.style.lineHeight = '1.6';
    container.style.color = '#000';
    container.style.backgroundColor = '#fff';

    // Temporarily attach to DOM for better image loading and PDF generation
    // Position off-screen but still renderable
    container.style.position = 'absolute';
    container.style.top = '-9999px';
    container.style.left = '-9999px';
    container.style.width = '210mm';
    container.style.minHeight = '297mm';
    container.style.visibility = 'hidden'; // Use visibility instead of opacity
    container.style.overflow = 'visible';
    document.body.appendChild(container);

    // Validate that the container has content after setting innerHTML
    console.log('Container content validation:');
    console.log('- Text content:', container.textContent?.substring(0, 200), '...');
    console.log('- Has images:', !!container.querySelector('img'));
    console.log('- Image count:', container.querySelectorAll('img').length);

    if (!container.textContent?.trim() && !container.querySelector('img')) {
      console.error('Document content appears to be empty or contains no exportable elements');
      throw new Error('Document content appears to be empty or contains no exportable elements.');
    }

    // Title is already included in the TipTap content as h1 element

    // Wait for all images to load before generating PDF
    await waitForImages(container);

    // Re-validate that container still has content after image processing
    console.log('After image processing:');
    console.log('- Container innerHTML length:', container.innerHTML.length);
    console.log('- Container textContent:', container.textContent?.substring(0, 300), '...');
    console.log('- Remaining images:', container.querySelectorAll('img').length);
    
    if (!container.textContent?.trim() && container.querySelectorAll('img').length === 0) {
      // Clean up the container
      if (document.body.contains(container)) {
        document.body.removeChild(container);
      }
      throw new Error('Document content is empty after processing images. The document may only contain images that failed to load due to CORS restrictions.');
    }

    // Add loading overlay for user feedback
    const loadingOverlay = document.createElement('div');
    loadingOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      color: white;
      font-size: 18px;
      font-family: Arial, sans-serif;
    `;
    loadingOverlay.innerHTML = '<div>Generating PDF...</div>';
    document.body.appendChild(loadingOverlay);

    // Configure PDF options with enhanced image support
    const opt = {
      margin: [10, 10, 10, 10],
      filename: filename,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: {
        scale: 2,
        useCORS: true, // Enable CORS for images
        allowTaint: true, // Allow tainted canvases (for CORS images)
        backgroundColor: '#ffffff',
        logging: true, // Enable for debugging
        width: 794, // A4 width in pixels at 96 DPI
        height: 1123, // A4 height in pixels at 96 DPI
        windowWidth: 794,
        windowHeight: 1123,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0,
        imageTimeout: 5000, // Increased timeout for images
      },
      jsPDF: {
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
      },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    // Use html2pdf to generate and download PDF
    // @ts-ignore - html2pdf is loaded dynamically
    if (typeof html2pdf !== 'undefined') {
      try {
        console.log('Starting PDF generation...');
        console.log('Container dimensions:', container.offsetWidth, 'x', container.offsetHeight);
        console.log('Container computed style visibility:', window.getComputedStyle(container).visibility);
        console.log('Container rect:', container.getBoundingClientRect());

        // Temporarily make visible for rendering
        container.style.visibility = 'visible';
        container.style.position = 'absolute';
        container.style.top = '0';
        container.style.left = '0';
        container.style.width = '210mm';
        container.style.minHeight = '297mm';

        // Force layout recalculation
        container.offsetHeight;

        console.log('Made container visible for rendering');

        // @ts-ignore
        const pdfInstance = html2pdf().set(opt).from(container);
        console.log('PDF instance created, calling save...');

        try {
          await pdfInstance.save();
          console.log('PDF save() completed');
        } catch (saveError) {
          console.warn('html2pdf save failed, trying fallback approach:', saveError);

          // Fallback: Use html2canvas + jsPDF directly
          console.log('Attempting fallback PDF generation...');

          // Load jsPDF if not already loaded
          if (typeof window.jspdf === 'undefined') {
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
          }

          // @ts-ignore
          const { jsPDF } = window.jspdf;
          const pdf = new jsPDF('p', 'mm', 'a4');

          // @ts-ignore
          const canvas = await html2canvas(container, {
            scale: 2,
            useCORS: false,
            allowTaint: false,
            backgroundColor: '#ffffff',
            width: 794,
            height: 1123,
            logging: true,
          });

          console.log('Canvas generated, dimensions:', canvas.width, 'x', canvas.height);

          const imgData = canvas.toDataURL('image/jpeg', 0.95);
          const pdfWidth = pdf.internal.pageSize.getWidth();
          const pdfHeight = pdf.internal.pageSize.getHeight();
          const imgWidth = pdfWidth - 20; // 10mm margins on each side
          const imgHeight = (canvas.height * imgWidth) / canvas.width;

          pdf.addImage(imgData, 'JPEG', 10, 10, imgWidth, imgHeight);
          pdf.save(filename);

          console.log('Fallback PDF generation completed');
        }

        // Hide container again after PDF generation
        container.style.visibility = 'hidden';
        container.style.position = 'absolute';
        container.style.top = '-9999px';
        container.style.left = '-9999px';

        // Wait for PDF to fully generate before cleanup
        // html2pdf.js continues processing after save() resolves
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('PDF generation completed successfully');
      } catch (pdfError) {
        console.error('PDF generation failed:', pdfError);
        throw new Error(`PDF generation failed: ${pdfError instanceof Error ? pdfError.message : 'Unknown error'}`);
      } finally {
        // Remove loading overlay
        if (document.body.contains(loadingOverlay)) {
          document.body.removeChild(loadingOverlay);
        }
        // Now safe to remove container
        if (document.body.contains(container)) {
          document.body.removeChild(container);
          console.log('Container removed from DOM');
        }
      }
    } else {
      console.error('html2pdf is not available');
      // Clean up even if html2pdf is not available
      if (document.body.contains(container)) {
        document.body.removeChild(container);
      }
      throw new Error('PDF generation library failed to load. Please check your internet connection.');
    }
  } catch (error) {
    console.error('Error exporting to PDF:', error);
    // Re-throw with more user-friendly messages
    if (error instanceof Error) {
      if (error.message.includes('Failed to load script')) {
        throw new Error('Failed to load PDF generation library. Please check your internet connection.');
      }
      if (error.message.includes('html2pdf library failed to load')) {
        throw new Error('PDF generation library is not available. Please refresh the page and try again.');
      }
    }
    throw error;
  }
}

/**
 * Export TipTap editor content to PDF
 * @param editorContent - HTML content from TipTap editor
 * @param documentTitle - Title of the document
 * @param filename - Name of the PDF file
 */
export async function exportEditorToPDF(
  editorContent: string,
  documentTitle: string = 'Document',
  filename: string = 'document.pdf'
): Promise<void> {
  try {
    console.log('exportEditorToPDF called with content length:', editorContent.length);
    console.log('Content preview:', editorContent.substring(0, 500), '...');

    // Validate that editor content is not empty
    if (!editorContent || !editorContent.trim()) {
      throw new Error('Document content is empty. Please add content before exporting.');
    }

    // Clean up the content for better PDF rendering
    console.log('Sanitizing HTML content...');
    const cleanedContent = sanitizeHTMLForPDF(editorContent);
    console.log('Cleaned content length:', cleanedContent.length);
    console.log('Cleaned content preview:', cleanedContent.substring(0, 500), '...');

    // Validate that cleaned content is not empty
    if (!cleanedContent || !cleanedContent.trim()) {
      throw new Error('Document content appears to be empty after processing. Please add content before exporting.');
    }

    // Export to PDF
    await exportToPDF(cleanedContent, filename, documentTitle);
  } catch (error) {
    console.error('Error exporting editor content to PDF:', error);
    throw error;
  }
}

/**
 * Sanitize HTML content for PDF export
 * Removes unnecessary styles and attributes that might cause rendering issues
 */
function sanitizeHTMLForPDF(html: string): string {
  console.log('sanitizeHTMLForPDF input length:', html.length);
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  console.log('Parsed document body:', doc.body.innerHTML.substring(0, 500), '...');

  // Remove script tags
  const scripts = doc.querySelectorAll('script');
  scripts.forEach(script => script.remove());

  // Remove style tags (but keep inline styles)
  const styles = doc.querySelectorAll('style');
  styles.forEach(style => style.remove());

  // Clean up unnecessary attributes
  const allElements = doc.querySelectorAll('*');
  allElements.forEach(element => {
    // Keep only essential attributes
    const attributesToRemove = Array.from(element.attributes)
      .filter(attr => 
        !['class', 'style', 'id', 'href', 'src', 'alt', 'title'].includes(attr.name)
      )
      .map(attr => attr.name);

    attributesToRemove.forEach(attr => {
      element.removeAttribute(attr);
    });

    // Ensure images have proper styling for PDF - maintain inline behavior
    if (element.tagName === 'IMG') {
      element.setAttribute('style', 'max-width: 100%; height: auto; display: inline-block; margin: 5px 0; vertical-align: middle;');
    }

    // Ensure tables have proper styling
    if (element.tagName === 'TABLE') {
      element.setAttribute('style', 'width: 100%; border-collapse: collapse; margin: 10px 0;');
    }

    if (element.tagName === 'TD' || element.tagName === 'TH') {
      element.setAttribute('style', 'border: 1px solid #ddd; padding: 8px; text-align: left;');
    }

    // Ensure code blocks are properly formatted
    if (element.tagName === 'PRE') {
      element.setAttribute('style', 'background-color: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; margin: 10px 0;');
    }

    if (element.tagName === 'CODE') {
      element.setAttribute('style', 'font-family: "Courier New", monospace; font-size: 12px;');
    }
  });

  const finalHTML = doc.body.innerHTML;
  console.log('sanitizeHTMLForPDF output length:', finalHTML.length);
  console.log('Final HTML preview:', finalHTML.substring(0, 500), '...');

  return finalHTML;
}

/**
 * Convert TipTap JSON content to HTML
 * @param jsonContent - TipTap JSON content as string
 * @returns HTML string
 */
export async function convertJsonToHtml(jsonContent: string): Promise<string> {
  try {
    console.log('Starting JSON to HTML conversion, input length:', jsonContent.length);

    // Dynamically import TipTap to avoid bundle size issues
    const { Editor } = await import('@tiptap/core');
    const { getTiptapExtensions } = await import('@/lib/tiptapExtensions');

    // Parse JSON content
    let contentObj;
    try {
      contentObj = JSON.parse(jsonContent);
      console.log('Successfully parsed JSON content:', contentObj);
    } catch (parseError) {
      console.error('Failed to parse JSON content:', parseError);
      // If it's not valid JSON, return as-is (might already be HTML)
      return jsonContent;
    }

    // Create a temporary editor instance for HTML generation
    console.log('Creating temporary TipTap editor...');
    const editor = new Editor({
      extensions: getTiptapExtensions(),
      content: contentObj,
      editable: false,
    });

    console.log('Editor created, getting HTML...');
    const html = editor.getHTML();
    console.log('Generated HTML:', html.substring(0, 500), '...');
    console.log('HTML length:', html.length);

    editor.destroy();

    return html;
  } catch (error) {
    console.error('Failed to convert JSON to HTML:', error);
    // Fallback: return original content if conversion fails
    return jsonContent;
  }
}

/**
 * Generate a filename with timestamp
 * @param baseFilename - Base filename without extension
 * @returns Filename with timestamp
 */
export function generateFilenameWithTimestamp(baseFilename: string = 'document'): string {
  const now = new Date();
  const timestamp = now.toISOString().split('T')[0]; // YYYY-MM-DD format
  return `${baseFilename}-${timestamp}.pdf`;
}
