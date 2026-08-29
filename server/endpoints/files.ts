/**
 * File Upload Endpoints
 * Handles file uploads to Google Cloud Storage
 * Files are stored at: orgs/{orgSlug}/doc-files/{docId}/{fileId}
 * Supports any file type up to 10MB
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { getOrgSlugById } from '../../database/multi-tenant-pool.js';
import { generateSignedUrl as generateSignedUrlUtil, extractStoragePath as extractStoragePathUtil } from '../utils/storage.js';

// File URL expiration time (default: 1 year)
const FILE_URL_EXPIRATION_DAYS = parseInt(process.env.FILE_URL_EXPIRATION_DAYS || '365', 10);

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

export function setupFileEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  storage: any // Firebase Admin Storage instance (GCS)
) {
  console.log('✅ File upload endpoints registered at /api/files/upload');
  
  // Health check for file endpoint
  app.get('/api/files/health', (req, res) => {
    res.json({ status: 'ok', endpoint: '/api/files/upload' });
  });
  
  // POST /api/files/upload - Upload file to GCS
  app.post(
    '/api/files/upload',
    authenticateUser,
    (req, res, next) => {
      console.log('📎 File upload endpoint hit');
      // Multer error handler
      upload.single('file')(req, res, (err: any) => {
        if (err) {
          console.error('Multer error:', err);
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size exceeds 10MB limit' });
          }
          return res.status(400).json({ error: err.message || 'File upload error' });
        }
        next();
      });
    },
    async (req, res) => {
      try {
        console.log('📎 Processing file upload...');
        const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
        const userEmail = (req as any).user.email?.toLowerCase();
        const { docId } = req.body;
        
        console.log('📎 Upload params:', { orgId, userEmail, docId, hasFile: !!req.file });

        if (!docId) {
          return res.status(400).json({ error: 'docId is required' });
        }

        if (!req.file) {
          return res.status(400).json({ error: 'No file provided' });
        }

        // Validate file size (already done by multer, but double-check)
        if (req.file.size > 10 * 1024 * 1024) {
          return res.status(400).json({ error: 'File size exceeds 10MB limit' });
        }

        // Generate unique file ID
        const fileId = `${uuidv4()}_${req.file.originalname}`;
        
        // Construct storage path: orgs/{orgSlug}/doc-files/{docId}/{fileId}
        let orgSlugForPath: string;
        const orgSlugFromHeader = req.headers['x-org-slug'] as string;
        
        if (orgSlugFromHeader) {
          orgSlugForPath = orgSlugFromHeader;
          console.log(`📎 Using org slug from header: ${orgSlugForPath}`);
        } else if (orgId) {
          try {
            orgSlugForPath = await getOrgSlugById(orgId);
            console.log(`📎 Converted orgId ${orgId} to slug: ${orgSlugForPath}`);
          } catch (error) {
            console.error(`❌ Failed to get org slug for ${orgId}, using default:`, error);
            orgSlugForPath = 'default';
          }
        } else {
          console.warn('⚠️ No org slug or orgId provided, using default');
          orgSlugForPath = 'default';
        }
        const storagePath = `orgs/${orgSlugForPath}/doc-files/${docId}/${fileId}`;

        // Use fixed bucket name
        const bucketName = 'leanworks-prod';
        
        console.log('📎 Using storage bucket:', bucketName);
        let bucket = storage.bucket(bucketName);
        
        // Check if bucket exists, create if it doesn't
        try {
          const [exists] = await bucket.exists();
          if (!exists) {
            console.log(`📦 Creating storage bucket: ${bucketName}`);
            await bucket.create({
              location: 'US',
              storageClass: 'STANDARD',
            });
            console.log(`✅ Storage bucket created: ${bucketName}`);
          } else {
            console.log(`✅ Storage bucket exists: ${bucketName}`);
          }
        } catch (error: any) {
          if (error.code === 409) {
            console.log(`✅ Storage bucket already exists (race condition): ${bucketName}`);
          } else if (error.code === 403) {
            console.error('❌ Permission denied: Cannot create storage bucket.');
            return res.status(500).json({ 
              error: 'Storage bucket does not exist and cannot be created. Please contact administrator.' 
            });
          } else {
            console.error('❌ Error checking/creating bucket:', error);
          }
        }
        
        // Create file reference
        const file = bucket.file(storagePath);

        console.log(`📤 Starting upload to GCS: ${storagePath} (${(req.file.size / 1024 / 1024).toFixed(2)}MB)`);
        const uploadStartTime = Date.now();

        // Upload file to GCS with timeout (private, not public)
        await Promise.race([
          file.save(req.file.buffer, {
            metadata: {
              contentType: req.file.mimetype || 'application/octet-stream',
              metadata: {
                uploadedBy: userEmail,
                docId: docId,
                uploadedAt: new Date().toISOString(),
                originalName: req.file.originalname,
                fileSize: req.file.size.toString(),
              },
            },
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Upload timeout: GCS upload took too long')), 90000)
          )
        ]);

        const uploadDuration = Date.now() - uploadStartTime;
        console.log(`✅ Upload completed in ${uploadDuration}ms`);

        // Generate signed URL with configurable expiration (default: 1 year)
        const expiresIn = FILE_URL_EXPIRATION_DAYS * 24 * 60 * 60 * 1000;
        const expiresAt = new Date(Date.now() + expiresIn);
        
        console.log(`🔐 Generating signed URL (expires in ${FILE_URL_EXPIRATION_DAYS} days)...`);
        const [signedUrl] = await file.getSignedUrl({
          action: 'read',
          expires: expiresAt,
        });

        console.log(`✅ Signed URL generated, expires at: ${expiresAt.toISOString()}`);

        res.json({
          success: true,
          fileUrl: signedUrl,
          fileId: fileId,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype || 'application/octet-stream',
        });
      } catch (error: any) {
        console.error('File upload error:', error);
        console.error('Error details:', {
          message: error.message,
          code: error.code,
          stack: error.stack?.substring(0, 500),
        });
        
        // Handle specific error types
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size exceeds 10MB limit' });
        }
        if (error.message?.includes('timeout') || error.message?.includes('Timeout')) {
          return res.status(504).json({ error: 'Upload timeout: The file upload took too long. Please try again with a smaller file.' });
        }
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
          return res.status(504).json({ error: 'Network timeout: Connection to storage service timed out. Please try again.' });
        }
        
        res.status(500).json({ 
          error: error.message || 'Failed to upload file',
          code: error.code || 'UNKNOWN_ERROR'
        });
      }
    }
  );


  // POST /api/files/refresh - Refresh signed URLs for files
  app.post(
    '/api/files/refresh',
    authenticateUser,
    async (req, res) => {
      try {
        const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
        const orgSlug = req.headers['x-org-slug'] as string;
        const { fileUrls, docId } = req.body;
        
        if (!fileUrls || !Array.isArray(fileUrls)) {
          return res.status(400).json({ error: 'fileUrls array is required' });
        }
        
        if (!docId) {
          return res.status(400).json({ error: 'docId is required' });
        }

        // Process all URLs in parallel
        const refreshPromises = fileUrls.map(async (fileUrl: string) => {
          try {
            // Extract storage path from signed URL
            const storagePath = await extractStoragePathUtil(storage, fileUrl, orgId, 'doc-files', docId, orgSlug);
            if (storagePath) {
              const newSignedUrl = await generateSignedUrlUtil(storage, storagePath, FILE_URL_EXPIRATION_DAYS);
              return newSignedUrl;
            } else {
              return fileUrl;
            }
          } catch (error: any) {
            console.error(`Failed to refresh URL for ${fileUrl}:`, error);
            return fileUrl;
          }
        });
        
        const refreshedUrls = await Promise.all(refreshPromises);
        
        res.json({
          success: true,
          fileUrls: refreshedUrls,
        });
      } catch (error: any) {
        console.error('File refresh error:', error);
        res.status(500).json({ 
          error: error.message || 'Failed to refresh file URLs',
          code: error.code || 'UNKNOWN_ERROR'
        });
      }
    }
  );

}

