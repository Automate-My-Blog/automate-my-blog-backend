/**
 * Third-party publishing platform connections (WordPress, Medium, Substack, Ghost).
 * List, connect, disconnect. All endpoints require JWT except Medium OAuth callback.
 * @see docs: Third-Party Publishing Services — Backend Handoff
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../services/database.js';
import oauthManager from '../services/oauth-manager.js';
import { PLATFORM_KEYS, PLATFORM_LABELS, OAUTH_ONLY_PLATFORMS, normalizePlatformKey } from '../lib/publishing-platforms.js';

const router = express.Router();

const MEDIUM_AUTH_URL = 'https://medium.com/m/oauth/authorize';
const MEDIUM_TOKEN_URL = 'https://api.medium.com/v1/tokens';
const MEDIUM_SCOPES = 'basicProfile,publishPost';

function getMediumRedirectUri() {
  const uri = (process.env.MEDIUM_REDIRECT_URI || '').trim();
  if (uri) return uri.replace(/\?.*$/, '');
  const base = (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) || process.env.BACKEND_URL || process.env.API_URL;
  return base ? `${base.replace(/\/+$/, '')}/api/v1/publishing-platforms/medium/callback` : '';
}

const SHOPIFY_SCOPES = 'read_content,write_content';

function getShopifyRedirectUri() {
  const uri = (process.env.SHOPIFY_REDIRECT_URI || '').trim();
  if (uri) return uri.replace(/\?.*$/, '');
  const base = (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) || process.env.BACKEND_URL || process.env.API_URL;
  return base ? `${base.replace(/\/+$/, '')}/api/v1/publishing-platforms/shopify/callback` : '';
}

function normalizeShopDomain(shop) {
  const s = String(shop).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.myshopify\.com$/.test(s)) return s;
  if (/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(s)) return `${s}.myshopify.com`;
  return null;
}

/** Base URL for OAuth redirect URIs (no trailing slash). */
function getOAuthBaseUrl() {
  const base = (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) || process.env.BACKEND_URL || process.env.API_URL;
  return base ? base.replace(/\/+$/, '') : '';
}

/** Redirect URI for a given OAuth platform callback. */
function getOAuthRedirectUri(platformKey) {
  const uri = (process.env[`${platformKey.toUpperCase().replace(/-/g, '_')}_REDIRECT_URI`] || '').trim();
  if (uri) return uri.replace(/\?.*$/, '');
  const base = getOAuthBaseUrl();
  return base ? `${base}/api/v1/publishing-platforms/${platformKey}/callback` : '';
}

const FRONTEND_BASE = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
const SUCCESS_REDIRECT = (platform) => `${FRONTEND_BASE()}/settings?publishing=connected&platform=${platform}`;
const ERROR_REDIRECT = (message) => `${FRONTEND_BASE()}/settings?publishing=error&message=${encodeURIComponent(message)}`;

/** Env var names per platform for fallback when no credentials in store. */
const PUBLISHING_APP_ENV_KEYS = {
  medium: ['MEDIUM_CLIENT_ID', 'MEDIUM_CLIENT_SECRET'],
  shopify: ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'],
  webflow: ['WEBFLOW_CLIENT_ID', 'WEBFLOW_CLIENT_SECRET'],
  squarespace: ['SQUARESPACE_CLIENT_ID', 'SQUARESPACE_CLIENT_SECRET'],
  wix: ['WIX_APP_ID', 'WIX_APP_SECRET'],
  hubspot: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET'],
  drupal: ['DRUPAL_CLIENT_ID', 'DRUPAL_CLIENT_SECRET']
};

/** Resolve OAuth app credentials: encrypted store first, then env. Returns { clientId, clientSecret } or null. */
async function getPublishingAppCredentials(platformKey) {
  const stored = await oauthManager.getPlatformPublishingAppCredentials(platformKey);
  if (stored?.client_id && stored?.client_secret) {
    return { clientId: stored.client_id, clientSecret: stored.client_secret };
  }
  const keys = PUBLISHING_APP_ENV_KEYS[platformKey];
  if (!keys) return null;
  const [idKey, secretKey] = keys;
  const clientId = process.env[idKey];
  const clientSecret = process.env[secretKey];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function requireAuth(req, res, next) {
  if (!req.user?.userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Publishing connection endpoints require a logged-in user. Use Authorization: Bearer <token>.'
    });
  }
  next();
}

function normalizePlatform(platform) {
  return normalizePlatformKey(platform);
}

/** GET /connections — list all 16 platforms with connected true/false for the current user */
router.get('/connections', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await db.query(
      `SELECT platform, site_name, site_url, account, connected
       FROM publishing_platform_connections
       WHERE user_id = $1 AND connected = true
       ORDER BY platform`,
      [userId]
    );
    const byPlatform = new Map(result.rows.map((row) => [row.platform, row]));
    const connections = [...PLATFORM_KEYS].sort().map((platform) => {
      const row = byPlatform.get(platform);
      return {
        platform,
        label: PLATFORM_LABELS[platform] || platform,
        connected: !!row,
        site_name: row?.site_name || undefined,
        site_url: row?.site_url || undefined,
        account: row?.account || undefined
      };
    });
    res.json({ connections });
  } catch (err) {
    console.error('List publishing connections failed:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to list connections',
      message: err.message
    });
  }
});

