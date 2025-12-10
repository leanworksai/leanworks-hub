-- Migration: Add transcription_sessions and transcription_chunks tables
-- These tables store transcription session state and processed audio chunks
-- Used by the async transcription worker architecture

-- Transcription sessions table
-- Stores session metadata and final transcripts
CREATE TABLE IF NOT EXISTS transcription_sessions (
  call_id VARCHAR(255) PRIMARY KEY,
  room_name VARCHAR(255) NOT NULL,
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'processing', 'completed', 'failed')),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  transcripts JSONB DEFAULT '{}'::jsonb, -- {participantEmail: [transcript strings]}
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcription_sessions_status ON transcription_sessions(status);
CREATE INDEX IF NOT EXISTS idx_transcription_sessions_room_name ON transcription_sessions(room_name);
CREATE INDEX IF NOT EXISTS idx_transcription_sessions_started_at ON transcription_sessions(started_at);

-- Transcription chunks table
-- Tracks individual audio chunks that have been processed
CREATE TABLE IF NOT EXISTS transcription_chunks (
  id SERIAL PRIMARY KEY,
  call_id VARCHAR(255) NOT NULL,
  participant_email VARCHAR(255) NOT NULL,
  chunk_index INTEGER NOT NULL,
  storage_url VARCHAR(500), -- GCS URL where audio chunk is stored
  processed_at TIMESTAMP,
  transcript TEXT,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (call_id) REFERENCES transcription_sessions(call_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transcription_chunks_call_id ON transcription_chunks(call_id);
CREATE INDEX IF NOT EXISTS idx_transcription_chunks_participant ON transcription_chunks(call_id, participant_email);
CREATE INDEX IF NOT EXISTS idx_transcription_chunks_processed ON transcription_chunks(processed_at);

-- Add updated_at trigger for transcription_sessions
CREATE OR REPLACE FUNCTION update_transcription_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transcription_sessions_updated_at ON transcription_sessions;
CREATE TRIGGER transcription_sessions_updated_at
  BEFORE UPDATE ON transcription_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_transcription_sessions_updated_at();

