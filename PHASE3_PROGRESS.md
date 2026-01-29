# Phase 3 Implementation Progress

## ✅ PHASE 3 COMPLETE!

All API endpoints for document upload and management have been implemented.

## Completed Files

### 1. Document Upload Endpoints ✅
- [`server/endpoints/docs-upload.ts`](server/endpoints/docs-upload.ts)
  - **POST /api/docs/upload** - Upload document with validation
  - **GET /api/docs/:docId/status** - Get processing status
  - **GET /api/docs/:docId/preview** - Get document preview with content
  - **GET /api/docs/:docId/download** - Get signed download URL
  - **GET /api/docs/upload/health** - Health check endpoint
  - **GET /api/docs/upload/supported-types** - Get supported file types info

### 2. Server Integration ✅
- [`server/index.ts`](server/index.ts) (updated)
  - Imported `setupDocumentUploadEndpoints`
  - Registered endpoints with Express app
  - Integrated with existing authentication middleware

## API Endpoints Details

### POST /api/docs/upload
**Purpose:** Upload a document file for async processing

**Request:**
- Method: POST
- Content-Type: multipart/form-data
- Headers:
  - Authorization: Bearer {token}
  - x-org-id or x-org-slug: Organization identifier
- Body:
  - file: File (PDF, DOCX, PPTX, XLSX)
  - title: Optional document title
  - projectId: Optional project ID
  - teamId: Optional team ID

**Response (201):**
```json
{
  "id": "uuid",
  "title": "Document Title",
  "docType": "pdf",
  "processingStatus": "uploading",
  "createdAt": "2026-01-29T...",
  "message": "Document uploaded successfully. Processing will begin shortly."
}
```

**Validation:**
- File size: Max 50MB (configurable)
- File types: PDF, DOCX, PPTX, XLSX only
- MIME type validation
- Magic bytes verification
- Rate limiting: 10 uploads/minute per user

**Flow:**
1. Validate file (size, type, magic bytes, rate limit)
2. Upload file to GCS (`orgs/{orgSlug}/documents/{docId}/{fileId}`)
3. Create document record in database (status: 'uploading')
4. Create processing job record
5. Publish job to Pub/Sub for async processing
6. Return document ID and status

### GET /api/docs/:docId/status
**Purpose:** Poll document processing status

**Request:**
- Method: GET
- Headers:
  - Authorization: Bearer {token}
  - x-org-id or x-org-slug: Organization identifier

**Response (200):**
```json
{
  "id": "uuid",
  "title": "Document Title",
  "docType": "pdf",
  "processingStatus": "ready",
  "fileSize": 1234567,
  "mimeType": "application/pdf",
  "job": {
    "status": "completed",
    "errorMessage": null,
    "retryCount": 0,
    "startedAt": "2026-01-29T...",
    "completedAt": "2026-01-29T..."
  },
  "createdAt": "2026-01-29T...",
  "updatedAt": "2026-01-29T..."
}
```

**Processing Statuses:**
- `uploading` - File is being uploaded to GCS
- `processing` - Document is being processed by worker
- `ready` - Processing complete, document ready to view
- `error` - Processing failed

### GET /api/docs/:docId/preview
**Purpose:** Get document preview with extracted content

**Request:**
- Method: GET
- Headers:
  - Authorization: Bearer {token}
  - x-org-id or x-org-slug: Organization identifier

**Response (200):**
```json
{
  "id": "uuid",
  "title": "Document Title",
  "docType": "pdf",
  "content": "Extracted text content...",
  "metadata": {
    "pageCount": 10,
    "wordCount": 1500,
    "author": "John Doe",
    "thumbnails": ["data:image/png;base64,..."],
    "htmlContent": "<html>...</html>",
    "previewData": { ... },
    "fileSize": 1234567,
    "mimeType": "application/pdf"
  },
  "downloadUrl": "https://storage.googleapis.com/...",
  "processingStatus": "ready",
  "createdAt": "2026-01-29T...",
  "updatedAt": "2026-01-29T..."
}
```

**Response (202):** If still processing
```json
{
  "id": "uuid",
  "title": "Document Title",
  "docType": "pdf",
  "processingStatus": "processing",
  "message": "Document is still being processed"
}
```