/** Allowed platform keys for storing OAuth app credentials (super_admin only). */
const PUBLISHING_OAUTH_CREDENTIAL_PLATFORMS = ['medium', 'shopify', 'webflow', 'squarespace', 'wix', 'hubspot', 'drupal'];

/**
 * POST /oauth/credentials — store OAuth app credentials for a publishing platform (super_admin only).
 * Body: { platform, client_id, client_secret }. Credentials are stored encrypted; no env vars required.
 */
router.post('/oauth/credentials', requireAuth, async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only super_admin can set platform OAuth credentials.'
      });
    }
    const { platform: rawPlatform, client_id: clientId, client_secret: clientSecret } = req.body || {};
    const platform = normalizePlatform(rawPlatform);
    if (!platform || !PUBLISHING_OAUTH_CREDENTIAL_PLATFORMS.includes(platform)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid platform',
        message: `platform must be one of: ${PUBLISHING_OAUTH_CREDENTIAL_PLATFORMS.join(', ')}`
      });
    }
    if (!clientId || typeof clientId !== 'string' || !clientId.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Missing client_id',
        message: 'client_id is required'
      });
    }
    if (!clientSecret || typeof clientSecret !== 'string' || !clientSecret.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Missing client_secret',
        message: 'client_secret is required'
      });
    }
    await oauthManager.storePlatformPublishingAppCredentials(platform, clientId.trim(), clientSecret.trim());
    res.json({ success: true, platform });
  } catch (err) {
    if (err.message && err.message.includes('OAUTH_ENCRYPTION_KEY')) {
      return res.status(503).json({
        success: false,
        error: 'Service unavailable',
        message: 'Encryption key not configured. Contact support.'
      });
    }
    console.error('Store publishing OAuth credentials failed:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to store credentials',
      message: err.message
    });
  }
});

