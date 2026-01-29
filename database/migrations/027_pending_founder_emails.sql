-- =====================================================
-- Migration 027: Pending Founder Emails Table
-- =====================================================
-- This migration creates a table to store LLM-generated email drafts
-- for founder welcome emails that James reviews and manually sends
-- =====================================================

-- Table to store LLM-generated email drafts pending James's review
CREATE TABLE IF NOT EXISTS pending_founder_emails (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    recipient_email VARCHAR(255) NOT NULL,
    recipient_name VARCHAR(255),

    -- LLM-generated content
    subject VARCHAR(500),
    body_html TEXT,
    body_plain_text TEXT,

    -- Context used for generation
    user_context JSONB,
    has_generated_post BOOLEAN DEFAULT FALSE,
    post_title VARCHAR(500),

    -- Status tracking
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'sent', 'dismissed')),
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP,
    sent_at TIMESTAMP,

    -- Notification tracking
    notification_sent_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pending_founder_emails_user_id ON pending_founder_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_founder_emails_status ON pending_founder_emails(status);
CREATE INDEX IF NOT EXISTS idx_pending_founder_emails_generated_at ON pending_founder_emails(generated_at);

-- Comments
COMMENT ON TABLE pending_founder_emails IS 'LLM-generated founder welcome emails pending manual review and send by James';
COMMENT ON COLUMN pending_founder_emails.status IS 'pending=awaiting review, reviewed=James looked at it, sent=James sent it, dismissed=skipped';
COMMENT ON COLUMN pending_founder_emails.user_context IS 'Full context snapshot used for LLM generation (for reference)';

-- Verify migration
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pending_founder_emails') THEN
        RAISE NOTICE '✅ pending_founder_emails table created successfully';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'pending_founder_emails' AND indexname = 'idx_pending_founder_emails_user_id') THEN
        RAISE NOTICE '✅ Indexes created successfully';
    END IF;

    RAISE NOTICE '✅ Migration 027: Pending Founder Emails completed successfully';
END $$;
