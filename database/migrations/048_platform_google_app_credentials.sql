-- Platform-level Google OAuth app credentials (one set per service for the whole app).
-- Encrypted at rest; set by super_admin via POST /api/v1/google/oauth/credentials with platform: true.
-- Resolution order: per-user (user_google_app_credentials) then platform (this table), then env.

CREATE TABLE IF NOT EXISTS platform_google_app_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name VARCHAR(50) NOT NULL UNIQUE CHECK (service_name IN ('google_search_console', 'google_analytics')),

    client_id_encrypted TEXT NOT NULL,
    client_secret_encrypted TEXT NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE platform_google_app_credentials IS 'Platform-wide Google OAuth app credentials for Search Console and Analytics; encrypted at rest; set by super_admin';