/** POST /connect — add or update a platform connection (credentials or OAuth start) */
router.post('/connect', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { platform: rawPlatform, ...rest } = req.body || {};
    const platform = normalizePlatform(rawPlatform);

    if (!platform) {
      return res.status(400).json({
        success: false,
        error: 'Invalid platform',
        message: `Unknown platform. Supported: ${[...PLATFORM_KEYS].join(', ')}`
      });
    }

    if (platform === 'wordpress') {
      const { site_url, username, application_password } = rest;
      if (!site_url || typeof application_password !== 'string' || !application_password.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'WordPress connection requires site_url and application_password. Include username for publishing.'
        });
      }
      const wpUsername = typeof username === 'string' && username.trim() ? username.trim() : null;
      const url = String(site_url).trim().replace(/\/+$/, '');
      const credentialsEncrypted = oauthManager.encryptToken(
        JSON.stringify({
          site_url: url,
          username: wpUsername,
          application_password: application_password.trim()
        })
      );
      await db.query(
        `INSERT INTO publishing_platform_connections
         (user_id, platform, credentials_encrypted, site_url, connected, updated_at)
         VALUES ($1, $2, $3, $4, true, NOW())
         ON CONFLICT (user_id, platform)
         DO UPDATE SET
           credentials_encrypted = EXCLUDED.credentials_encrypted,
           site_url = EXCLUDED.site_url,
           connected = true,
           updated_at = NOW()`,
        [userId, platform, credentialsEncrypted, url]
      );
      return res.json({ success: true, platform });
    }

    if (platform === 'ghost') {
      const { admin_url, admin_api_key } = rest;
      if (!admin_url || typeof admin_api_key !== 'string' || !admin_api_key.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'Ghost connection requires admin_url and admin_api_key'
        });
      }
      const url = String(admin_url).trim().replace(/\/+$/, '');
      const credentialsEncrypted = oauthManager.encryptToken(
        JSON.stringify({ admin_url: url, admin_api_key: admin_api_key.trim() })
      );
      await db.query(
        `INSERT INTO publishing_platform_connections
         (user_id, platform, credentials_encrypted, site_url, connected, updated_at)
         VALUES ($1, $2, $3, $4, true, NOW())
         ON CONFLICT (user_id, platform)
         DO UPDATE SET
           credentials_encrypted = EXCLUDED.credentials_encrypted,
           site_url = EXCLUDED.site_url,
           connected = true,
           updated_at = NOW()`,
        [userId, platform, credentialsEncrypted, url]
      );
      return res.json({ success: true, platform });
    }

    if (platform === 'medium') {
      const creds = await getPublishingAppCredentials('medium');
      const redirectUri = getMediumRedirectUri();
      if (!creds?.clientId || !creds?.clientSecret) {
        return res.status(503).json({
          success: false,
          error: 'Service unavailable',
          message: 'Medium OAuth is not configured. Add credentials via POST /api/v1/publishing-platforms/oauth/credentials (super_admin) or set MEDIUM_CLIENT_ID and MEDIUM_CLIENT_SECRET.'
        });
      }
      if (!redirectUri) {
        return res.status(503).json({
          success: false,
          error: 'Service unavailable',
          message: 'Medium redirect URI not set. Set MEDIUM_REDIRECT_URI or BACKEND_URL.'
        });
      }
      const state = jwt.sign(
        { userId, platform: 'medium', nonce: crypto.randomUUID() },
        process.env.JWT_SECRET || 'fallback-secret-for-development',
        { expiresIn: '600s' }
      );
      const authUrl = new URL(MEDIUM_AUTH_URL);
      authUrl.searchParams.set('client_id', creds.clientId);
      authUrl.searchParams.set('scope', MEDIUM_SCOPES);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      return res.json({
        success: true,
        authorization_url: authUrl.toString(),
        state
      });
    }

    if (platform === 'substack') {
      const { api_key, publication_url } = rest;
      if (!api_key || typeof api_key !== 'string' || !api_key.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'Substack connection requires api_key (from https://auth.substackapi.dev/)'
        });
      }
      const pubUrl = publication_url && String(publication_url).trim();
      const credentialsEncrypted = oauthManager.encryptToken(
        JSON.stringify({ api_key: api_key.trim(), publication_url: pubUrl || null })
      );
      await db.query(
        `INSERT INTO publishing_platform_connections
         (user_id, platform, credentials_encrypted, site_url, account, connected, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, NOW())
         ON CONFLICT (user_id, platform)
         DO UPDATE SET
           credentials_encrypted = EXCLUDED.credentials_encrypted,
           site_url = EXCLUDED.site_url,
           account = EXCLUDED.account,
           connected = true,
           updated_at = NOW()`,
        [userId, platform, credentialsEncrypted, pubUrl || null, pubUrl || 'Substack']
      );
      return res.json({ success: true, platform });
    }

    if (platform === 'contentful') {
      const { space_id, environment_id, management_token } = rest;
      if (!space_id || typeof management_token !== 'string' || !management_token.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'Contentful connection requires space_id and management_token'
        });
      }
      const envId = environment_id && String(environment_id).trim() ? String(environment_id).trim() : 'master';
      const credentialsEncrypted = oauthManager.encryptToken(
        JSON.stringify({ space_id: String(space_id).trim(), environment_id: envId, management_token: management_token.trim() })
      );
      const siteUrl = `https://app.contentful.com/spaces/${String(space_id).trim()}`;
      await db.query(
        `INSERT INTO publishing_platform_connections
         (user_id, platform, credentials_encrypted, site_url, connected, updated_at)
         VALUES ($1, $2, $3, $4, true, NOW())
         ON CONFLICT (user_id, platform)
         DO UPDATE SET
           credentials_encrypted = EXCLUDED.credentials_encrypted,
           site_url = EXCLUDED.site_url,
           connected = true,
           updated_at = NOW()`,
        [userId, platform, credentialsEncrypted, siteUrl]
      );
      return res.json({ success: true, platform });
    }

    if (platform === 'sanity') {
      const { project_id, dataset, api_token } = rest;
      if (!api_token || typeof api_token !== 'string' || !api_token.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'Sanity connection requires api_token'
        });
      }
      const projectId = project_id && String(project_id).trim() ? String(project_id).trim() : null;
      const datasetId = dataset && String(dataset).trim() ? String(dataset).trim() : 'production';
      const credentialsEncrypted = oauthManager.encryptToken(
        JSON.stringify({ project_id: projectId, dataset: datasetId, api_token: api_token.trim() })
      );
      const siteUrl = projectId ? `https://app.sanity.io/project/${projectId}` : null;
      await db.query(
        `INSERT INTO publishing_platform_connections
         (user_id, platform, credentials_encrypted, site_url, connected, updated_at)
         VALUES ($1, $2, $3, $4, true, NOW())
         ON CONFLICT (user_id, platform)
         DO UPDATE SET
           credentials_encrypted = EXCLUDED.credentials_encrypted,
           site_url = EXCLUDED.site_url,
           connected = true,
           updated_at = NOW()`,
        [userId, platform, credentialsEncrypted, siteUrl]
      );
      return res.json({ success: true, platform });
    }

    if (platform === 'jekyll') {
      const { repository_url, access_token, branch, posts_path } = rest;
      if (!repository_url || typeof access_token !== 'string' || !access_token.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'Jekyll connection requires repository_url and access_token'
        });
      }
      const repoUrl = String(repository_url).trim().replace(/\/+$/, '');
      const credentialsEncrypted = oauthManager.encryptToken(
        JSON.stringify({
          repository_url: repoUrl,
          access_token: access_token.trim(),
          branch: branch && String(branch).trim() ? String(branch).trim() : 'main',
          posts_path: posts_path && String(posts_path).trim() ? String(posts_path).trim() : '_posts'
        })
      );
      await db.query(
        `INSERT INTO publishing_platform_connections
         (user_id, platform, credentials_encrypted, site_url, connected, updated_at)
         VALUES ($1, $2, $3, $4, true, NOW())
         ON CONFLICT (user_id, platform)
         DO UPDATE SET
           credentials_encrypted = EXCLUDED.credentials_encrypted,
           site_url = EXCLUDED.site_url,
           connected = true,
           updated_at = NOW()`,
        [userId, platform, credentialsEncrypted, repoUrl]
      );
      return res.json({ success: true, platform });
    }

    if (platform === 'nextjs') {
      const { repository_url, access_token, branch, content_path } = rest;
      if (!repository_url || typeof access_token !== 'string' || !access_token.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'Next.js connection requires repository_url and access_token'
        });
      }
      const repoUrl = String(repository_url).trim().replace(/\/+$/, '');
      const credentialsEncrypted = oauthManager.encryptToken(
        JSON.stringify({
          repository_url: repoUrl,
          access_token: access_token.trim(),
          branch: branch && String(branch).trim() ? String(branch).trim() : 'main',
          content_path: content_path && String(content_path).trim() ? String(content_path).trim() : 'content'
        })
      );
      await db.query(
        `INSERT INTO publishing_platform_connections
         (user_id, platform, credentials_encrypted, site_url, connected, updated_at)
         VALUES ($1, $2, $3, $4, true, NOW())
         ON CONFLICT (user_id, platform)
         DO UPDATE SET
           credentials_encrypted = EXCLUDED.credentials_encrypted,
           site_url = EXCLUDED.site_url,
           connected = true,
           updated_at = NOW()`,
        [userId, platform, credentialsEncrypted, repoUrl]
      );
      return res.json({ success: true, platform });
    }

    // Shopify: OAuth requires shop domain to build authorize URL. Frontend should send { platform: 'shopify', shop: 'store.myshopify.com' } or shop name only.
    if (platform === 'shopify') {
      const { shop: rawShop } = rest;
      const shop = normalizeShopDomain(rawShop);
      if (!shop) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'Shopify connection requires shop (e.g. your-store.myshopify.com or your-store).'
        });
      }
      const clientId = process.env.SHOPIFY_CLIENT_ID;
      const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
      const redirectUri = getShopifyRedirectUri();
      if (!clientId || !clientSecret) {
        return res.status(503).json({
          success: false,
          error: 'Service unavailable',
          message: 'Shopify OAuth is not configured (SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET).'
        });
      }
      if (!redirectUri) {
        return res.status(503).json({
          success: false,
          error: 'Service unavailable',
          message: 'Shopify redirect URI not set. Set SHOPIFY_REDIRECT_URI or BACKEND_URL.'
        });
      }
      const state = jwt.sign(
        { userId, platform: 'shopify', shop, nonce: crypto.randomUUID() },
        process.env.JWT_SECRET || 'fallback-secret-for-development',
        { expiresIn: '600s' }
      );
      const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('scope', SHOPIFY_SCOPES);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', state);
      return res.json({
        success: true,
        authorization_url: authUrl.toString(),
        state
      });
    }

    // Webflow: OAuth 2.0, body { platform: 'webflow' }
    if (platform === 'webflow') {
      const clientId = process.env.WEBFLOW_CLIENT_ID;
      const clientSecret = process.env.WEBFLOW_CLIENT_SECRET;
      const redirectUri = getOAuthRedirectUri('webflow');
      const scopes = (process.env.WEBFLOW_SCOPES || 'sites:read,cms:read,cms:write').trim();
      if (!clientId || !clientSecret) {
        return res.status(503).json({ success: false, error: 'Service unavailable', message: 'Webflow OAuth is not configured (WEBFLOW_CLIENT_ID, WEBFLOW_CLIENT_SECRET).' });
      }
      if (!redirectUri) {
        return res.status(503).json({ success: false, error: 'Service unavailable', message: 'Webflow redirect URI not set. Set BACKEND_URL or WEBFLOW_REDIRECT_URI.' });
      }
      const state = jwt.sign(
        { userId, platform: 'webflow', nonce: crypto.randomUUID() },
        process.env.JWT_SECRET || 'fallback-secret-for-development',
        { expiresIn: '600s' }
      );
      const authUrl = new URL('https://webflow.com/oauth/authorize');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', scopes);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', state);
      return res.json({ success: true, authorization_url: authUrl.toString(), state });
    }

    // Squarespace: OAuth 2.0, body { platform: 'squarespace' }
    if (platform === 'squarespace') {
      const clientId = process.env.SQUARESPACE_CLIENT_ID;
      const clientSecret = process.env.SQUARESPACE_CLIENT_SECRET;
      const redirectUri = getOAuthRedirectUri('squarespace');
      if (!clientId || !clientSecret) {
        return res.status(503).json({ success: false, error: 'Service unavailable', message: 'Squarespace OAuth is not configured (SQUARESPACE_CLIENT_ID, SQUARESPACE_CLIENT_SECRET).' });
      }
      if (!redirectUri) {
        return res.status(503).json({ success: false, error: 'Service unavailable', message: 'Squarespace redirect URI not set. Set BACKEND_URL or SQUARESPACE_REDIRECT_URI.' });
      }
      const state = jwt.sign(
        { userId, platform: 'squarespace', nonce: crypto.randomUUID() },
        process.env.JWT_SECRET || 'fallback-secret-for-development',
        { expiresIn: '600s' }
      );
      const authUrl = new URL('https://login.squarespace.com/api/1/login/oauth/provider/authorize');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('state', state);
      return res.json({ success: true, authorization_url: authUrl.toString(), state });
    }

    // Wix: OAuth, body { platform: 'wix' }. Requires WIX_APP_ID and WIX_APP_SECRET.
    if (platform === 'wix') {
      const appId = process.env.WIX_APP_ID;
      const appSecret = process.env.WIX_APP_SECRET;
      const redirectUri = getOAuthRedirectUri('wix');
      if (!appId || !appSecret) {
        return res.status(503).json({ success: false, error: 'Service unavailable', message: 'Wix OAuth is not configured (WIX_APP_ID, WIX_APP_SECRET).' });
      }
      if (!redirectUri) {
        return res.status(503).json({ success: false, error: 'Service unavailable', message: 'Wix redirect URI not set. Set BACKEND_URL or WIX_REDIRECT_URI.' });
      }
      const state = jwt.sign(
        { userId, platform: 'wix', nonce: crypto.randomUUID() },
        process.env.JWT_SECRET || 'fallback-secret-for-development',
        { expiresIn: '600s' }
      );
      const authUrl = new URL('https://www.wix.com/installer/install');
      authUrl.searchParams.set('appId', appId);
      authUrl.searchParams.set('redirectUrl', redirectUri);
      authUrl.searchParams.set('state', state);
      return res.json({ success: true, authorization_url: authUrl.toString(), state });
    }

    // HubSpot: OAuth 2.0, body { platform: 'hubspot' }
    if (platform === 'hubspot') {
      const creds = await getPublishingAppCredentials('hubspot');
      const redirectUri = getOAuthRedirectUri('hubspot');
      const scopes = (process.env.HUBSPOT_SCOPES || 'content cms.sites.read cms.sites.write').trim();
      if (!creds?.clientId || !creds?.clientSecret) {
        return res.status(503).json({ success: false, error: 'Service unavailable', message: 'HubSpot OAuth is not configured. Add credentials via POST /api/v1/publishing-platforms/oauth/credentials (super_admin) or set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET.' });
      }
      if (!redirectUri) {
        return res.status(503).json({ success: false, error: 'Service unavailable', message: 'HubSpot redirect URI not set. Set BACKEND_URL or HUBSPOT_REDIRECT_URI.' });
      }
      const state = jwt.sign(
        { userId, platform: 'hubspot', nonce: crypto.randomUUID() },
        process.env.JWT_SECRET || 'fallback-secret-for-development',
        { expiresIn: '600s' }
      );
      const authUrl = new URL('https://app.hubspot.com/oauth/authorize');
      authUrl.searchParams.set('client_id', creds.clientId);
      authUrl.searchParams.set('scope', scopes);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', state);
      return res.json({ success: true, authorization_url: authUrl.toString(), state });
    }

    // Drupal: OAuth 2.0 per-site. Body { platform: 'drupal', site_url: 'https://mysite.com' }.
    if (platform === 'drupal') {
      const rawSite = rest.site_url || rest.drupal_site_url;
      const siteUrl = rawSite && String(rawSite).trim().replace(/\/+$/, '');
      if (!siteUrl) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'Drupal connection requires site_url (e.g. https://mysite.com).'
        });
      }
      const clientId = process.env.DRUPAL_CLIENT_ID;
      const clientSecret = process.env.DRUPAL_CLIENT_SECRET;
      const redirectUri = getOAuthRedirectUri('drupal');
      if (!clientId || !clientSecret) {
        return res.status(503).json({ success: false, error: 'Service unavailable', message: 'Drupal OAuth is not configured (DRUPAL_CLIENT_ID, DRUPAL_CLIENT_SECRET).' });
      }
      if (!redirectUri) {
        return res.status(503).json({ success: false, error: 'Service unavailable', message: 'Drupal redirect URI not set. Set BACKEND_URL or DRUPAL_REDIRECT_URI.' });
      }
      const state = jwt.sign(
        { userId, platform: 'drupal', site_url: siteUrl, nonce: crypto.randomUUID() },
        process.env.JWT_SECRET || 'fallback-secret-for-development',
        { expiresIn: '600s' }
      );
      const authBase = siteUrl.replace(/\/+$/, '');
      const authUrl = new URL(`${authBase}/oauth2/authorize`);
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('scope', process.env.DRUPAL_SCOPES || '');
      return res.json({ success: true, authorization_url: authUrl.toString(), state });
    }

    if (OAUTH_ONLY_PLATFORMS.has(platform) && !['medium', 'shopify', 'webflow', 'squarespace', 'wix', 'hubspot', 'drupal'].includes(platform)) {
      return res.status(503).json({
        success: false,
        error: 'Service unavailable',
        message: `${PLATFORM_LABELS[platform] || platform} OAuth is not yet configured. Coming soon.`
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Invalid platform',
      message: `Unsupported platform: ${rawPlatform}`
    });
  } catch (err) {
    if (err.message && err.message.includes('OAUTH_ENCRYPTION_KEY')) {
      return res.status(503).json({
        success: false,
        error: 'Service unavailable',
        message: 'Encryption key not configured. Contact support.'
      });
    }
    console.error('Connect publishing platform failed:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to connect platform',
      message: err.message
    });
  }
});

