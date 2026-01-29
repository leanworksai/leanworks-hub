/**
 * Document Upload Endpoints
 * 
 * Handles document uploads (PDF, Word, PowerPoint, Excel) with async processing.
 * Documents are stored in GCS and processed asynchronously via Pub/Sub.
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { getOrgSlugById, getOrgPoolBySlug } from '../../database/multi-tenant-pool.js';
import { generateSignedUrl as generateSignedUrlUtil } from '../utils/storage.js';
import { validateUploadedFile, getSupportedFileTypes } from '../middleware/file-validation.js';
import { publishDocumentProcessingJob } from '../services/document-pubsub.js';
import { documentProcessorFactory, DocumentType } from '../services/processors/index.js';
import { isDocumentProcessingError, getUserFriendlyMessage } from '../utils/document-errors.js';
import { exportPresentationToPPTX } from '../services/pptx-exporter.js';

// File URL expiration time (default: 1 year)
const FILE_URL_EXPIRATION_DAYS = parseInt(process.env.FILE_URL_EXPIRATION_DAYS || '365', 10);
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '52428800'); // 50MB default

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
});

/**
 * Map MIME type to document type
 */
function getDocTypeFromMimeType(mimeType: string): DocumentType {
  const processor = documentProcessorFactory.getProcessorByMimeType(mimeType);
  return processor.getDocumentType();
}

/**
 * Setup document upload endpoints
 */
