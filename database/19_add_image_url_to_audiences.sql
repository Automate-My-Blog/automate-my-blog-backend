-- Migration: Add image_url column to audiences table
-- Purpose: Store DALL-E generated image URLs for audience visual representation
-- Date: 2026-01-20

ALTER TABLE audiences
ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMENT ON COLUMN audiences.image_url IS 'DALL-E generated image URL for visual representation of the audience problem/scenario';