/** DELETE /:platform/disconnect — remove connection for the given platform */
router.delete('/:platform/disconnect', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const platform = normalizePlatform(req.params.platform);

    if (!platform) {
      return res.status(400).json({
        success: false,
        error: 'Invalid platform',
        message: `Unknown platform. Supported: ${[...PLATFORM_KEYS].join(', ')}`
      });
    }

    const result = await db.query(
      'DELETE FROM publishing_platform_connections WHERE user_id = $1 AND platform = $2 RETURNING id',
      [userId, platform]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not found',
        message: `${PLATFORM_LABELS[platform] || platform} is not connected for this account`
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Disconnect publishing platform failed:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to disconnect',
      message: err.message
    });
  }
});

/**
 * Medium OAuth callback (no JWT). Register in index.js without requireAuth.
 * GET /api/v1/publishing-platforms/medium/callback?code=...&state=...
 */
export async function mediumOAuthCallback(req, res) {
  const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const successRedirect = `${frontendBase}/settings?publishing=connected&platform=medium`;
  const errorRedirect = (message) => `${frontendBase}/settings?publishing=error&message=${encodeURIComponent(message)}`;

  try {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) {
      const msg = oauthError === 'access_denied' ? 'Medium access was denied' : String(oauthError);
      return res.redirect(errorRedirect(msg));
    }
    if (!code || !state) {
      return res.redirect(errorRedirect('Missing code or state from Medium'));
    }

    const secret = process.env.JWT_SECRET || 'fallback-secret-for-development';
    let payload;
    try {
      payload = jwt.verify(state, secret);
    } catch {
      return res.redirect(errorRedirect('Invalid or expired state. Please try connecting again.'));
    }
    if (payload.platform !== 'medium' || !payload.userId) {
      return res.redirect(errorRedirect('Invalid state'));
    }
    const userId = payload.userId;

    const creds = await getPublishingAppCredentials('medium');
    const redirectUri = getMediumRedirectUri();
    if (!creds?.clientId || !creds?.clientSecret || !redirectUri) {
      return res.redirect(errorRedirect('Medium OAuth not configured'));
    }

    const tokenRes = await fetch(MEDIUM_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      })
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Medium token exchange failed:', tokenRes.status, errText);
      return res.redirect(errorRedirect('Could not complete Medium connection'));
    }

    const tokenData = await tokenRes.json();
    const { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt } = tokenData;
    if (!accessToken) {
      return res.redirect(errorRedirect('Invalid response from Medium'));
    }

    let account = 'Medium';
    let mediumUserId = null;
    try {
      const meRes = await fetch('https://api.medium.com/v1/me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (meRes.ok) {
        const me = await meRes.json();
        account = me?.data?.username || me?.data?.name || account;
        mediumUserId = me?.data?.id || null;
      }
    } catch (e) {
      console.warn('Medium /me failed, using default account label:', e.message);
    }

    const credentialsEncrypted = oauthManager.encryptToken(
      JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken || null,
        expires_at: expiresAt || null,
        medium_user_id: mediumUserId
      })
    );

    await db.query(
      `INSERT INTO publishing_platform_connections
       (user_id, platform, credentials_encrypted, account, connected, updated_at)
       VALUES ($1, 'medium', $2, $3, true, NOW())
       ON CONFLICT (user_id, platform)
       DO UPDATE SET
         credentials_encrypted = EXCLUDED.credentials_encrypted,
         account = EXCLUDED.account,
         connected = true,
         updated_at = NOW()`,
      [userId, credentialsEncrypted, account]
    );

    res.redirect(successRedirect);
  } catch (err) {
    console.error('Medium OAuth callback error:', err);
    res.redirect(errorRedirect(err.message || 'Connection failed'));
  }
}

