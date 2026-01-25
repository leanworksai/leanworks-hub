import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color } from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
import Paragraph from '@tiptap/extension-paragraph';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Image } from '@tiptap/extension-image';
import { common, createLowlight } from 'lowlight';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';

/**
 * Get TipTap extensions for client-side rendering
 * Note: Server-side HTML conversion is no longer done here
 * HTML conversion happens on the client side
 */
function getServerTiptapExtensions() {
  // This function is kept for reference but is no longer used on the server
  // TipTap Editor requires a browser environment with DOM
  const lowlight = createLowlight(common);

  return [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3],
      },
      paragraph: false,
      gapcursor: false,
      codeBlock: false,
    }),
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: 'plaintext',
      HTMLAttributes: {
        class: 'hljs',
      },
    }),
    Paragraph.extend({
      parseHTML() {
        return [{ tag: 'p' }];
      },
      renderHTML({ HTMLAttributes }) {
        return [
          'p',
          {
            ...HTMLAttributes,
            style: 'white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; hyphens: none; max-width: 100%; width: 100%; box-sizing: border-box;',
          },
          0,
        ];
      },
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        rel: 'noopener noreferrer',
        target: '_blank',
      },
    }),
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
    Color,
    TextStyle,
    Image.configure({
      HTMLAttributes: {
        class: 'editor-image',
      },
    }),
    Table.configure({
      resizable: false,
    }),
    TableRow,
    TableHeader,
    TableCell,
  ];
}

/**
 * Convert TipTap JSON content to HTML with position mapping
 * @param jsonContent - TipTap JSON content as string or object
 * @param proseMirrorFrom - Optional ProseMirror start position to map
 * @param proseMirrorTo - Optional ProseMirror end position to map
 * @returns Object with HTML string and position mappings
 */
export async function convertJsonToHtmlWithPositions(
  jsonContent: string | object,
  proseMirrorFrom?: number,
  proseMirrorTo?: number
): Promise<{ html: string; htmlFrom?: number; htmlTo?: number }> {
  try {
    console.log('🔄 [Server] Converting content to HTML format');

    // If content is already HTML (starts with <), return as-is
    if (typeof jsonContent === 'string' && jsonContent.trim().startsWith('<')) {
      console.log('✅ [Server] Content is already HTML, returning as-is');
      return {
        html: jsonContent,
        htmlFrom: proseMirrorFrom,
        htmlTo: proseMirrorTo
      };
    }

    // Parse JSON content if it's a string
    let contentObj;
    if (typeof jsonContent === 'string') {
      try {
        contentObj = JSON.parse(jsonContent);
        console.log('✅ [Server] Successfully parsed JSON content');
      } catch (parseError) {
        // If it's not valid JSON and not HTML, return as-is
        console.log('ℹ️ [Server] Content is not JSON, returning as-is');
        return {
          html: jsonContent,
          htmlFrom: proseMirrorFrom,
          htmlTo: proseMirrorTo
        };
      }
    } else {
      contentObj = jsonContent;
    }

    // Return JSON as-is (HTML conversion is done on the client side for better UX)
    const html = typeof contentObj === 'string' ? contentObj : JSON.stringify(contentObj);
    console.log('✅ [Server] Content returned (JSON format)');

    return {
      html,
      htmlFrom: proseMirrorFrom,
      htmlTo: proseMirrorTo
    };
  } catch (error) {
    console.error('❌ [Server] Failed to convert content:', error);
    // Fallback: return original content if conversion fails
    const fallbackContent = typeof jsonContent === 'string' ? jsonContent : JSON.stringify(jsonContent);
    return {
      html: fallbackContent,
      htmlFrom: proseMirrorFrom,
      htmlTo: proseMirrorTo
    };
  }
}

/**
 * Convert TipTap JSON content to HTML
 * @param jsonContent - TipTap JSON content as string or object
 * @returns HTML string
 */
export async function convertJsonToHtml(jsonContent: string | object): Promise<string> {
  const result = await convertJsonToHtmlWithPositions(jsonContent);
  return result.html;
}