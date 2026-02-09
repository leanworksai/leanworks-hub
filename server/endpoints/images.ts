/**
 * Image Upload Endpoints
 * Handles image uploads to Firebase Storage via Admin SDK
 * Images are stored at: orgs/{orgSlug}/chat-images/{chatId}/{imageId}.jpg
 * All images are converted to JPG format for consistent storage
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { getOrgSlugById } from '../../database/multi-tenant-pool.js';
import { generateSignedUrl as generateSignedUrlUtil, extractStoragePath as extractStoragePathUtil } from '../utils/storage.js';
import { getStorageBucket } from '../utils/env.js';

// Image URL expiration time (default: 1 year)
// Can be configured via environment variable IMAGE_URL_EXPIRATION_DAYS
const IMAGE_URL_EXPIRATION_DAYS = parseInt(process.env.IMAGE_URL_EXPIRATION_DAYS || '365', 10);

// Configure multer for memory storage (we'll upload directly to Firebase Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    // Allow common image formats - they will be converted to JPG
    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif',
    ];
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    
    const fileName = file.originalname.toLowerCase();
    const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));
    
    if (allowedMimeTypes.includes(file.mimetype) || hasValidExtension) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (JPG, PNG, WebP, GIF)'));
    }
  },
});

export function setupImageEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  storage: any, // Firebase Admin Storage instance
  firebaseApp?: any // Firebase App instance (optional, for getting bucket name)
) {
  console.log('✅ Image upload endpoints registered at /api/images/upload');
  
  // Health check for image endpoint
  app.get('/api/images/health', (req, res) => {
    res.json({ status: 'ok', endpoint: '/api/images/upload' });
  });
  
  // POST /api/images/upload - Upload image to Firebase Storage
  app.post(
    '/api/images/upload',
    authenticateUser,
    (req, res, next) => {
      console.log('📸 Image upload endpoint hit');
      // Multer error handler
      upload.single('image')(req, res, (err: any) => {
        if (err) {
          console.error('Multer error:', err);
          if (err.message?.includes('Only image files are allowed') || err.message?.includes('Only JPG images are allowed')) {
            return res.status(400).json({ error: err.message });
          }
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Image size exceeds 10MB limit' });
          }
          return res.status(400).json({ error: err.message || 'File upload error' });
        }
        next();
      });
    },
    async (req, res) => {
      try {
        console.log('📸 Processing image upload...');
        const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
        const userEmail = (req as any).user.email?.toLowerCase();
        const { chatId } = req.body;
        
        console.log('📸 Upload params:', { orgId, userEmail, chatId, hasFile: !!req.file });

        if (!chatId) {
          return res.status(400).json({ error: 'chatId is required' });
        }

        if (!req.file) {
          return res.status(400).json({ error: 'No image file provided' });
        }

        // Validate file size (already done by multer, but double-check)
        if (req.file.size > 10 * 1024 * 1024) {
          return res.status(400).json({ error: 'Image size exceeds 10MB limit' });
        }

        // Validate file type - allow common image formats
        const allowedMimeTypes = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/webp',
          'image/gif',
        ];
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const fileName = req.file.originalname.toLowerCase();
        const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));
        
        if (!allowedMimeTypes.includes(req.file.mimetype) && !hasValidExtension) {
          return res.status(400).json({ error: 'Only image files are allowed (JPG, PNG, WebP, GIF)' });
        }

        console.log(`📸 Converting image from ${req.file.mimetype} to JPG...`);
        const conversionStartTime = Date.now();
        
        // Convert image to JPG using sharp
        // For GIFs, extract first frame; for PNG/WebP with transparency, use white background
        let convertedBuffer: Buffer;
        try {
          const sharpInstance = sharp(req.file.buffer);
          const metadata = await sharpInstance.metadata();
          
          // Handle animated GIFs - extract first frame
          if (req.file.mimetype === 'image/gif' && metadata.pages && metadata.pages > 1) {
            console.log('📸 Detected animated GIF, extracting first frame');
            convertedBuffer = await sharpInstance
              .gif({ page: 0 }) // Extract first frame
              .jpeg({ quality: 85, mozjpeg: true })
              .toBuffer();
          } else {
            // Convert to JPG with quality optimization
            // For images with transparency (PNG, WebP), use white background
            convertedBuffer = await sharpInstance
              .jpeg({ 
                quality: 85, 
                mozjpeg: true,
                ...(metadata.hasAlpha ? { background: { r: 255, g: 255, b: 255 } } : {})
              })
              .toBuffer();
          }
          
          const conversionDuration = Date.now() - conversionStartTime;
          const originalSize = (req.file.size / 1024 / 1024).toFixed(2);
          const convertedSize = (convertedBuffer.length / 1024 / 1024).toFixed(2);
          console.log(`✅ Image converted in ${conversionDuration}ms (${originalSize}MB → ${convertedSize}MB)`);
        } catch (conversionError: any) {
          console.error('❌ Image conversion error:', conversionError);
          return res.status(400).json({ 
            error: 'Failed to process image. Please ensure the file is a valid image format.' 
          });
        }

        // Generate unique image ID
        const imageId = `${uuidv4()}.jpg`;
        
        // Construct storage path: orgs/{orgSlug}/chat-images/{chatId}/{imageId}
        // Use org slug directly from header if available, otherwise convert from orgId
        let orgSlugForPath: string;
        const orgSlugFromHeader = req.headers['x-org-slug'] as string;
        
        if (orgSlugFromHeader) {
          // Use org slug directly from header (preferred)
          orgSlugForPath = orgSlugFromHeader;
          console.log(`📸 Using org slug from header: ${orgSlugForPath}`);
        } else if (orgId) {
          // Fall back to converting orgId to slug
          try {
            orgSlugForPath = await getOrgSlugById(orgId);
            console.log(`📸 Converted orgId ${orgId} to slug: ${orgSlugForPath}`);
          } catch (error) {
            console.error(`❌ Failed to get org slug for ${orgId}, using default:`, error);
            orgSlugForPath = 'default';
          }
        } else {
          console.warn('⚠️ No org slug or orgId provided, using default');
          orgSlugForPath = 'default';
        }
        const storagePath = `orgs/${orgSlugForPath}/chat-images/${chatId}/${imageId}`;

        // Use bucket name based on environment
        const bucketName = getStorageBucket();
        
        console.log('📸 Using storage bucket:', bucketName);
        let bucket = storage.bucket(bucketName);
        
        // Check if bucket exists, create if it doesn't
        try {
          const [exists] = await bucket.exists();
          if (!exists) {
            console.log(`📦 Creating storage bucket: ${bucketName}`);
            await bucket.create({
              location: 'US', // Default location, can be configured
              storageClass: 'STANDARD',
            });
            console.log(`✅ Storage bucket created: ${bucketName}`);
          } else {
            console.log(`✅ Storage bucket exists: ${bucketName}`);
          }
        } catch (error: any) {
          // If bucket creation fails, try to use it anyway (might already exist from another request)
          if (error.code === 409) {
            // Bucket already exists (race condition)
            console.log(`✅ Storage bucket already exists (race condition): ${bucketName}`);
          } else if (error.code === 403) {
            // Permission denied - user doesn't have permission to create buckets
            console.error('❌ Permission denied: Cannot create storage bucket. Please create it manually or grant permissions.');
            return res.status(500).json({ 
              error: 'Storage bucket does not exist and cannot be created. Please contact administrator.' 
            });
          } else {
            console.error('❌ Error checking/creating bucket:', error);
            // Try to continue anyway - bucket might exist, but log the error
          }
        }
        
        // Create file reference
        const file = bucket.file(storagePath);

        console.log(`📤 Starting upload to Firebase Storage: ${storagePath} (${(convertedBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
        const uploadStartTime = Date.now();

        // Upload converted JPG file to Firebase Storage with timeout (private, not public)
        await Promise.race([
          file.save(convertedBuffer, {
            metadata: {
              contentType: 'image/jpeg',
              metadata: {
                uploadedBy: userEmail,
                chatId: chatId,
                uploadedAt: new Date().toISOString(),
                originalFormat: req.file.mimetype,
              },
            },
            // Removed public: true - files are now private and accessed via signed URLs
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Upload timeout: Firebase Storage upload took too long')), 90000)
          )
        ]);

        const uploadDuration = Date.now() - uploadStartTime;
        console.log(`✅ Upload completed in ${uploadDuration}ms`);

        // Generate signed URL with configurable expiration (default: 1 year)
        const expiresIn = IMAGE_URL_EXPIRATION_DAYS * 24 * 60 * 60 * 1000; // Convert days to milliseconds
        const expiresAt = new Date(Date.now() + expiresIn);
        
        console.log(`🔐 Generating signed URL (expires in ${IMAGE_URL_EXPIRATION_DAYS} days)...`);
        const [signedUrl] = await file.getSignedUrl({
          action: 'read',
          expires: expiresAt,
        });

        console.log(`✅ Signed URL generated, expires at: ${expiresAt.toISOString()}`);

        res.json({
          success: true,
          imageUrl: signedUrl, // Use signed URL instead of public URL
          imageId: imageId,
        });
      } catch (error: any) {
        console.error('Image upload error:', error);
        console.error('Error details:', {
          message: error.message,
          code: error.code,
          stack: error.stack?.substring(0, 500),
        });
        
        // Handle specific error types
        if (error.message?.includes('Only image files are allowed') || error.message?.includes('Only JPG images are allowed')) {
          return res.status(400).json({ error: error.message });
        }
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'Image size exceeds 10MB limit' });
        }
        if (error.message?.includes('timeout') || error.message?.includes('Timeout')) {
          return res.status(504).json({ error: 'Upload timeout: The image upload took too long. Please try again with a smaller image.' });
        }
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
          return res.status(504).json({ error: 'Network timeout: Connection to storage service timed out. Please try again.' });
        }
        
        res.status(500).json({ 
          error: error.message || 'Failed to upload image',
          code: error.code || 'UNKNOWN_ERROR'
        });
      }
    }
  );


  // POST /api/images/refresh - Refresh signed URLs for images in messages
  app.post(
    '/api/images/refresh',
    authenticateUser,
    async (req, res) => {
      try {
        const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
        const orgSlug = req.headers['x-org-slug'] as string;
        const { imageUrls, chatId } = req.body;
        
        if (!imageUrls || !Array.isArray(imageUrls)) {
          return res.status(400).json({ error: 'imageUrls array is required' });
        }
        
        if (!chatId) {
          return res.status(400).json({ error: 'chatId is required' });
        }

        // Process all URLs in parallel for better performance
        const refreshPromises = imageUrls.map(async (imageUrl) => {
          try {
            const storagePath = await extractStoragePathUtil(storage, imageUrl, orgId, 'chat-images', chatId, orgSlug);
            if (storagePath) {
              const newSignedUrl = await generateSignedUrlUtil(storage, storagePath, IMAGE_URL_EXPIRATION_DAYS);
              return newSignedUrl;
            } else {
              // If we can't extract the path, keep the original URL
              return imageUrl;
            }
          } catch (error: any) {
            console.error(`Failed to refresh URL for ${imageUrl}:`, error);
            // Keep original URL if refresh fails
            return imageUrl;
          }
        });
        
        const refreshedUrls = await Promise.all(refreshPromises);
        
        res.json({
          success: true,
          imageUrls: refreshedUrls,
        });
      } catch (error: any) {
        console.error('Image refresh error:', error);
        res.status(500).json({ 
          error: error.message || 'Failed to refresh image URLs',
          code: error.code || 'UNKNOWN_ERROR'
        });
      }
    }
  );

  // GET /api/images/proxy - Proxy images with proper CORS headers for PDF export
  // This endpoint fetches images from GCS/Firebase Storage and serves them with CORS headers
  // Usage: /api/images/proxy?url=<encoded-gcs-signed-url>
  app.get(
    '/api/images/proxy',
    async (req, res) => {
      try {
        const { url } = req.query;

        if (!url || typeof url !== 'string') {
          return res.status(400).json({ error: 'url parameter is required' });
        }

        // Decode the URL (it might be encoded to avoid issues with query parameters)
        let imageUrl: string;
        try {
          imageUrl = decodeURIComponent(url);
        } catch (decodeError) {
          imageUrl = url; // Use as-is if decoding fails
        }

        // Validate that it's a Google Cloud Storage URL to prevent abuse
        if (!imageUrl.includes('storage.googleapis.com') && !imageUrl.includes('firebasestorage.googleapis.com')) {
          return res.status(400).json({ error: 'Only Google Cloud Storage URLs are allowed' });
        }

        console.log('🖼️ Proxying image:', imageUrl.substring(0, 100) + '...');

        // Fetch the image from GCS
        const response = await fetch(imageUrl, {
          timeout: 30000, // 30 second timeout
        });

        if (!response.ok) {
          console.error('Failed to fetch image from GCS:', response.status, response.statusText);
          return res.status(response.status).json({ error: `Failed to fetch image: ${response.statusText}` });
        }

        // Get the image buffer
        const imageBuffer = await response.arrayBuffer();

        // Set proper CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

        // Set content type based on the response
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        res.setHeader('Content-Type', contentType);

        // Set cache headers (cache for 1 hour)
        res.setHeader('Cache-Control', 'public, max-age=3600');

        // Set content length
        res.setHeader('Content-Length', imageBuffer.byteLength);

        console.log(`✅ Image proxied successfully: ${contentType}, ${(imageBuffer.byteLength / 1024).toFixed(1)}KB`);

        // Send the image buffer
        res.send(Buffer.from(imageBuffer));

      } catch (error: any) {
        console.error('Image proxy error:', error);
        res.status(500).json({
          error: error.message || 'Failed to proxy image',
          code: error.code || 'PROXY_ERROR'
        });
      }
    }
  );
}

