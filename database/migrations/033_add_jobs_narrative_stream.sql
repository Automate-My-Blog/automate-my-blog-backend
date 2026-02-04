-- Migration 033: Add narrative_stream column to jobs table
-- Purpose: Store narrative events (scraping-thought, analysis-chunk, etc.) for replay on reconnect
-- Date: February 2026
-- Related: GitHub issue #157 - Website Analysis: Narrative-Driven Streaming Experience

-- narrative_stream: JSONB array of { type, content, progress?, timestamp } for SSE replay
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS narrative_stream JSONB DEFAULT '[]';

COMMENT ON COLUMN jobs.narrative_stream IS 'Narrative events for streaming UX; replayed on client reconnect';
