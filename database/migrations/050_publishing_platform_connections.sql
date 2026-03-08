-- Migration 050: Third-party publishing platform connections
-- Stores one connection per user per platform (WordPress, Medium, Substack, Ghost).
-- See docs: Third-Party Publishing Services — Backend Handoff

CREATE TABLE IF NOT EXISTS publishing_platform_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('wordpress', 'medium', 'substack', 'ghost')),

    -- Encrypted payload (e.g. { site_url, application_password } for WordPress; { admin_url, admin_api_key } for Ghost)
    credentials_encrypted TEXT NOT NULL,

    -- Display-only fields (never secrets); used in GET connections response
    site_name VARCHAR(255),
    site_url VARCHAR(500),
    account VARCHAR(255),

    connected BOOLEAN DEFAULT true,
    last_checked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(user_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_publishing_platform_connections_user
    ON publishing_platform_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_publishing_platform_connections_platform
    ON publishing_platform_connections(platform);

COMMENT ON TABLE publishing_platform_connections IS 'User connections to third-party publishing platforms (WordPress, Medium, Substack, Ghost); credentials stored encrypted';
COMMENT ON COLUMN publishing_platform_connections.credentials_encrypted IS 'AES-256-GCM encrypted JSON: platform-specific credentials (e.g. site_url + application_password for WordPress)';