/**
 * Shopify OAuth callback (no JWT). Register in index.js without requireAuth.
 * GET /api/v1/publishing-platforms/shopify/callback?code=...&shop=...&hmac=...&state=...&timestamp=...
 */
function verifyShopifyHmac(query, clientSecret) {
  const { hmac, ...rest } = query;
  if (!hmac || typeof hmac !== 'string') return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');
  const digest = crypto.createHmac('sha256', clientSecret).update(message).digest('hex');
  const a = Buffer.from(hmac, 'hex');
  const b = Buffer.from(digest, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const SHOPIFY_SHOP_HOSTNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.myshopify\.com$/;

export async function shopifyOAuthCallback(req, res) {
  const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const successRedirect = `${frontendBase}/settings?publishing=connected&platform=shopify`;
  const errorRedirect = (message) => `${frontendBase}/settings?publishing=error&message=${encodeURIComponent(message)}`;

  try {
    const { code, shop, hmac, state, timestamp, error: oauthError } = req.query;
    if (oauthError) {
      const msg = oauthError === 'access_denied' ? 'Shopify access was denied' : String(oauthError);
      return res.redirect(errorRedirect(msg));
    }
    if (!code || !shop || !state) {
      return res.redirect(errorRedirect('Missing code, shop, or state from Shopify'));
    }

    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    if (!clientSecret) {
      return res.redirect(errorRedirect('Shopify OAuth not configured'));
    }
    const queryForHmac = { ...req.query };
    delete queryForHmac.hmac;
    if (!verifyShopifyHmac(queryForHmac, clientSecret)) {
      return res.redirect(errorRedirect('Invalid HMAC from Shopify'));
    }

    const shopHost = String(shop).trim().toLowerCase();
    if (!SHOPIFY_SHOP_HOSTNAME_REGEX.test(shopHost)) {
      return res.redirect(errorRedirect('Invalid shop hostname'));
    }

    const secret = process.env.JWT_SECRET || 'fallback-secret-for-development';
    let payload;
    try {
      payload = jwt.verify(state, secret);
    } catch {
      return res.redirect(errorRedirect('Invalid or expired state. Please try connecting again.'));
    }
    if (payload.platform !== 'shopify' || !payload.userId || payload.shop !== shopHost) {
      return res.redirect(errorRedirect('Invalid state'));
    }
    const userId = payload.userId;

    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const redirectUri = getShopifyRedirectUri();
    if (!clientId || !redirectUri) {
      return res.redirect(errorRedirect('Shopify OAuth not configured'));
    }

    const tokenRes = await fetch(`https://${shopHost}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code
      })
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Shopify token exchange failed:', tokenRes.status, errText);
      return res.redirect(errorRedirect('Could not complete Shopify connection'));
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return res.redirect(errorRedirect('Invalid response from Shopify'));
    }

    const credentialsEncrypted = oauthManager.encryptToken(
      JSON.stringify({ shop: shopHost, access_token: accessToken })
    );
    const siteUrl = `https://${shopHost}`;
    const siteName = shopHost.replace('.myshopify.com', '');

    await db.query(
      `INSERT INTO publishing_platform_connections
       (user_id, platform, credentials_encrypted, site_url, site_name, account, connected, updated_at)
       VALUES ($1, 'shopify', $2, $3, $4, $5, true, NOW())
       ON CONFLICT (user_id, platform)
       DO UPDATE SET
         credentials_encrypted = EXCLUDED.credentials_encrypted,
         site_url = EXCLUDED.site_url,
         site_name = EXCLUDED.site_name,
         account = EXCLUDED.account,
         connected = true,
         updated_at = NOW()`,
      [userId, credentialsEncrypted, siteUrl, siteName, siteName]
    );

    res.redirect(successRedirect);
  } catch (err) {
    console.error('Shopify OAuth callback error:', err);
    res.redirect(errorRedirect(err.message || 'Connection failed'));
  }
}

/** Generic OAuth callback helper: verify state JWT, exchange code, store credentials, redirect. */
async function handleOAuthCallback(req, res, platformKey, tokenExchange, storeRow) {
  const successRedirect = SUCCESS_REDIRECT(platformKey);
  const errorRedirect = ERROR_REDIRECT;
  try {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) {
      const msg = oauthError === 'access_denied' ? `${PLATFORM_LABELS[platformKey] || platformKey} access was denied` : String(oauthError);
      return res.redirect(errorRedirect(msg));
    }
    if (!code || !state) {
      return res.redirect(errorRedirect(`Missing code or state from ${PLATFORM_LABELS[platformKey] || platformKey}`));
    }
    const secret = process.env.JWT_SECRET || 'fallback-secret-for-development';
    let payload;
    try {
      payload = jwt.verify(state, secret);
    } catch {
      return res.redirect(errorRedirect('Invalid or expired state. Please try connecting again.'));
    }
    if (payload.platform !== platformKey || !payload.userId) {
      return res.redirect(errorRedirect('Invalid state'));
    }
    const userId = payload.userId;
    const result = await tokenExchange(code, payload);
    const { credentials, site_url, site_name, account } = result;
    const credentialsEncrypted = oauthManager.encryptToken(JSON.stringify(credentials));
    await storeRow(userId, credentialsEncrypted, site_url, site_name, account);
    res.redirect(successRedirect);
  } catch (err) {
    console.error(`${platformKey} OAuth callback error:`, err);
    res.redirect(errorRedirect(err.message || 'Connection failed'));
  }
}

export async function webflowOAuthCallback(req, res) {
  await handleOAuthCallback(req, res, 'webflow', async (code) => {
    const clientId = process.env.WEBFLOW_CLIENT_ID;
    const clientSecret = process.env.WEBFLOW_CLIENT_SECRET;
    const redirectUri = getOAuthRedirectUri('webflow');
    if (!clientId || !clientSecret || !redirectUri) throw new Error('Webflow OAuth not configured');
    const tokenRes = await fetch('https://api.webflow.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code' })
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      throw new Error(t || 'Token exchange failed');
    }
    const data = await tokenRes.json();
    const accessToken = data.access_token;
    if (!accessToken) throw new Error('Invalid response from Webflow');
    return {
      credentials: { access_token: accessToken, refresh_token: data.refresh_token || null },
      site_url: undefined,
      site_name: undefined,
      account: 'Webflow'
    };
  }, async (userId, credentialsEncrypted, site_url, site_name, account) => {
    await db.query(
      `INSERT INTO publishing_platform_connections (user_id, platform, credentials_encrypted, site_url, site_name, account, connected, updated_at)
       VALUES ($1, 'webflow', $2, $3, $4, $5, true, NOW())
       ON CONFLICT (user_id, platform) DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted, site_url = EXCLUDED.site_url, site_name = EXCLUDED.site_name, account = EXCLUDED.account, connected = true, updated_at = NOW()`,
      [userId, credentialsEncrypted, site_url || null, site_name || null, account || 'Webflow']
    );
  });
}

