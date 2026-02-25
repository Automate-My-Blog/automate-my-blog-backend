-- Self-serve Google OAuth: store per-user OAuth app credentials (client_id, client_secret)
-- for Search Console and Analytics so users can complete setup without admin-provided env vars.
-- Credentials are encrypted at rest; never log or expose client_secret.

CREATE TABLE IF NOT EXISTS user_google_app_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_name VARCHAR(50) NOT NULL CHECK (service_name IN ('google_search_console', 'google_analytics')),

    -- Encrypted at rest (same scheme as oauth-manager)
    client_id_encrypted TEXT NOT NULL,
    client_secret_encrypted TEXT NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(user_id, service_name)
);

CREATE INDEX idx_user_google_app_credentials_user_service ON user_google_app_credentials(user_id, service_name);

COMMENT ON TABLE user_google_app_credentials IS 'Per-user Google OAuth app credentials for self-serve Search Console and Analytics; encrypted at rest';
