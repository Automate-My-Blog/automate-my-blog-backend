-- =====================================================
-- Migration 028: Add Lead Notification Tracking
-- =====================================================
-- This migration adds notification_sent_at column to track
-- when admin alert emails were sent for leads, enabling
-- deduplication to prevent multiple emails for same domain
-- =====================================================

-- Add notification tracking column
ALTER TABLE website_leads
ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMP;

-- Add index for efficient querying
CREATE INDEX IF NOT EXISTS idx_website_leads_notification
ON website_leads(notification_sent_at)
WHERE notification_sent_at IS NOT NULL;

-- Add index for checking recent notifications by domain
CREATE INDEX IF NOT EXISTS idx_website_leads_url_notification
ON website_leads(website_url, notification_sent_at)
WHERE notification_sent_at IS NOT NULL;

-- Add comment
COMMENT ON COLUMN website_leads.notification_sent_at IS 'Timestamp when admin notification email was sent for this lead (used for deduplication)';

-- Verify migration
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'website_leads' AND column_name = 'notification_sent_at') THEN
        RAISE NOTICE '✅ website_leads.notification_sent_at column added successfully';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'website_leads' AND indexname = 'idx_website_leads_notification') THEN
        RAISE NOTICE '✅ Indexes created successfully';
    END IF;

    RAISE NOTICE '✅ Migration 028: Lead notification tracking completed successfully';
END $$;