export async function squarespaceOAuthCallback(req, res) {
  await handleOAuthCallback(req, res, 'squarespace', async (code) => {
    const clientId = process.env.SQUARESPACE_CLIENT_ID;
    const clientSecret = process.env.SQUARESPACE_CLIENT_SECRET;
    const redirectUri = getOAuthRedirectUri('squarespace');
    if (!clientId || !clientSecret || !redirectUri) throw new Error('Squarespace OAuth not configured');
    const tokenRes = await fetch('https://login.squarespace.com/api/1/login/oauth/provider/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code
      })
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      throw new Error(t || 'Token exchange failed');
    }
    const data = await tokenRes.json();
    const accessToken = data.access_token;
    if (!accessToken) throw new Error('Invalid response from Squarespace');
    return {
      credentials: { access_token: accessToken, refresh_token: data.refresh_token || null },
      site_url: undefined,
      site_name: undefined,
      account: 'Squarespace'
    };
  }, async (userId, credentialsEncrypted, site_url, site_name, account) => {
    await db.query(
      `INSERT INTO publishing_platform_connections (user_id, platform, credentials_encrypted, site_url, site_name, account, connected, updated_at)
       VALUES ($1, 'squarespace', $2, $3, $4, $5, true, NOW())
       ON CONFLICT (user_id, platform) DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted, site_url = EXCLUDED.site_url, site_name = EXCLUDED.site_name, account = EXCLUDED.account, connected = true, updated_at = NOW()`,
      [userId, credentialsEncrypted, site_url || null, site_name || null, account || 'Squarespace']
    );
  });
}

