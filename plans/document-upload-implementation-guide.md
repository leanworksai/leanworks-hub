# Document Upload Implementation Guide
## Quick Reference for Developers

**Related Documents:**
- [Architecture Plan](./document-upload-architecture.md) - Comprehensive architecture details
- [Database Schema](../database/schema.sql) - Current database schema

---

## Quick Start

### 1. Install Dependencies

```bash
npm install pdf-parse pdf-lib pdfjs-dist mammoth xlsx exceljs bullmq ioredis clamscan
npm install --save-dev @types/pdf-parse
```

### 2. Environment Variables

Add to `.env`:

```bash
# Redis (for job queue)
REDIS_HOST=localhost
REDIS_PORT=6379

# ClamAV (optional, for virus scanning)
CLAMAV_HOST=localhost
CLAMAV_PORT=3310

# File upload limits
MAX_FILE_SIZE=52428800  # 50MB in bytes
FILE_URL_EXPIRATION_DAYS=365

# Processing
PROCESSING_CONCURRENCY=5
PROCESSING_MAX_RETRIES=3
```

### 3. Database Migration

Run the migration script:

```bash
npm run db:migrate:document-upload
```

Or manually execute:

```sql
-- See database/migrations/add-document-upload-support.sql
```

---

## Implementation Checklist by Component

### Backend Services

#### 1. Document Processor Service
**File:** `server/services/document-processor.ts`

```typescript
// Base interface
interface DocumentProcessor {
  canProcess(mimeType: string): boolean;
  process(file: Buffer, metadata: FileMetadata): Promise<ProcessedDocument>;
  generateThumbnails(file: Buffer): Promise<string[]>;
}

// Implement for each type:
- PDFProcessor
- WordProcessor
- PowerPointProcessor
- ExcelProcessor
```

**Dependencies:**
- pdf-parse (PDF text extraction)
- pdfjs-dist (PDF rendering)
- mammoth (Word processing)
- xlsx (Excel processing)

#### 2. Job Queue Service
**File:** `server/services/job-queue.ts`

```typescript
// Set up BullMQ queue and worker
- Create queue: documentQueue
- Create worker: documentWorker
- Configure concurrency: 5
- Configure retries: 3
- Add event handlers
```

**Dependencies:**
- bullmq
- ioredis

#### 3. Validation Middleware
**File:** `server/middleware/file-validation.ts`

```typescript
// Validate:
- File size (max 50MB)
- MIME type (PDF, DOCX, PPTX, XLSX only)
- Magic bytes (file signature)
- File extension
```

#### 4. Security Services
**File:** `server/services/virus-scanner.ts` (optional)

```typescript
// Integrate ClamAV
- Scan uploaded files
- Reject infected files
- Log scan results
```

### API Endpoints

#### 1. Upload Endpoint
**File:** `server/endpoints/docs.ts`

```typescript
POST /api/docs/upload
- Accept multipart/form-data
- Validate file
- Upload to GCS
- Create doc record
- Queue processing job
- Return doc ID and status
```

#### 2. Status Endpoint
**File:** `server/endpoints/docs.ts`

```typescript
GET /api/docs/:docId/status
- Return processing status
- Return job progress
- Return errors if any
```

#### 3. Preview Endpoint
**File:** `server/endpoints/docs.ts`

```typescript
GET /api/docs/:docId/preview
- Return doc metadata
- Return extracted content
- Return thumbnails
- Return download URL
```

#### 4. Download Endpoint
**File:** `server/endpoints/docs.ts`

```typescript
GET /api/docs/:docId/download
- Generate signed URL
- Redirect to GCS
- Or stream file directly
```

#### 5. Enhanced Search
**File:** `server/endpoints/docs.ts`

```typescript
POST /api/docs/search
- Support docTypes filter
- Full-text search
- Return snippets
- Return relevance scores
```

### Frontend Components

#### 1. DocumentUpload Component
**File:** `src/components/DocumentUpload.tsx`

```typescript
// Features:
- File picker (accept .pdf, .docx, .pptx, .xlsx)
- Drag & drop support
- Progress indicator
- Processing status polling
- Error handling
- Success callback
```

#### 2. DocumentViewer Component
**File:** `src/components/DocumentViewer.tsx`

