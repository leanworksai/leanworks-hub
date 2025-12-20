-- Migration script to add metadata column to docs table
-- Run this script to add the metadata column if it doesn't exist

-- Add metadata column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'docs' 
        AND column_name = 'metadata'
    ) THEN
        ALTER TABLE docs ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
        RAISE NOTICE 'Added metadata column to docs table';
    ELSE
        RAISE NOTICE 'metadata column already exists in docs table';
    END IF;
END $$;