export async function wixOAuthCallback(req, res) {
  await handleOAuthCallback(req, res, 'wix', async (code) => {
    const appId = process.env.WIX_APP_ID;
    const appSecret = process.env.WIX_APP_SECRET;
    const redirectUri = getOAuthRedirectUri('wix');
    if (!appId || !appSecret || !redirectUri) throw new Error('Wix OAuth not configured');
    const tokenRes = await fetch('https://www.wix.com/oauth/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: appId,
        client_secret: appSecret,
        code,
        redirect_uri: redirectUri
      })
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      throw new Error(t || 'Token exchange failed');
    }
    const data = await tokenRes.json();
    const accessToken = data.access_token;
    if (!accessToken) throw new Error('Invalid response from Wix');
    return {
      credentials: { access_token: accessToken, refresh_token: data.refresh_token || null },
      site_url: undefined,
      site_name: undefined,
      account: 'Wix'
    };
  }, async (userId, credentialsEncrypted, site_url, site_name, account) => {
    await db.query(
      `INSERT INTO publishing_platform_connections (user_id, platform, credentials_encrypted, site_url, site_name, account, connected, updated_at)
       VALUES ($1, 'wix', $2, $3, $4, $5, true, NOW())
       ON CONFLICT (user_id, platform) DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted, site_url = EXCLUDED.site_url, site_name = EXCLUDED.site_name, account = EXCLUDED.account, connected = true, updated_at = NOW()`,
      [userId, credentialsEncrypted, site_url || null, site_name || null, account || 'Wix']
    );
  });
}

