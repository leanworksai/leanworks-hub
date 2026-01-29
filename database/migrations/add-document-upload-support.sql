-- Migration: Add Document Upload Support
-- Date: 2026-01-29
-- Description: Extends docs table to support PDF, Word, PowerPoint, and Excel uploads
-- Backward compatible: All changes are additive, existing rich-text docs continue to work

-- ============================================================================
-- STEP 1: Extend docs table with new columns
-- ============================================================================

-- Add doc_type column (defaults to 'rich_text' for existing docs)
ALTER TABLE docs 
  ADD COLUMN IF NOT EXISTS doc_type VARCHAR(50) DEFAULT 'rich_text';

-- Add file_metadata column for file-specific metadata
ALTER TABLE docs 
  ADD COLUMN IF NOT EXISTS file_metadata JSONB DEFAULT '{}'::jsonb;

-- Add storage_path for GCS file location
ALTER TABLE docs 
  ADD COLUMN IF NOT EXISTS storage_path VARCHAR(500);

-- Add processing_status for async processing tracking
ALTER TABLE docs 
  ADD COLUMN IF NOT EXISTS processing_status VARCHAR(50) DEFAULT 'ready';

-- Add file_size in bytes
ALTER TABLE docs 
  ADD COLUMN IF NOT EXISTS file_size BIGINT;

-- Add mime_type
ALTER TABLE docs 
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100);

-- ============================================================================
-- STEP 2: Add constraints
-- ============================================================================

-- Constraint for doc_type
ALTER TABLE docs 
  DROP CONSTRAINT IF EXISTS docs_doc_type_check;

ALTER TABLE docs 
  ADD CONSTRAINT docs_doc_type_check 
  CHECK (doc_type IN ('rich_text', 'pdf', 'docx', 'pptx', 'xlsx'));

-- Constraint for processing_status
ALTER TABLE docs 
  DROP CONSTRAINT IF EXISTS docs_processing_status_check;

ALTER TABLE docs 
  ADD CONSTRAINT docs_processing_status_check 
  CHECK (processing_status IN ('uploading', 'processing', 'ready', 'error'));

-- ============================================================================
-- STEP 3: Create indexes for performance
-- ============================================================================

-- Index on doc_type for filtering
CREATE INDEX IF NOT EXISTS idx_docs_doc_type ON docs(doc_type);

-- Index on processing_status for status queries
CREATE INDEX IF NOT EXISTS idx_docs_processing_status ON docs(processing_status);

-- GIN index on file_metadata for JSONB queries
CREATE INDEX IF NOT EXISTS idx_docs_file_metadata ON docs USING GIN(file_metadata);

-- Full-text search index on content (for all document types)
CREATE INDEX IF NOT EXISTS idx_docs_content_fts ON docs USING GIN(to_tsvector('english', content));

-- Partial index for ready documents (most common query)
CREATE INDEX IF NOT EXISTS idx_docs_ready_created 
  ON docs(created_at DESC) 
  WHERE processing_status = 'ready';

-- Partial index for project documents that are ready
CREATE INDEX IF NOT EXISTS idx_docs_project_ready 
  ON docs(project_id, created_at DESC) 
  WHERE processing_status = 'ready';

-- ============================================================================
-- STEP 4: Create doc_processing_jobs table
-- ============================================================================

CREATE TABLE IF NOT EXISTS doc_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id VARCHAR(50) NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  job_type VARCHAR(50) NOT NULL, -- 'text_extraction', 'thumbnail_generation', 'virus_scan'
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  priority INTEGER DEFAULT 0,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for doc_processing_jobs
CREATE INDEX IF NOT EXISTS idx_doc_jobs_doc_id ON doc_processing_jobs(doc_id);
CREATE INDEX IF NOT EXISTS idx_doc_jobs_status ON doc_processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_doc_jobs_created ON doc_processing_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_doc_jobs_status_priority ON doc_processing_jobs(status, priority DESC);

-- ============================================================================
-- STEP 5: Create helper functions
-- ============================================================================

-- Function to search documents with full-text search
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

