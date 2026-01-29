/**
 * Custom Error Classes for Document Processing
 * 
 * Provides specific error types for different document processing scenarios
 * with detailed error messages and context for debugging.
 */

export enum DocumentErrorCode {
  // File validation errors
  INVALID_FILE_TYPE = 'INVALID_FILE_TYPE',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  FILE_CORRUPTED = 'FILE_CORRUPTED',
  INVALID_MIME_TYPE = 'INVALID_MIME_TYPE',
  INVALID_FILE_EXTENSION = 'INVALID_FILE_EXTENSION',
  
  // Processing errors
  PROCESSING_FAILED = 'PROCESSING_FAILED',
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  THUMBNAIL_GENERATION_FAILED = 'THUMBNAIL_GENERATION_FAILED',
  UNSUPPORTED_VERSION = 'UNSUPPORTED_VERSION',
  
  // Storage errors
  STORAGE_UPLOAD_FAILED = 'STORAGE_UPLOAD_FAILED',
  STORAGE_DOWNLOAD_FAILED = 'STORAGE_DOWNLOAD_FAILED',
  STORAGE_DELETE_FAILED = 'STORAGE_DELETE_FAILED',
  
  // Database errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  RECORD_NOT_FOUND = 'RECORD_NOT_FOUND',
  DUPLICATE_RECORD = 'DUPLICATE_RECORD',
  
  // Job queue errors
  JOB_QUEUE_ERROR = 'JOB_QUEUE_ERROR',
  JOB_TIMEOUT = 'JOB_TIMEOUT',
  MAX_RETRIES_EXCEEDED = 'MAX_RETRIES_EXCEEDED',
  
  // Security errors
  VIRUS_DETECTED = 'VIRUS_DETECTED',
  MALICIOUS_FILE = 'MALICIOUS_FILE',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
}

export interface ErrorContext {
  docId?: string;
  docType?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  userId?: string;
  orgSlug?: string;
  correlationId?: string;
  [key: string]: any;
}

/**
 * Base Document Processing Error
 */
export class DocumentProcessingError extends Error {
  public readonly code: DocumentErrorCode;
  public readonly context: ErrorContext;
  public readonly timestamp: Date;
  public readonly statusCode: number;

  constructor(
    code: DocumentErrorCode,
    message: string,
    context: ErrorContext = {},
    statusCode: number = 500
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    this.timestamp = new Date();
    this.statusCode = statusCode;
    
    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      statusCode: this.statusCode,
    };
  }
}

/**
 * File Validation Errors
 */
export class InvalidFileTypeError extends DocumentProcessingError {
  constructor(
    fileName: string,
    allowedTypes: string[],
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.INVALID_FILE_TYPE,
      `Invalid file type: ${fileName}. Allowed types: ${allowedTypes.join(', ')}`,
      { ...context, fileName },
      400
    );
  }
}

export class FileTooLargeError extends DocumentProcessingError {
  constructor(
    fileName: string,
    fileSize: number,
    maxSize: number,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.FILE_TOO_LARGE,
      `File too large: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)}MB). Maximum size: ${(maxSize / 1024 / 1024).toFixed(2)}MB`,
      { ...context, fileName, fileSize },
      413
    );
  }
}

export class FileCorruptedError extends DocumentProcessingError {
  constructor(
    fileName: string,
    reason: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.FILE_CORRUPTED,
      `File corrupted: ${fileName}. Reason: ${reason}`,
      { ...context, fileName },
      400
    );
  }
}

export class InvalidMimeTypeError extends DocumentProcessingError {
  constructor(
    fileName: string,
    actualMimeType: string,
    expectedMimeTypes: string[],
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.INVALID_MIME_TYPE,
      `Invalid MIME type: ${fileName}. Expected: ${expectedMimeTypes.join(', ')}, Got: ${actualMimeType}`,
      { ...context, fileName, mimeType: actualMimeType },
      400
    );
  }
}

export class InvalidFileExtensionError extends DocumentProcessingError {
  constructor(
    fileName: string,
    actualExtension: string,
    expectedExtensions: string[],
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.INVALID_FILE_EXTENSION,
      `Invalid file extension: ${fileName}. Expected: ${expectedExtensions.join(', ')}, Got: ${actualExtension}`,
      { ...context, fileName },
      400
    );
  }
}

/**
 * Processing Errors
 */
export class ProcessingFailedError extends DocumentProcessingError {
  constructor(
    docId: string,
    docType: string,
    reason: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.PROCESSING_FAILED,
      `Processing failed for document ${docId} (${docType}): ${reason}`,
      { ...context, docId, docType },
      500
    );
  }
}

export class ExtractionFailedError extends DocumentProcessingError {
  constructor(
    docId: string,
    docType: string,
    reason: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.EXTRACTION_FAILED,
      `Content extraction failed for document ${docId} (${docType}): ${reason}`,
      { ...context, docId, docType },
      500
    );
  }
}

export class ThumbnailGenerationFailedError extends DocumentProcessingError {
  constructor(
    docId: string,
    docType: string,
    reason: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.THUMBNAIL_GENERATION_FAILED,
      `Thumbnail generation failed for document ${docId} (${docType}): ${reason}`,
      { ...context, docId, docType },
      500
    );
  }
}

