/**
 * Image Upload Endpoints
 * Handles image uploads to Firebase Storage via Admin SDK
 * Images are stored at: domains/{domain}/chat-images/{chatId}/{imageId}.jpg
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

// Configure multer for memory storage (we'll upload directly to Firebase Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    // Only allow JPG images
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
      cb(null, true);
    } else if (file.originalname.toLowerCase().endsWith('.jpg') || 
               file.originalname.toLowerCase().endsWith('.jpeg')) {
      // Also check file extension as fallback
      cb(null, true);
    } else {
      cb(new Error('Only JPG images are allowed'));
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
          if (err.message === 'Only JPG images are allowed') {
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
        const domain = (req as any).userDomain;
        const userEmail = (req as any).user.email?.toLowerCase();
        const { chatId } = req.body;
        
        console.log('📸 Upload params:', { domain, userEmail, chatId, hasFile: !!req.file });

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

        // Validate file type
        if (req.file.mimetype !== 'image/jpeg' && 
            req.file.mimetype !== 'image/jpg' &&
            !req.file.originalname.toLowerCase().endsWith('.jpg') &&
            !req.file.originalname.toLowerCase().endsWith('.jpeg')) {
          return res.status(400).json({ error: 'Only JPG images are allowed' });
        }

        // Generate unique image ID
        const imageId = `${uuidv4()}.jpg`;
        
        // Construct storage path: domains/{sanitized-domain}/chat-images/{chatId}/{imageId}
        // Domain is already sanitized by getDomainFromEmail (removes special chars)
        const storagePath = `domains/${domain}/chat-images/${chatId}/${imageId}`;

        // Use fixed bucket name
        const bucketName = 'leanworks-prod';
        
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

        // Upload file to Firebase Storage
        await file.save(req.file.buffer, {
          metadata: {
            contentType: 'image/jpeg',
            metadata: {
              uploadedBy: userEmail,
              chatId: chatId,
              uploadedAt: new Date().toISOString(),
            },
          },
          public: true, // Make file publicly accessible
        });

        // Get public URL
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        res.json({
          success: true,
          imageUrl: publicUrl,
          imageId: imageId,
        });
      } catch (error: any) {
        console.error('Image upload error:', error);
        
        // Handle specific error types
        if (error.message === 'Only JPG images are allowed') {
          return res.status(400).json({ error: error.message });
        }
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'Image size exceeds 10MB limit' });
        }
        
        res.status(500).json({ error: (error as Error).message || 'Failed to upload image' });
      }
    }
  );
}

