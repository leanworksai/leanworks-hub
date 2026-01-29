/**
 * File Validation Middleware
 * 
 * Validates uploaded files for:
 * - File size limits
 * - MIME type
 * - Magic bytes (file signature)
 * - File extension
 * - Rate limiting
 */

import { Request, Response, NextFunction } from 'express';
import { Buffer } from 'buffer';
import {
  InvalidFileTypeError,
  FileTooLargeError,
  InvalidMimeTypeError,
  InvalidFileExtensionError,
  RateLimitExceededError,
  FileCorruptedError,
} from '../utils/document-errors';

/**
 * Supported file types with their MIME types, extensions, and magic bytes
 */
const SUPPORTED_FILE_TYPES = {
  pdf: {
    mimeTypes: ['application/pdf'],
    extensions: ['.pdf'],
    magicBytes: [
      Buffer.from([0x25, 0x50, 0x44, 0x46]), // %PDF
    ],
  },
  docx: {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ],
    extensions: ['.docx', '.doc'],
    magicBytes: [
      Buffer.from([0x50, 0x4B, 0x03, 0x04]), // PK.. (ZIP archive)
    ],
  },
  pptx: {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
    ],
    extensions: ['.pptx', '.ppt'],
    magicBytes: [
      Buffer.from([0x50, 0x4B, 0x03, 0x04]), // PK.. (ZIP archive)
    ],
  },
  xlsx: {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ],
    extensions: ['.xlsx', '.xls'],
    magicBytes: [
      Buffer.from([0x50, 0x4B, 0x03, 0x04]), // PK.. (ZIP archive)
    ],
  },
};

/**
 * Configuration
 */
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '52428800'); // 50MB default
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_UPLOADS = 10; // Max 10 uploads per minute per user

/**
 * Rate limiting store (in-memory, for production use Redis)
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Validate file size
 */
export function validateFileSize(file: Express.Multer.File): void {
  if (file.size > MAX_FILE_SIZE) {
    throw new FileTooLargeError(
      file.originalname,
      file.size,
      MAX_FILE_SIZE
    );
  }
}

/**
 * Validate MIME type
 */
export function validateMimeType(file: Express.Multer.File): void {
  const allowedMimeTypes = Object.values(SUPPORTED_FILE_TYPES)
    .flatMap(type => type.mimeTypes);

  if (!allowedMimeTypes.includes(file.mimetype)) {
    throw new InvalidMimeTypeError(
      file.originalname,
      file.mimetype,
      allowedMimeTypes
    );
  }
}

/**
 * Validate file extension
 */
export function validateFileExtension(file: Express.Multer.File): void {
  const fileName = file.originalname.toLowerCase();
  const allowedExtensions = Object.values(SUPPORTED_FILE_TYPES)
    .flatMap(type => type.extensions);

  const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));

  if (!hasValidExtension) {
    const actualExtension = fileName.substring(fileName.lastIndexOf('.'));
    throw new InvalidFileExtensionError(
      file.originalname,
      actualExtension,
      allowedExtensions
    );
  }
}

/**
 * Validate magic bytes (file signature)
 */
export function validateMagicBytes(file: Express.Multer.File): void {
  if (!file.buffer) {
    throw new FileCorruptedError(
      file.originalname,
      'File buffer is empty'
    );
  }

  const fileBuffer = file.buffer;
  const allMagicBytes = Object.values(SUPPORTED_FILE_TYPES)
    .flatMap(type => type.magicBytes);

  const hasValidMagicBytes = allMagicBytes.some(magicBytes => {
    if (fileBuffer.length < magicBytes.length) {
      return false;
    }
    return fileBuffer.subarray(0, magicBytes.length).equals(magicBytes);
  });

  if (!hasValidMagicBytes) {
    throw new FileCorruptedError(
      file.originalname,
      'File signature does not match expected format'
    );
  }
}

/**
 * Check rate limit for user
 */
export function checkRateLimit(userId: string): void {
  const now = Date.now();
  const userLimit = rateLimitStore.get(userId);

  if (!userLimit || now > userLimit.resetAt) {
    // Reset or create new limit
    rateLimitStore.set(userId, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW,
    });
    return;
  }

  if (userLimit.count >= RATE_LIMIT_MAX_UPLOADS) {
    throw new RateLimitExceededError(
      userId,
      RATE_LIMIT_MAX_UPLOADS,
      '1 minute'
    );
  }

  // Increment count
  userLimit.count++;
}

/**
 * Clean up expired rate limit entries (call periodically)
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [userId, limit] of rateLimitStore.entries()) {
    if (now > limit.resetAt) {
      rateLimitStore.delete(userId);
    }
  }
}

// Clean up every 5 minutes
setInterval(cleanupRateLimitStore, 5 * 60 * 1000);

/**
 * Express middleware for file validation
 */
export function validateUploadedFile(
  req: Request,
  res: Response,
  next: NextFunction
): Response | void {
  try {
    // Check if file exists
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        code: 'NO_FILE',
      });
    }

    const file = req.file;

    // Get user ID from request (assumes auth middleware has set req.user)
    const userId = (req as any).user?.email || (req as any).user?.id || 'anonymous';

    // Validate rate limit
    checkRateLimit(userId);

    // Validate file size
    validateFileSize(file);

    // Validate MIME type
    validateMimeType(file);

    // Validate file extension
    validateFileExtension(file);

    // Validate magic bytes
    validateMagicBytes(file);

    // All validations passed
    next();
  } catch (error: any) {
    // Handle validation errors
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        context: error.context,
      });
    }

    // Unknown error
    console.error('File validation error:', error);
    return res.status(500).json({
      error: 'File validation failed',
      code: 'VALIDATION_ERROR',
    });
  }
}

/**
 * Get supported file types info
 */
export function getSupportedFileTypes() {
  return {
    types: Object.keys(SUPPORTED_FILE_TYPES),
    mimeTypes: Object.values(SUPPORTED_FILE_TYPES).flatMap(type => type.mimeTypes),
    extensions: Object.values(SUPPORTED_FILE_TYPES).flatMap(type => type.extensions),
    maxFileSize: MAX_FILE_SIZE,
    maxFileSizeMB: (MAX_FILE_SIZE / 1024 / 1024).toFixed(2),
  };
}