export class UnsupportedVersionError extends DocumentProcessingError {
  constructor(
    fileName: string,
    docType: string,
    version: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.UNSUPPORTED_VERSION,
      `Unsupported version: ${fileName} (${docType} version ${version})`,
      { ...context, fileName, docType },
      400
    );
  }
}

/**
 * Storage Errors
 */
export class StorageUploadFailedError extends DocumentProcessingError {
  constructor(
    fileName: string,
    reason: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.STORAGE_UPLOAD_FAILED,
      `Storage upload failed for ${fileName}: ${reason}`,
      { ...context, fileName },
      500
    );
  }
}

export class StorageDownloadFailedError extends DocumentProcessingError {
  constructor(
    storagePath: string,
    reason: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.STORAGE_DOWNLOAD_FAILED,
      `Storage download failed for ${storagePath}: ${reason}`,
      { ...context },
      500
    );
  }
}

export class StorageDeleteFailedError extends DocumentProcessingError {
  constructor(
    storagePath: string,
    reason: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.STORAGE_DELETE_FAILED,
      `Storage delete failed for ${storagePath}: ${reason}`,
      { ...context },
      500
    );
  }
}

/**
 * Database Errors
 */
export class DatabaseError extends DocumentProcessingError {
  constructor(
    operation: string,
    reason: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.DATABASE_ERROR,
      `Database error during ${operation}: ${reason}`,
      { ...context },
      500
    );
  }
}

export class RecordNotFoundError extends DocumentProcessingError {
  constructor(
    recordType: string,
    recordId: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.RECORD_NOT_FOUND,
      `${recordType} not found: ${recordId}`,
      { ...context },
      404
    );
  }
}

export class DuplicateRecordError extends DocumentProcessingError {
  constructor(
    recordType: string,
    recordId: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.DUPLICATE_RECORD,
      `Duplicate ${recordType}: ${recordId}`,
      { ...context },
      409
    );
  }
}

/**
 * Job Queue Errors
 */
export class JobQueueError extends DocumentProcessingError {
  constructor(
    operation: string,
    reason: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.JOB_QUEUE_ERROR,
      `Job queue error during ${operation}: ${reason}`,
      { ...context },
      500
    );
  }
}

export class JobTimeoutError extends DocumentProcessingError {
  constructor(
    jobId: string,
    timeout: number,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.JOB_TIMEOUT,
      `Job ${jobId} timed out after ${timeout}ms`,
      { ...context },
      504
    );
  }
}

export class MaxRetriesExceededError extends DocumentProcessingError {
  constructor(
    jobId: string,
    retryCount: number,
    maxRetries: number,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.MAX_RETRIES_EXCEEDED,
      `Job ${jobId} exceeded maximum retries (${retryCount}/${maxRetries})`,
      { ...context },
      500
    );
  }
}

/**
 * Security Errors
 */
export class VirusDetectedError extends DocumentProcessingError {
  constructor(
    fileName: string,
    virusName: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.VIRUS_DETECTED,
      `Virus detected in ${fileName}: ${virusName}`,
      { ...context, fileName },
      403
    );
  }
}

export class MaliciousFileError extends DocumentProcessingError {
  constructor(
    fileName: string,
    reason: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.MALICIOUS_FILE,
      `Malicious file detected: ${fileName}. Reason: ${reason}`,
      { ...context, fileName },
      403
    );
  }
}

export class RateLimitExceededError extends DocumentProcessingError {
  constructor(
    userId: string,
    limit: number,
    window: string,
    context: ErrorContext = {}
  ) {
    super(
      DocumentErrorCode.RATE_LIMIT_EXCEEDED,
      `Rate limit exceeded for user ${userId}. Maximum ${limit} uploads per ${window}`,
      { ...context, userId },
      429
    );
  }
}

/**
 * Utility function to check if an error is a DocumentProcessingError
 */
export function isDocumentProcessingError(error: any): error is DocumentProcessingError {
  return error instanceof DocumentProcessingError;
}

/**
 * Utility function to get a user-friendly error message
 */
export function getUserFriendlyMessage(error: DocumentProcessingError): string {
  switch (error.code) {
    case DocumentErrorCode.INVALID_FILE_TYPE:
    case DocumentErrorCode.INVALID_MIME_TYPE:
    case DocumentErrorCode.INVALID_FILE_EXTENSION:
      return 'This file type is not supported. Please upload a PDF, Word, PowerPoint, or Excel file.';
    
    case DocumentErrorCode.FILE_TOO_LARGE:
      return 'This file is too large. Please upload a file smaller than 50MB.';
    
    case DocumentErrorCode.FILE_CORRUPTED:
      return 'This file appears to be corrupted. Please try uploading a different file.';
    
    case DocumentErrorCode.VIRUS_DETECTED:
      return 'This file contains a virus and cannot be uploaded.';
    
    case DocumentErrorCode.MALICIOUS_FILE:
      return 'This file appears to be malicious and cannot be uploaded.';
    
    case DocumentErrorCode.RATE_LIMIT_EXCEEDED:
      return 'You have exceeded the upload rate limit. Please try again later.';
    
    case DocumentErrorCode.UNSUPPORTED_VERSION:
      return 'This file version is not supported. Please save the file in a compatible format and try again.';
    
    default:
      return 'An error occurred while processing your file. Please try again.';
  }
}