export function setupDocumentUploadEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  requireOrgMembership: express.RequestHandler,
  storage: any // Firebase Admin Storage instance (GCS)
) {
  console.log('✅ Document upload endpoints registered at /api/docs/upload');

  // Health check
  app.get('/api/docs/upload/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      endpoint: '/api/docs/upload',
      supportedTypes: getSupportedFileTypes(),
    });
  });

  // GET /api/docs/upload/supported-types - Get supported file types
  app.get('/api/docs/upload/supported-types', (req, res) => {
    res.json(getSupportedFileTypes());
  });

  // POST /api/docs/upload - Upload document for processing
  app.post(
    '/api/docs/upload',
    authenticateUser,
    (req, res, next) => {
      console.log('📄 Document upload endpoint hit');
      // Multer error handler
      upload.single('file')(req, res, (err: any) => {
        if (err) {
          console.error('Multer error:', err);
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ 
              error: `File size exceeds ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)}MB limit`,
              code: 'FILE_TOO_LARGE',
            });
          }
          return res.status(400).json({ 
            error: err.message || 'File upload error',
            code: 'UPLOAD_ERROR',
          });
        }
        next();
      });
    },
    validateUploadedFile, // Validate file type, size, magic bytes, rate limit
    async (req, res) => {
      try {
        console.log('📄 Processing document upload...');
        
        const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
        const userEmail = (req as any).user.email?.toLowerCase();
        const { title, projectId, teamId } = req.body;
        
        console.log('📄 Upload params:', { 
          orgId, 
          userEmail, 
          title,
          projectId,
          teamId,
          hasFile: !!req.file 
        });

        if (!req.file) {
          return res.status(400).json({ 
            error: 'No file provided',
            code: 'NO_FILE',
          });
        }

        // Get org slug
        let orgSlug: string;
        const orgSlugFromHeader = req.headers['x-org-slug'] as string;
        
        if (orgSlugFromHeader) {
          orgSlug = orgSlugFromHeader;
          console.log(`📄 Using org slug from header: ${orgSlug}`);
        } else if (orgId) {
          try {
            orgSlug = await getOrgSlugById(orgId);
            console.log(`📄 Converted orgId ${orgId} to slug: ${orgSlug}`);
          } catch (error) {
            console.error(`❌ Failed to get org slug for ${orgId}:`, error);
            return res.status(400).json({ 
              error: 'Invalid organization',
              code: 'INVALID_ORG',
            });
          }
        } else {
          return res.status(400).json({ 
            error: 'Organization ID or slug is required',
            code: 'MISSING_ORG',
          });
        }

        // Generate document ID
        const docId = uuidv4();
        
        // Determine document type from MIME type
        const docType = getDocTypeFromMimeType(req.file.mimetype);
        
        // Generate storage path
        const fileId = `${uuidv4()}_${req.file.originalname}`;
        const storagePath = `orgs/${orgSlug}/documents/${docId}/${fileId}`;
        
        console.log(`📄 Uploading to GCS: ${storagePath}`);

        // Upload to GCS
        const bucket = storage.bucket();
        const file = bucket.file(storagePath);
        
        await file.save(req.file.buffer, {
          metadata: {
            contentType: req.file.mimetype,
            metadata: {
              originalName: req.file.originalname,
              uploadedBy: userEmail,
              docId,
              docType,
            },
          },
        });

        console.log(`✅ File uploaded to GCS: ${storagePath}`);

        // Create document record in database
        const pool = await getOrgPoolBySlug(orgSlug);
        
        const docTitle = title || req.file.originalname;
        
        const result = await pool.query(
          `INSERT INTO docs (
            id, 
            title, 
            content, 
            owner_email, 
            project_id, 
            team_id,
            doc_type,
            file_metadata,
            storage_path,
            processing_status,
            file_size,
            mime_type,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
          RETURNING id, title, doc_type, processing_status, created_at`,
          [
            docId,
            docTitle,
            '', // Empty content initially, will be filled by processor
            userEmail,
            projectId || null,
            teamId || null,
            docType,
            JSON.stringify({
              originalName: req.file.originalname,
              uploadedBy: userEmail,
            }),
            storagePath,
            'uploading',
            req.file.size,
            req.file.mimetype,
          ]
        );

        console.log(`💾 Document record created: ${docId}`);

        // Create processing job record
        const jobId = uuidv4();
        
        await pool.query(
          `INSERT INTO doc_processing_jobs (
            id,
            doc_id,
            job_type,
            status,
            priority,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
          [jobId, docId, 'process_document', 'pending', 0]
        );

        console.log(`📋 Processing job created: ${jobId}`);

        // Publish processing job to Pub/Sub
        try {
          await publishDocumentProcessingJob({
            jobId,
            docId,
            docType,
            storagePath,
            fileName: req.file.originalname,
            fileSize: req.file.size,
            mimeType: req.file.mimetype,
            orgSlug,
            userId: userEmail,
            projectId: projectId || undefined,
            teamId: teamId || undefined,
            correlationId: uuidv4(),
          });

          console.log(`📤 Processing job published to Pub/Sub: ${jobId}`);
        } catch (error) {
          console.error(`❌ Failed to publish processing job:`, error);
          // Update status to error
          await pool.query(
            `UPDATE docs SET processing_status = 'error' WHERE id = $1`,
            [docId]
          );
          await pool.query(
            `UPDATE doc_processing_jobs SET status = 'failed', error_message = $1 WHERE id = $2`,
            ['Failed to queue processing job', jobId]
          );
        }

        // Return response
        res.status(201).json({
          id: docId,
          title: docTitle,
          docType,
          processingStatus: 'uploading',
          createdAt: result.rows[0].created_at,
          message: 'Document uploaded successfully. Processing will begin shortly.',
        });

      } catch (error: any) {
        console.error('❌ Error uploading document:', error);
        
        if (isDocumentProcessingError(error)) {
          return res.status(error.statusCode).json({
            error: getUserFriendlyMessage(error),
            code: error.code,
            details: error.message,
          });
        }
        
        res.status(500).json({ 
          error: 'Failed to upload document',
          code: 'UPLOAD_FAILED',
          details: error.message,
        });
      }
    }
  );

  // GET /api/docs/:docId/status - Get document processing status
  app.get(
    '/api/docs/:docId/status',
    authenticateUser,
    async (req, res) => {
      try {
        const { docId } = req.params;
        const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
        const userEmail = (req as any).user.email?.toLowerCase();

        // Get org slug
        let orgSlug: string;
        const orgSlugFromHeader = req.headers['x-org-slug'] as string;
        
        if (orgSlugFromHeader) {
          orgSlug = orgSlugFromHeader;
        } else if (orgId) {
          orgSlug = await getOrgSlugById(orgId);
        } else {
          return res.status(400).json({ 
            error: 'Organization ID or slug is required',
            code: 'MISSING_ORG',
          });
        }

        // Get document from database
        const pool = await getOrgPoolBySlug(orgSlug);
        
        const result = await pool.query(
          `SELECT 
            d.id,
            d.title,
            d.doc_type,
            d.processing_status,
            d.file_size,
            d.mime_type,
            d.created_at,
            d.updated_at,
            j.status as job_status,
            j.error_message,
            j.retry_count,
            j.started_at,
            j.completed_at
          FROM docs d
          LEFT JOIN doc_processing_jobs j ON d.id = j.doc_id
          WHERE d.id = $1 AND d.owner_email = $2
          ORDER BY j.created_at DESC
          LIMIT 1`,
          [docId, userEmail]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ 
            error: 'Document not found',
            code: 'NOT_FOUND',
          });
        }

        const doc = result.rows[0];

        res.json({
          id: doc.id,
          title: doc.title,
          docType: doc.doc_type,
          processingStatus: doc.processing_status,
          fileSize: doc.file_size,
          mimeType: doc.mime_type,
          job: doc.job_status ? {
            status: doc.job_status,
            errorMessage: doc.error_message,
            retryCount: doc.retry_count,
            startedAt: doc.started_at,
            completedAt: doc.completed_at,
          } : null,
          createdAt: doc.created_at,
          updatedAt: doc.updated_at,
        });

      } catch (error: any) {
        console.error('❌ Error getting document status:', error);
        res.status(500).json({ 
          error: 'Failed to get document status',
          code: 'STATUS_ERROR',
          details: error.message,
        });
      }
    }
  );

  // GET /api/docs/:docId/preview - Get document preview data
  app.get(
    '/api/docs/:docId/preview',
    authenticateUser,
    async (req, res) => {
      try {
        const { docId } = req.params;
        const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
        const userEmail = (req as any).user.email?.toLowerCase();

        // Get org slug
        let orgSlug: string;
        const orgSlugFromHeader = req.headers['x-org-slug'] as string;
        
        if (orgSlugFromHeader) {
          orgSlug = orgSlugFromHeader;
        } else if (orgId) {
          orgSlug = await getOrgSlugById(orgId);
        } else {
          return res.status(400).json({ 
            error: 'Organization ID or slug is required',
            code: 'MISSING_ORG',
          });
        }

        // Get document from database
        const pool = await getOrgPoolBySlug(orgSlug);
        
        const result = await pool.query(
          `SELECT 
            id,
            title,
            content,
            doc_type,
            file_metadata,
            storage_path,
            processing_status,
            file_size,
            mime_type,
            created_at,
            updated_at
          FROM docs
          WHERE id = $1 AND owner_email = $2`,
          [docId, userEmail]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ 
            error: 'Document not found',
            code: 'NOT_FOUND',
          });
        }

        const doc = result.rows[0];

        // Check if processing is complete
        if (doc.processing_status !== 'ready') {
          return res.status(202).json({
            id: doc.id,
            title: doc.title,
            docType: doc.doc_type,
            processingStatus: doc.processing_status,
            message: 'Document is still being processed',
          });
        }

        // Parse file metadata
        const metadata = doc.file_metadata || {};

        // Generate signed URL for download
        let downloadUrl = null;
        if (doc.storage_path) {
          try {
            downloadUrl = await generateSignedUrlUtil(
              storage,
              doc.storage_path,
              FILE_URL_EXPIRATION_DAYS
            );
          } catch (error) {
            console.error('Failed to generate signed URL:', error);
          }
        }

        res.json({
          id: doc.id,
          title: doc.title,
          docType: doc.doc_type,
          content: doc.content,
          metadata: {
            ...metadata,
            fileSize: doc.file_size,
            mimeType: doc.mime_type,
          },
          downloadUrl,
          processingStatus: doc.processing_status,
          createdAt: doc.created_at,
          updatedAt: doc.updated_at,
        });

      } catch (error: any) {
        console.error('❌ Error getting document preview:', error);
        res.status(500).json({ 
          error: 'Failed to get document preview',
          code: 'PREVIEW_ERROR',
          details: error.message,
        });
      }
    }
  );

  // GET /api/docs/:docId/download - Get signed URL for document download
  app.get(
    '/api/docs/:docId/download',
    authenticateUser,
    async (req, res) => {
      try {
        const { docId } = req.params;
        const orgId = (req as any).orgId || req.headers['x-org-id'] as string;
        const userEmail = (req as any).user.email?.toLowerCase();

        // Get org slug
        let orgSlug: string;
        const orgSlugFromHeader = req.headers['x-org-slug'] as string;
        
        if (orgSlugFromHeader) {
          orgSlug = orgSlugFromHeader;
        } else if (orgId) {
          orgSlug = await getOrgSlugById(orgId);
        } else {
          return res.status(400).json({ 
            error: 'Organization ID or slug is required',
            code: 'MISSING_ORG',
          });
        }

        // Get document from database
        const pool = await getOrgPoolBySlug(orgSlug);
        
        const result = await pool.query(
          `SELECT 
            id,
            title,
            storage_path,
            file_metadata
          FROM docs
          WHERE id = $1 AND owner_email = $2`,
          [docId, userEmail]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ 
            error: 'Document not found',
            code: 'NOT_FOUND',
          });
        }

        const doc = result.rows[0];

        if (!doc.storage_path) {
          return res.status(404).json({ 
            error: 'Document file not found',
            code: 'FILE_NOT_FOUND',
          });
        }

        // Generate signed URL
        const downloadUrl = await generateSignedUrlUtil(
          storage,
          doc.storage_path,
          FILE_URL_EXPIRATION_DAYS
        );

        // Parse metadata to get original filename
        const metadata = doc.file_metadata || {};
        const originalName = metadata.originalName || `${doc.title}.pdf`;

        res.json({
          id: doc.id,
          title: doc.title,
          downloadUrl,
          fileName: originalName,
          expiresIn: `${FILE_URL_EXPIRATION_DAYS} days`,
        });

      } catch (error: any) {
        console.error('❌ Error generating download URL:', error);
        res.status(500).json({ 
          error: 'Failed to generate download URL',
          code: 'DOWNLOAD_ERROR',
          details: error.message,
        });
      }
    }
  );

  // ============================================================================
  // PRESENTATION JSON ENDPOINTS
  // ============================================================================

  // GET /api/docs/:id/presentation - Get presentation JSON for editing
  app.get('/api/docs/:id/presentation', authenticateUser, requireOrgMembership, async (req, res) => {
    try {
      console.log(`📄 Getting presentation JSON for doc: ${req.params.id}`);

      const { id } = req.params;
      const orgSlug = (req as any).orgSlug;
      console.log(`🔍 GET /api/docs/${id}/presentation - orgSlug: ${orgSlug}, userEmail: ${(req as any).userEmail}`);
      const pool = await getOrgPoolBySlug(orgSlug);

      let result;
      try {
        result = await pool.query(
          `SELECT content FROM docs WHERE id = $1 AND doc_type = 'pptx'`,
          [id]
        );
        console.log(`🔍 GET presentation query succeeded for org ${orgSlug}, doc ${id}`);
      } catch (queryError: any) {
        console.error(`❌ GET presentation query failed for org ${orgSlug}, doc ${id}:`, queryError.message);
        console.error(`   Error code:`, queryError.code);
        console.error(`   Error details:`, queryError);
        throw queryError;
      }

      console.log(`📊 Query result: ${result.rows.length} rows found`);

      if (!result.rows[0]?.content) {
        console.log(`❌ No content found for doc ${id} - document may not be processed yet`);
        return res.status(404).json({
          error: 'Presentation data not found. Document may still be processing.',
          code: 'PRESENTATION_NOT_FOUND'
        });
      }

      console.log(`📄 Content found for doc ${id}, length: ${result.rows[0].content?.length || 0}`);

      // Parse the presentation JSON from content field
      let presentation;
      try {
        presentation = JSON.parse(result.rows[0].content);
        console.log(`✅ JSON parsing successful for doc ${id}, slides: ${presentation.slides?.length || 0}`);
      } catch (error: any) {
        console.error(`❌ JSON parsing failed for doc ${id}:`, error.message);
        console.error(`   Content preview:`, result.rows[0].content?.substring(0, 200) + '...');
        return res.status(500).json({
          error: 'Invalid presentation data format',
          code: 'INVALID_PRESENTATION_FORMAT'
        });
      }

      res.json({
        presentation
      });

    } catch (error: any) {
      console.error('❌ Error getting presentation JSON:', error);
      res.status(500).json({
        error: 'Failed to get presentation JSON',
        code: 'PRESENTATION_ERROR',
        details: error.message,
      });
    }
  });

  // PUT /api/docs/:id/presentation - Update presentation JSON
  app.put('/api/docs/:id/presentation', authenticateUser, requireOrgMembership, async (req, res) => {
    try {
      console.log(`📄 Updating presentation JSON for doc: ${req.params.id}`);

      const { id } = req.params;
      const { presentation } = req.body;
      const orgSlug = (req as any).orgSlug;

      if (!presentation) {
        return res.status(400).json({
          error: 'Presentation JSON is required',
          code: 'MISSING_PRESENTATION'
        });
      }

      // Basic validation of presentation structure
      if (!presentation.slides || !Array.isArray(presentation.slides)) {
        return res.status(400).json({
          error: 'Invalid presentation structure',
          code: 'INVALID_PRESENTATION'
        });
      }

      const pool = await getOrgPoolBySlug(orgSlug);

      // Update the presentation JSON in content field
      try {
        await pool.query(
          `UPDATE docs
           SET content = $1, updated_at = NOW()
           WHERE id = $2 AND doc_type = 'pptx'`,
          [JSON.stringify(presentation), id]
        );
        console.log(`🔍 PUT presentation query succeeded for org ${orgSlug}, doc ${id}`);
      } catch (queryError: any) {
        console.error(`❌ PUT presentation query failed for org ${orgSlug}, doc ${id}:`, queryError.message);
        console.error(`   Error code:`, queryError.code);
        console.error(`   Error details:`, queryError);
        throw queryError;
      }

      res.json({
        success: true,
        message: 'Presentation updated successfully'
      });

    } catch (error: any) {
      console.error('❌ Error updating presentation JSON:', error);
      res.status(500).json({
        error: 'Failed to update presentation JSON',
        code: 'UPDATE_ERROR',
        details: error.message,
      });
    }
  });

  // POST /api/docs/:id/export-pptx - Export presentation JSON to PPTX
  app.post('/api/docs/:id/export-pptx', authenticateUser, requireOrgMembership, async (req, res) => {
    try {
      console.log(`📄 Exporting presentation to PPTX for doc: ${req.params.id}`);

      const { id } = req.params;
      const orgSlug = (req as any).orgSlug;
      const userEmail = (req as any).userEmail;
      console.log(`🔍 POST /api/docs/${id}/export-pptx - orgSlug: ${orgSlug}, userEmail: ${userEmail}`);
      const pool = await getOrgPoolBySlug(orgSlug);

      // Get the presentation JSON from content field
      let result;
      try {
        result = await pool.query(
          `SELECT content, title, owner_email FROM docs WHERE id = $1 AND doc_type = 'pptx'`,
          [id]
        );
        console.log(`🔍 POST export-pptx query succeeded for org ${orgSlug}, doc ${id}`);
      } catch (queryError: any) {
        console.error(`❌ POST export-pptx query failed for org ${orgSlug}, doc ${id}:`, queryError.message);
        console.error(`   Error code:`, queryError.code);
        console.error(`   Error details:`, queryError);
        throw queryError;
      }

      if (!result.rows[0]?.content) {
        return res.status(404).json({
          error: 'Presentation data not found',
          code: 'PRESENTATION_NOT_FOUND'
        });
      }

      // Parse the presentation JSON from content field
      let presentation;
      try {
        presentation = JSON.parse(result.rows[0].content);
      } catch (error) {
        return res.status(500).json({
          error: 'Invalid presentation data format',
          code: 'INVALID_PRESENTATION_FORMAT'
        });
      }
      const title = result.rows[0].title || 'presentation';
      const ownerEmail = result.rows[0].owner_email;

      // Generate PPTX file
      const pptxBuffer = await exportPresentationToPPTX(presentation);

      // Upload to GCS
      const storagePath = `orgs/${orgSlug}/exports/${id}/export-${Date.now()}.pptx`;
      const bucket = storage.bucket();

      const file = bucket.file(storagePath);
      await file.save(pptxBuffer, {
        metadata: {
          contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          metadata: {
            originalName: `${title}.pptx`,
            exportedBy: userEmail,
            exportedAt: new Date().toISOString(),
            sourceDocId: id,
            ownerEmail,
          },
        },
      });

      // Generate signed URL for download
      const downloadUrl = await generateSignedUrlUtil(
        storage,
        storagePath,
        FILE_URL_EXPIRATION_DAYS
      );

      res.json({
        success: true,
        downloadUrl,
        fileName: `${title}.pptx`,
        message: 'PPTX exported successfully'
      });

    } catch (error: any) {
      console.error('❌ Error exporting to PPTX:', error);
      res.status(500).json({
        error: 'Failed to export PPTX',
        code: 'EXPORT_ERROR',
        details: error.message,
      });
    }
  });
}