-- Function to get document statistics by type
CREATE OR REPLACE FUNCTION get_doc_stats()
RETURNS TABLE (
  doc_type VARCHAR(50),
  total_count BIGINT,
  total_size BIGINT,
  avg_size BIGINT,
  ready_count BIGINT,
  processing_count BIGINT,
  error_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    d.doc_type,
    COUNT(*) as total_count,
    COALESCE(SUM(d.file_size), 0) as total_size,
    COALESCE(AVG(d.file_size), 0)::BIGINT as avg_size,
    COUNT(CASE WHEN d.processing_status = 'ready' THEN 1 END) as ready_count,
    COUNT(CASE WHEN d.processing_status = 'processing' THEN 1 END) as processing_count,
    COUNT(CASE WHEN d.processing_status = 'error' THEN 1 END) as error_count
  FROM docs d
  GROUP BY d.doc_type;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 6: Add comments for documentation
-- ============================================================================

COMMENT ON COLUMN docs.doc_type IS 'Type of document: rich_text (default), pdf, docx, pptx, xlsx';
COMMENT ON COLUMN docs.file_metadata IS 'File-specific metadata (page count, sheets, author, etc.) stored as JSONB';
COMMENT ON COLUMN docs.storage_path IS 'GCS storage path for uploaded files (e.g., orgs/{orgSlug}/doc-files/{docId}/{fileId})';
COMMENT ON COLUMN docs.processing_status IS 'Processing status: uploading, processing, ready (default), error';
COMMENT ON COLUMN docs.file_size IS 'File size in bytes (NULL for rich_text documents)';
COMMENT ON COLUMN docs.mime_type IS 'MIME type of uploaded file (NULL for rich_text documents)';

COMMENT ON TABLE doc_processing_jobs IS 'Async processing jobs for document uploads (text extraction, thumbnails, etc.)';
COMMENT ON COLUMN doc_processing_jobs.job_type IS 'Type of processing job: text_extraction, thumbnail_generation, virus_scan';
COMMENT ON COLUMN doc_processing_jobs.status IS 'Job status: pending, processing, completed, failed';
COMMENT ON COLUMN doc_processing_jobs.priority IS 'Job priority (higher number = higher priority)';
COMMENT ON COLUMN doc_processing_jobs.retry_count IS 'Number of times this job has been retried';
COMMENT ON COLUMN doc_processing_jobs.max_retries IS 'Maximum number of retries allowed (default: 3)';

-- ============================================================================
-- STEP 7: Verify migration
-- ============================================================================

-- Check that all columns were added
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'docs' AND column_name = 'doc_type') THEN
    RAISE EXCEPTION 'Migration failed: doc_type column not added';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'docs' AND column_name = 'file_metadata') THEN
    RAISE EXCEPTION 'Migration failed: file_metadata column not added';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'doc_processing_jobs') THEN
    RAISE EXCEPTION 'Migration failed: doc_processing_jobs table not created';
  END IF;
  
  RAISE NOTICE 'Migration completed successfully!';
END $$;

-- ============================================================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================================================

-- To rollback this migration, run:
/*
-- Drop new table
DROP TABLE IF EXISTS doc_processing_jobs CASCADE;

-- Drop new indexes
DROP INDEX IF EXISTS idx_docs_doc_type;
DROP INDEX IF EXISTS idx_docs_processing_status;
DROP INDEX IF EXISTS idx_docs_file_metadata;
DROP INDEX IF EXISTS idx_docs_content_fts;
DROP INDEX IF EXISTS idx_docs_ready_created;
DROP INDEX IF EXISTS idx_docs_project_ready;

-- Drop new functions
DROP FUNCTION IF EXISTS search_docs(TEXT, VARCHAR(50)[], VARCHAR(50), INTEGER, INTEGER);
DROP FUNCTION IF EXISTS get_doc_stats();

-- Drop new columns (WARNING: This will delete data!)
ALTER TABLE docs DROP COLUMN IF EXISTS doc_type;
ALTER TABLE docs DROP COLUMN IF EXISTS file_metadata;
ALTER TABLE docs DROP COLUMN IF EXISTS storage_path;
ALTER TABLE docs DROP COLUMN IF EXISTS processing_status;
ALTER TABLE docs DROP COLUMN IF EXISTS file_size;
ALTER TABLE docs DROP COLUMN IF EXISTS mime_type;
*/
