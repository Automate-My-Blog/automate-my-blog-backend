-- Store encrypted OAuth tokens for third-party service integrations
CREATE TABLE IF NOT EXISTS user_oauth_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_name VARCHAR(50) NOT NULL, -- 'google_trends', 'google_search_console', 'google_analytics'

    -- OAuth Tokens (encrypted at rest)
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT NOT NULL,
    token_type VARCHAR(20) DEFAULT 'Bearer',
    expires_at TIMESTAMP NOT NULL,

    -- OAuth Scopes
    scopes JSONB NOT NULL, -- ["https://www.googleapis.com/auth/analytics.readonly"]

    -- Service-Specific Config
    service_config JSONB, -- {property_id: "...", site_url: "..."} for GA/GSC

    -- Status
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'error')),
    last_used_at TIMESTAMP,
    last_refreshed_at TIMESTAMP,
    error_message TEXT,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- One active credential per service per user
    UNIQUE(user_id, service_name)
);

-- Indexes for performance
CREATE INDEX idx_user_oauth_credentials_user_service ON user_oauth_credentials(user_id, service_name);
CREATE INDEX idx_user_oauth_credentials_status ON user_oauth_credentials(status);
CREATE INDEX idx_user_oauth_credentials_expires ON user_oauth_credentials(expires_at);

-- Audit log for credential access
CREATE TABLE IF NOT EXISTS oauth_credential_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credential_id UUID REFERENCES user_oauth_credentials(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- 'accessed', 'refreshed', 'revoked'
    ip_address VARCHAR(45),
    user_agent TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE user_oauth_credentials IS 'Encrypted OAuth tokens for third-party integrations';
COMMENT ON COLUMN user_oauth_credentials.access_token_encrypted IS 'AES-256 encrypted access token';
