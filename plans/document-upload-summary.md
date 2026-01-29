# Document Upload Feature - Executive Summary

**Feature:** Support for PDF, PowerPoint, Word, and Excel document uploads  
**Status:** Planning Complete  
**Estimated Timeline:** 6-9 weeks  
**Estimated Cost:** $220-450/month infrastructure

---

## Overview

This feature adds comprehensive support for uploading and managing PDF, Word, PowerPoint, and Excel documents within the Leanworks Hub platform. Documents will be stored, processed, indexed, and made searchable alongside existing rich-text documents.

## Key Benefits

1. **Unified Document Management** - All document types in one place
2. **Full-Text Search** - Search across all document types
3. **Automatic Processing** - Extract text, generate thumbnails, index content
4. **Scalable Architecture** - Async processing with job queues
5. **Secure** - File validation, virus scanning, access control
6. **User-Friendly** - Drag-and-drop upload, progress tracking, preview

## Architecture Approach

### Hybrid Database Design
- **Single [`docs`](../database/schema.sql:416) table** with JSONB content field
- **Backward compatible** with existing rich-text documents
- **Extensible** for future document types
- **Performant** with PostgreSQL JSONB and full-text search

### Async Processing Pipeline
```
Upload → GCS Storage → Job Queue → Worker Pool → Extract & Index → Ready
```

### Technology Stack
- **Storage:** Google Cloud Storage (existing)
- **Queue:** BullMQ + Redis
- **Processing:** pdf-parse, mammoth, xlsx, pdfjs-dist
- **Search:** PostgreSQL full-text search
- **Caching:** Redis

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- Database schema changes
- Install dependencies
- Set up Redis and job queue
- Implement base processor architecture

### Phase 2: Processing (Week 2-3)
- Implement PDF processor
- Implement Word processor
- Implement PowerPoint processor
- Implement Excel processor
- Add security validation

### Phase 3: API (Week 3-4)
- Upload endpoint
- Status polling endpoint
- Preview endpoint
- Download endpoint
- Enhanced search

### Phase 4: Frontend (Week 4-5)
- Upload component
- Document viewer
- Type-specific viewers
- Update existing components

### Phase 5: Testing (Week 5-6)
- Unit tests
- Integration tests
- Security tests
- Performance tests

### Phase 6: Deployment (Week 6)
- Staging deployment
- UAT
- Production deployment
- Monitoring

## Database Schema Changes

### New Columns in [`docs`](../database/schema.sql:416) Table
- `doc_type` - Document type (rich_text, pdf, docx, pptx, xlsx)
- `file_metadata` - JSONB field for file-specific metadata
- `storage_path` - GCS storage path
- `processing_status` - Processing status (uploading, processing, ready, error)
- `file_size` - File size in bytes
- `mime_type` - MIME type

### New Table: `doc_processing_jobs`
- Tracks async processing jobs
- Supports retries and error handling
- Enables status polling

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/docs/upload` | POST | Upload document |
| `/api/docs/:id/status` | GET | Get processing status |
| `/api/docs/:id/preview` | GET | Get document preview |
| `/api/docs/:id/download` | GET | Download document |
| `/api/docs/search` | POST | Search documents (enhanced) |

## Content Structure

Each document type has a specific JSON structure stored in the `content` field:

- **PDF:** Extracted text, page count, thumbnails, metadata
- **Word:** Extracted text, HTML, images, metadata
- **PowerPoint:** Slides, thumbnails, notes, metadata
- **Excel:** Sheets, data preview, formulas, metadata

## Security Features

1. **File Validation**
   - MIME type checking
   - Magic bytes verification
   - File size limits (50MB)
   - Extension validation

2. **Virus Scanning** (Optional)
   - ClamAV integration
   - Automatic quarantine

3. **Access Control**
   - Authentication required
   - Authorization checks
   - Signed URLs with expiration

4. **Rate Limiting**
   - 20 uploads per 15 minutes per user
   - Prevents abuse

## Performance Targets

| Metric | Target |
|--------|--------|
| Upload Success Rate | >99% |
| Processing Success Rate | >95% |
| Average Upload Time | <5 seconds |
| Average Processing Time | <30 seconds |
| Search Response Time | <500ms |
| Queue Depth | <100 jobs |

## Cost Breakdown

### Infrastructure (Monthly)
- Redis: $20-50
- GCS Storage: $50-100 (2-5TB)
- GCS Bandwidth: $50-100
- Compute (Workers): $100-200
- **Total:** $220-450/month

### Development
- Backend: 3-4 weeks
- Frontend: 2-3 weeks
- Testing: 1-2 weeks
- **Total:** 6-9 weeks

## Risk Mitigation

1. **Backward Compatibility**
   - Schema changes are additive
   - Existing docs continue to work
   - Feature flag for gradual rollout

2. **Rollback Plan**
   - Database backup before migration
   - Ability to disable processing workers
   - Revert deployment if needed

3. **Scalability**
   - Horizontal scaling of workers
   - Queue-based architecture
   - Caching layer

4. **Security**
   - Multiple validation layers
   - Virus scanning
   - Audit logging

## Success Metrics

1. **Adoption:** 50% of users upload at least one document in first month
2. **Reliability:** >99% upload success rate
3. **Performance:** <30s average processing time
4. **User Satisfaction:** >4.5/5 rating

## Next Steps

1. **Review & Approve** this plan
2. **Set up environment** (Redis, dependencies)
3. **Begin Phase 1** (database schema)
4. **Iterative development** following the checklist

## Documentation

- **[Architecture Plan](./document-upload-architecture.md)** - Comprehensive technical details
- **[Implementation Guide](./document-upload-implementation-guide.md)** - Developer quick reference
- **[Implementation Checklist](./document-upload-implementation-guide.md#implementation-checklist-by-component)** - Step-by-step tasks

## Questions & Feedback

Please review the detailed architecture plan and provide feedback on:
1. Technology choices (BullMQ, Redis, processing libraries)
2. Database schema design (hybrid approach)
3. Timeline and resource allocation
4. Security requirements
5. Performance targets
6. Any concerns or suggestions

---

**Status:** ✅ Planning Complete - Ready for Review  
**Next Action:** Review and approve to begin implementation