export async function hubspotOAuthCallback(req, res) {
  await handleOAuthCallback(req, res, 'hubspot', async (code) => {
    const creds = await getPublishingAppCredentials('hubspot');
    const redirectUri = getOAuthRedirectUri('hubspot');
    if (!creds?.clientId || !creds?.clientSecret || !redirectUri) throw new Error('HubSpot OAuth not configured');
    const tokenRes = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: redirectUri,
        code
      })
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      throw new Error(t || 'Token exchange failed');
    }
    const data = await tokenRes.json();
    const accessToken = data.access_token;
    if (!accessToken) throw new Error('Invalid response from HubSpot');
    return {
      credentials: { access_token: accessToken, refresh_token: data.refresh_token || null, expires_in: data.expires_in },
      site_url: undefined,
      site_name: undefined,
      account: 'HubSpot'
    };
  }, async (userId, credentialsEncrypted, site_url, site_name, account) => {
    await db.query(
      `INSERT INTO publishing_platform_connections (user_id, platform, credentials_encrypted, site_url, site_name, account, connected, updated_at)
       VALUES ($1, 'hubspot', $2, $3, $4, $5, true, NOW())
       ON CONFLICT (user_id, platform) DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted, site_url = EXCLUDED.site_url, site_name = EXCLUDED.site_name, account = EXCLUDED.account, connected = true, updated_at = NOW()`,
      [userId, credentialsEncrypted, site_url || null, site_name || null, account || 'HubSpot']
    );
  });
}

export async function drupalOAuthCallback(req, res) {
  const errorRedirect = ERROR_REDIRECT;
  try {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) {
      return res.redirect(errorRedirect(oauthError === 'access_denied' ? 'Drupal access was denied' : String(oauthError)));
    }
    if (!code || !state) {
      return res.redirect(errorRedirect('Missing code or state from Drupal'));
    }
    const secret = process.env.JWT_SECRET || 'fallback-secret-for-development';
    let payload;
    try {
      payload = jwt.verify(state, secret);
    } catch {
      return res.redirect(errorRedirect('Invalid or expired state. Please try connecting again.'));
    }
    if (payload.platform !== 'drupal' || !payload.userId || !payload.site_url) {
      return res.redirect(errorRedirect('Invalid state'));
    }
    const userId = payload.userId;
    const siteUrl = payload.site_url.replace(/\/+$/, '');
    const clientId = process.env.DRUPAL_CLIENT_ID;
    const clientSecret = process.env.DRUPAL_CLIENT_SECRET;
    const redirectUri = getOAuthRedirectUri('drupal');
    if (!clientId || !clientSecret || !redirectUri) {
      return res.redirect(errorRedirect('Drupal OAuth not configured'));
    }
    const tokenRes = await fetch(`${siteUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code
      })
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      return res.redirect(errorRedirect(t || 'Drupal token exchange failed'));
    }
    const data = await tokenRes.json();
    const accessToken = data.access_token;
    if (!accessToken) return res.redirect(errorRedirect('Invalid response from Drupal'));
    const credentialsEncrypted = oauthManager.encryptToken(JSON.stringify({ site_url: siteUrl, access_token: accessToken }));
    await db.query(
      `INSERT INTO publishing_platform_connections (user_id, platform, credentials_encrypted, site_url, site_name, account, connected, updated_at)
       VALUES ($1, 'drupal', $2, $3, $4, $5, true, NOW())
       ON CONFLICT (user_id, platform) DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted, site_url = EXCLUDED.site_url, site_name = EXCLUDED.site_name, account = EXCLUDED.account, connected = true, updated_at = NOW()`,
      [userId, credentialsEncrypted, siteUrl, new URL(siteUrl).hostname, new URL(siteUrl).hostname]
    );
    res.redirect(SUCCESS_REDIRECT('drupal'));
  } catch (err) {
    console.error('Drupal OAuth callback error:', err);
    res.redirect(errorRedirect(err.message || 'Connection failed'));
  }
}

export default router;
