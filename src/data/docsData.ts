export interface DocFile {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
}

export interface Doc {
  id: string;
  title: string;
  content: string; // TipTap JSON document format (stringified JSON)
  ownerEmail: string;
  projectId?: string | null;
  teamId?: string | null;
  visibility?: 'all_members' | 'specific_members';
  visibleToMembers?: string[]; // Array of member emails who can view this doc
  metadata?: {
    files?: DocFile[];
    [key: string]: any;
  };
  createdAt: string;
  updatedAt: string;

  // Document upload fields
  docType?: 'rich_text' | 'pdf' | 'docx' | 'pptx' | 'xlsx';
  storagePath?: string;
  fileMetadata?: {
    pageCount?: number;
    wordCount?: number;
    slideCount?: number;
    sheetCount?: number;
    originalName?: string;
    uploadedBy?: string;
    pdfStoragePath?: string; // Path to PDF file for PPTX documents
    conversionSuccessful?: boolean; // Whether PPTX to PDF conversion was successful
    thumbnails?: string[]; // Array of thumbnail URLs
    htmlContent?: string; // HTML representation for certain document types
    previewData?: any; // Type-specific preview data
    [key: string]: any;
  };
  processingStatus?: 'uploading' | 'processing' | 'ready' | 'error';
  fileSize?: number;
  mimeType?: string;
}

