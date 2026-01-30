-- Migration 26: Jobs table for async queue (website_analysis, content_generation)
-- Purpose: Persist job metadata, status, progress, and results for polling and retry
-- Date: January 2026
-- Dependencies: organizations, users

-- Jobs table: queue jobs with tenant/user isolation
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id VARCHAR(255),

    type VARCHAR(50) NOT NULL CHECK (type IN ('website_analysis', 'content_generation')),
    status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    current_step VARCHAR(255),
    estimated_seconds_remaining INTEGER,

    input JSONB NOT NULL DEFAULT '{}',
    result JSONB,
    error TEXT,
    error_code VARCHAR(100),

    cancelled_at TIMESTAMP,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    CONSTRAINT chk_jobs_owner CHECK (
        user_id IS NOT NULL OR session_id IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_jobs_tenant_id ON jobs(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_session_id ON jobs(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);

COMMENT ON TABLE jobs IS 'Async job queue metadata for website_analysis and content_generation';
COMMENT ON COLUMN jobs.tenant_id IS 'Organization ID when available (e.g. after analysis or from content-gen payload)';
COMMENT ON COLUMN jobs.session_id IS 'Anonymous session for website_analysis before login';
