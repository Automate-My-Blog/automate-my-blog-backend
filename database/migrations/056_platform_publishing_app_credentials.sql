-- Platform-level OAuth app credentials for publishing (Medium, Shopify, Webflow, etc.).
-- Encrypted at rest; set by super_admin via POST /api/v1/publishing-platforms/oauth/credentials.
-- Resolution order: this table first, then env vars (MEDIUM_CLIENT_ID, etc.).

CREATE TABLE IF NOT EXISTS platform_publishing_app_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_key VARCHAR(50) NOT NULL UNIQUE,

    client_id_encrypted TEXT NOT NULL,
    client_secret_encrypted TEXT NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE platform_publishing_app_credentials IS 'Platform-wide OAuth app credentials for publishing (medium, shopify, webflow, etc.); encrypted at rest; set by super_admin';
