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
      const clientId = process.env.MEDIUM_CLIENT_ID;
      const clientSecret = process.env.MEDIUM_CLIENT_SECRET;
      const redirectUri = getMediumRedirectUri();
      if (!clientId || !clientSecret) {
        return res.status(503).json({
          success: false,
          error: 'Service unavailable',
          message: 'Medium OAuth is not configured (MEDIUM_CLIENT_ID, MEDIUM_CLIENT_SECRET).'
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
      authUrl.searchParams.set('client_id', clientId);
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

    if (OAUTH_ONLY_PLATFORMS.has(platform) && platform !== 'medium') {
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

    const clientId = process.env.MEDIUM_CLIENT_ID;
    const clientSecret = process.env.MEDIUM_CLIENT_SECRET;
    const redirectUri = getMediumRedirectUri();
    if (!clientId || !clientSecret || !redirectUri) {
      return res.redirect(errorRedirect('Medium OAuth not configured'));
    }

    const tokenRes = await fetch(MEDIUM_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
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
    try {
      const meRes = await fetch('https://api.medium.com/v1/me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (meRes.ok) {
        const me = await meRes.json();
        account = me?.data?.username || me?.data?.name || account;
      }
    } catch (e) {
      console.warn('Medium /me failed, using default account label:', e.message);
    }

    const credentialsEncrypted = oauthManager.encryptToken(
      JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken || null,
        expires_at: expiresAt || null
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

export default router;
