-- Migration: Add folder support to docs table
-- Date: 2026-01-31
-- Description: Adds folder hierarchy support by adding folder_id and is_folder columns

-- ============================================================================
-- STEP 1: Add new columns to docs table
-- ============================================================================

-- Add folder_id column to create hierarchical structure
ALTER TABLE docs
  ADD COLUMN IF NOT EXISTS folder_id VARCHAR(50) REFERENCES docs(id) ON DELETE SET NULL;

-- Add is_folder column to distinguish folders from documents
ALTER TABLE docs
  ADD COLUMN IF NOT EXISTS is_folder BOOLEAN DEFAULT false;

-- ============================================================================
-- STEP 2: Add indexes for performance
-- ============================================================================

-- Index on folder_id for efficient folder hierarchy queries
CREATE INDEX IF NOT EXISTS idx_docs_folder_id ON docs(folder_id);

-- Index on is_folder for filtering folders vs documents
CREATE INDEX IF NOT EXISTS idx_docs_is_folder ON docs(is_folder);

-- ============================================================================
-- STEP 3: Add constraints to prevent circular references
-- ============================================================================

-- Function to check for circular folder references
CREATE OR REPLACE FUNCTION check_circular_folder_reference()
RETURNS TRIGGER AS $$
DECLARE
    current_parent_id VARCHAR(50);
    current_id VARCHAR(50);
BEGIN
    -- Only check if we're setting a folder_id on a folder
    IF NEW.is_folder = true AND NEW.folder_id IS NOT NULL THEN
        -- Check if the target folder_id contains this folder (circular reference)
        SELECT folder_id INTO current_parent_id FROM docs WHERE id = NEW.folder_id;
        current_id := NEW.folder_id;

        -- Walk up the parent chain to detect cycles
        WHILE current_parent_id IS NOT NULL LOOP
            IF current_parent_id = NEW.id THEN
                RAISE EXCEPTION 'Circular folder reference detected: folder cannot contain itself';
            END IF;

            -- Move up the hierarchy
            current_id := current_parent_id;
            SELECT folder_id INTO current_parent_id FROM docs WHERE id = current_id;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to prevent circular references
DROP TRIGGER IF EXISTS prevent_circular_folder_refs ON docs;
CREATE TRIGGER prevent_circular_folder_refs
    BEFORE INSERT OR UPDATE ON docs
    FOR EACH ROW
    EXECUTE FUNCTION check_circular_folder_reference();

-- ============================================================================
-- STEP 4: Ensure folders have empty content
-- ============================================================================

-- Update any existing folders to have empty content (folders shouldn't have rich text content)
UPDATE docs
SET content = '{}'
WHERE is_folder = true AND content IS NOT NULL AND content != '{}';

-- ============================================================================
-- STEP 5: Add comments for documentation
-- ============================================================================

COMMENT ON COLUMN docs.folder_id IS 'Parent folder ID for hierarchical organization (null for root level)';
COMMENT ON COLUMN docs.is_folder IS 'Whether this document is a folder (true) or regular document (false)';