```typescript
// Route to appropriate viewer based on docType:
- PDFViewer
- WordViewer
- PowerPointViewer
- ExcelViewer
- RichTextEditor (existing)
```

#### 3. Type-Specific Viewers

**PDFViewer** (`src/components/viewers/PDFViewer.tsx`):
- Display thumbnails
- Show page count
- Display extracted text
- Download button

**WordViewer** (`src/components/viewers/WordViewer.tsx`):
- Render HTML content
- Display images
- Show metadata
- Download button

**PowerPointViewer** (`src/components/viewers/PowerPointViewer.tsx`):
- Display slide thumbnails
- Show slide content
- Navigate between slides
- Download button

**ExcelViewer** (`src/components/viewers/ExcelViewer.tsx`):
- Tabbed interface for sheets
- Table view with headers
- Pagination for large datasets
- Download button

#### 4. Update Existing Components

**DocsList** (`src/components/DocsList.tsx`):
- Add document type icons
- Show file size for uploads
- Filter by document type
- Show processing status

**DocItem** (`src/components/DocItem.tsx`):
- Display appropriate icon
- Show file metadata
- Handle different doc types

---

## Database Schema Changes

### 1. Extend Docs Table

```sql
ALTER TABLE docs 
  ADD COLUMN doc_type VARCHAR(50) DEFAULT 'rich_text',
  ADD COLUMN file_metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN storage_path VARCHAR(500),
  ADD COLUMN processing_status VARCHAR(50) DEFAULT 'ready',
  ADD COLUMN file_size BIGINT,
  ADD COLUMN mime_type VARCHAR(100);

-- Add constraints
ALTER TABLE docs 
  ADD CONSTRAINT docs_doc_type_check 
  CHECK (doc_type IN ('rich_text', 'pdf', 'docx', 'pptx', 'xlsx'));

ALTER TABLE docs 
  ADD CONSTRAINT docs_processing_status_check 
  CHECK (processing_status IN ('uploading', 'processing', 'ready', 'error'));
```

### 2. Create Processing Jobs Table

```sql
CREATE TABLE doc_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id VARCHAR(50) NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  job_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3. Create Indexes

```sql
CREATE INDEX idx_docs_doc_type ON docs(doc_type);
CREATE INDEX idx_docs_processing_status ON docs(processing_status);
CREATE INDEX idx_docs_file_metadata ON docs USING GIN(file_metadata);
CREATE INDEX idx_docs_content_fts ON docs USING GIN(to_tsvector('english', content));