### GET /api/docs/:docId/download
**Purpose:** Get signed URL for downloading original file

**Request:**
- Method: GET
- Headers:
  - Authorization: Bearer {token}
  - x-org-id or x-org-slug: Organization identifier

**Response (200):**
```json
{
  "id": "uuid",
  "title": "Document Title",
  "downloadUrl": "https://storage.googleapis.com/...",
  "fileName": "original-filename.pdf",
  "expiresIn": "365 days"
}
```

### GET /api/docs/upload/supported-types
**Purpose:** Get information about supported file types

**Request:**
- Method: GET
- No authentication required

**Response (200):**
```json
{
  "types": ["pdf", "docx", "pptx", "xlsx"],
  "mimeTypes": [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ...
  ],
  "extensions": [".pdf", ".docx", ".pptx", ".xlsx"],
  "maxFileSize": 52428800,
  "maxFileSizeMB": "50.00"
}
```

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "User-friendly error message",
  "code": "ERROR_CODE",
  "details": "Technical error details"
}
```

**Common Error Codes:**
- `NO_FILE` - No file provided in upload
- `FILE_TOO_LARGE` - File exceeds size limit
- `INVALID_FILE_TYPE` - Unsupported file type
- `INVALID_MIME_TYPE` - MIME type doesn't match extension
- `FILE_CORRUPTED` - File signature invalid
- `RATE_LIMIT_EXCEEDED` - Too many uploads
- `MISSING_ORG` - Organization ID/slug not provided
- `INVALID_ORG` - Organization not found
- `NOT_FOUND` - Document not found
- `UPLOAD_FAILED` - Generic upload error
- `STATUS_ERROR` - Error getting status
- `PREVIEW_ERROR` - Error getting preview
- `DOWNLOAD_ERROR` - Error generating download URL

## Security Features

1. **Authentication Required** - All endpoints require valid JWT token
2. **Organization Isolation** - Users can only access documents in their org
3. **Owner Verification** - Users can only access their own documents
4. **File Validation** - MIME type, magic bytes, size limits
5. **Rate Limiting** - 10 uploads/minute per user
6. **Signed URLs** - Time-limited access to GCS files (365 days)

## Integration Points

### With Phase 2 Services:
- Uses [`validateUploadedFile`](server/middleware/file-validation.ts) middleware
- Calls [`publishDocumentProcessingJob`](server/services/document-pubsub.ts) to queue processing
- Uses [`documentProcessorFactory`](server/services/processors/index.ts) to determine doc type
- Uses [`getUserFriendlyMessage`](server/utils/document-errors.ts) for error messages

### With Database:
- Creates document record in `docs` table
- Creates job record in `doc_processing_jobs` table
- Queries document status and metadata
- Uses multi-tenant pool system

### With GCS:
- Uploads files to `orgs/{orgSlug}/documents/{docId}/{fileId}`
- Generates signed URLs for downloads
- Uses existing Firebase Admin Storage

## Next Steps (Phase 4: Frontend)

1. **Update DocsList component** - Add dropdown menu to '+' button
2. **Create DocumentUploadDialog** - File picker with progress tracking
3. **Create DocumentViewer** - Route to appropriate viewer by type
4. **Implement type-specific viewers:**
   - PDFViewer
   - WordViewer
   - PowerPointViewer
   - ExcelViewer
5. **Update DocItem** - Show document type icons and file size
6. **Add document type badges** - Visual indicators for file types

## Testing Checklist

- [ ] Test upload with valid PDF file
- [ ] Test upload with valid Word file
- [ ] Test upload with valid PowerPoint file
- [ ] Test upload with valid Excel file
- [ ] Test upload with invalid file type
- [ ] Test upload with file too large
- [ ] Test upload with corrupted file
- [ ] Test rate limiting (11 uploads in 1 minute)
- [ ] Test status polling during processing
- [ ] Test preview endpoint after processing complete
- [ ] Test download URL generation
- [ ] Test authentication (no token, invalid token)
- [ ] Test organization isolation (access other org's docs)
- [ ] Test owner verification (access other user's docs)

## Summary

**Phase 3 is 100% complete!** All API endpoints are implemented and integrated with the server. The backend is now ready to handle document uploads and serve processed content to the frontend.