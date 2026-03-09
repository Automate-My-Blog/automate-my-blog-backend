-- Migration 053: Project settings (strategy UX) — Issue #6
-- Persisted settings for project-settings/strategy UX: audienceSegment, seoStrategy, contentTone, ctaGoals, defaultTemplate.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN projects.settings IS 'Project-level strategy settings: audienceSegment, seoStrategy, contentTone, ctaGoals, defaultTemplate (see GET/PUT /api/v1/projects/:id/settings)';