CREATE INDEX idx_doc_jobs_doc_id ON doc_processing_jobs(doc_id);
CREATE INDEX idx_doc_jobs_status ON doc_processing_jobs(status);
CREATE INDEX idx_doc_jobs_created ON doc_processing_jobs(created_at);
```

### 4. Create Search Function

```sql
CREATE OR REPLACE FUNCTION search_docs(
  search_query TEXT,
  doc_types_param VARCHAR(50)[] DEFAULT NULL,
  project_id_param VARCHAR(50) DEFAULT NULL,
  limit_param INTEGER DEFAULT 20,
  offset_param INTEGER DEFAULT 0
)
RETURNS TABLE (
  id VARCHAR(50),
  title VARCHAR(255),
  doc_type VARCHAR(50),
  snippet TEXT,
  relevance REAL,
  created_at TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    d.id,
    d.title,
    d.doc_type,
    ts_headline('english', d.content, plainto_tsquery('english', search_query)) AS snippet,
    ts_rank(to_tsvector('english', d.content), plainto_tsquery('english', search_query)) AS relevance,
    d.created_at
  FROM docs d
  WHERE 
    to_tsvector('english', d.content) @@ plainto_tsquery('english', search_query)
    AND (doc_types_param IS NULL OR d.doc_type = ANY(doc_types_param))
    AND (project_id_param IS NULL OR d.project_id = project_id_param)
    AND d.processing_status = 'ready'
  ORDER BY relevance DESC, d.created_at DESC
  LIMIT limit_param
  OFFSET offset_param;
END;
$$ LANGUAGE plpgsql;
```

---

## Content Structure Examples

### PDF Content
```json
{
  "type": "pdf",
  "extractedText": "Full text content...",
  "pageCount": 10,
  "pages": [
    {
      "pageNumber": 1,
      "text": "Page 1 content...",
      "thumbnailUrl": "https://..."
    }
  ],
  "metadata": {
    "author": "John Doe",
    "created": "2024-01-15T10:00:00Z",
    "title": "Document Title"
  }
}
```

### Word Content
```json
{
  "type": "docx",
  "extractedText": "Full text content...",
  "html": "<p>Converted HTML...</p>",
  "images": [
    {
      "id": "img1",
      "url": "https://...",
      "caption": "Figure 1"
    }
  ],
  "metadata": {
    "author": "Jane Smith",
    "pageCount": 5,
    "wordCount": 1200
  }
}
```

### Excel Content
```json
{
  "type": "xlsx",
  "sheetCount": 3,
  "sheets": [
    {
      "name": "Sheet1",
      "index": 0,
      "rowCount": 100,
      "columnCount": 10,
      "headers": ["Name", "Email", "Phone"],
      "previewData": [
        ["John", "john@example.com", "555-1234"]
      ]
    }
  ],
  "metadata": {
    "author": "Alice Brown",
    "totalRows": 250
  }
}
```

### PowerPoint Content
```json
{
  "type": "pptx",
  "slideCount": 12,
  "slides": [
    {
      "index": 1,
      "title": "Introduction",
      "text": "Slide content...",
      "thumbnailUrl": "https://...",
      "notes": "Speaker notes..."
    }
  ],
  "metadata": {
    "author": "Bob Johnson",
    "theme": "Corporate"
  }
}
```

---

## Testing Checklist

### Unit Tests

- [ ] PDFProcessor.process()
- [ ] PDFProcessor.generateThumbnails()
- [ ] WordProcessor.process()
- [ ] ExcelProcessor.process()
- [ ] PowerPointProcessor.process()
- [ ] File validation functions
- [ ] Virus scanning (if enabled)

### Integration Tests

- [ ] POST /api/docs/upload (success)
- [ ] POST /api/docs/upload (invalid file type)
- [ ] POST /api/docs/upload (file too large)
- [ ] GET /api/docs/:docId/status
- [ ] GET /api/docs/:docId/preview
- [ ] GET /api/docs/:docId/download
- [ ] POST /api/docs/search (with docTypes filter)

### Frontend Tests

- [ ] DocumentUpload component renders
- [ ] File selection works
- [ ] Upload progress displays
- [ ] Error handling works
- [ ] PDFViewer renders correctly
- [ ] ExcelViewer renders sheets
- [ ] Search filters by document type

### Security Tests

- [ ] File type validation (magic bytes)
- [ ] File size limits enforced
- [ ] Malicious file rejection
- [ ] Virus scanning (if enabled)
- [ ] Rate limiting works
- [ ] Authentication required
- [ ] Authorization enforced

### Performance Tests

- [ ] Upload 10MB file < 5 seconds
- [ ] Process PDF < 30 seconds
- [ ] Process Excel < 30 seconds
- [ ] Search response < 500ms
- [ ] Concurrent uploads (10 users)
- [ ] Queue handles backlog

---

## Deployment Steps

### 1. Pre-Deployment

```bash
# Run tests
npm test

# Build application
npm run build

# Create database backup
pg_dump -h localhost -U postgres org_myorg > backup.sql
```

### 2. Deploy to Staging

```bash
# Deploy code
git push staging main

# Run migrations
npm run db:migrate

# Restart services
pm2 restart all

# Verify health
curl https://staging.leanworks.app/api/health
```

### 3. Smoke Tests

- [ ] Upload PDF document
- [ ] Upload Word document
- [ ] Upload Excel document
- [ ] Upload PowerPoint document
- [ ] Search for uploaded documents
- [ ] Download document
- [ ] Check processing status

### 4. Deploy to Production

```bash
# Enable feature flag
# Set FEATURE_DOCUMENT_UPLOAD=true

# Deploy code
git push production main

# Run migrations
npm run db:migrate

# Restart services
pm2 restart all

# Monitor logs
pm2 logs
```

### 5. Post-Deployment

- [ ] Monitor error rates
- [ ] Monitor upload success rate
- [ ] Monitor processing times
- [ ] Monitor queue depth
- [ ] Monitor storage usage
- [ ] Gather user feedback

---

## Monitoring & Alerts

### Key Metrics

1. **Upload Metrics**
   - Total uploads per hour
   - Upload success rate (target: >99%)
   - Average upload time (target: <5s)
   - Upload errors by type

2. **Processing Metrics**
   - Processing success rate (target: >95%)
   - Average processing time (target: <30s)
   - Queue depth (alert if >100)
   - Worker utilization

3. **Storage Metrics**
   - Total storage used
   - Storage by document type
   - Storage growth rate

4. **Search Metrics**
   - Search queries per hour
   - Average search time (target: <500ms)
   - Search success rate

### Alerts

Set up alerts for:
- Upload success rate < 95%
- Processing success rate < 90%
- Queue depth > 100
- Average processing time > 60s
- Storage usage > 80%
- Error rate > 5%

---

## Troubleshooting

### Common Issues

#### 1. Upload Fails
**Symptoms:** Upload returns 500 error

**Checks:**
- GCS bucket exists and is accessible
- File size within limits
- MIME type is supported
- Network connectivity to GCS

**Solution:**
```bash
# Check GCS bucket
gsutil ls gs://leanworks-prod

# Check permissions
gsutil iam get gs://leanworks-prod
```

#### 2. Processing Stuck
**Symptoms:** Documents stuck in "processing" status

**Checks:**
- Redis is running
- Workers are running
- Queue has jobs
- No errors in worker logs

**Solution:**
```bash
# Check Redis
redis-cli ping

# Check workers
pm2 list

# Check queue
redis-cli LLEN bull:document-processing:wait

# Restart workers
pm2 restart document-worker
```

#### 3. Search Not Working
**Symptoms:** Search returns no results

**Checks:**
- Full-text search index exists
- Content is being extracted
- Documents are in "ready" status

**Solution:**
```sql
-- Check index
SELECT * FROM pg_indexes WHERE tablename = 'docs';

-- Rebuild index
REINDEX INDEX idx_docs_content_fts;

-- Check document status
SELECT processing_status, COUNT(*) FROM docs GROUP BY processing_status;
```

#### 4. Thumbnails Not Generating
**Symptoms:** PDF thumbnails are missing

**Checks:**
- pdfjs-dist is installed
- Sharp is installed
- GCS upload permissions

**Solution:**
```bash
# Reinstall dependencies
npm install pdfjs-dist sharp

# Check logs
pm2 logs document-worker --lines 100
```

---

## Performance Optimization Tips

### 1. Database
- Use partial indexes for common queries
- Regularly vacuum and analyze tables
- Monitor slow queries
- Consider read replicas for search

### 2. Caching
- Cache document metadata (TTL: 1 hour)
- Cache search results (TTL: 5 minutes)
- Cache thumbnails (TTL: 24 hours)
- Use Redis for caching

### 3. Processing
- Increase worker concurrency for high load
- Use priority queues for important documents
- Implement batch processing for thumbnails
- Consider GPU acceleration for PDF rendering

### 4. Storage
- Use CDN for frequently accessed files
- Implement tiered storage (hot/cold)
- Compress thumbnails
- Deduplicate files by hash

---

## Security Best Practices

1. **File Validation**
   - Always check magic bytes, not just extension
   - Validate file size before processing
   - Sanitize filenames

2. **Virus Scanning**
   - Scan all uploads (if ClamAV is available)
   - Quarantine infected files
   - Log all scan results

3. **Access Control**
   - Verify user has access to document
   - Use signed URLs with expiration
   - Implement rate limiting

4. **Data Protection**
   - Encrypt files at rest (GCS default)
   - Use HTTPS for all transfers
   - Implement audit logging

---

## Support & Resources

### Documentation
- [Architecture Plan](./document-upload-architecture.md)
- [API Documentation](../API_DOCS.md)
- [Database Schema](../database/schema.sql)

### External Resources
- [pdf-parse Documentation](https://www.npmjs.com/package/pdf-parse)
- [mammoth Documentation](https://www.npmjs.com/package/mammoth)
- [xlsx Documentation](https://www.npmjs.com/package/xlsx)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [PostgreSQL Full-Text Search](https://www.postgresql.org/docs/current/textsearch.html)

### Team Contacts
- Backend Lead: [Name]
- Frontend Lead: [Name]
- DevOps: [Name]
- Security: [Name]
