/**
 * Third-party publishing platform connections (WordPress, Medium, Substack, Ghost).
 * List, connect, disconnect. All endpoints require JWT.
 * @see docs: Third-Party Publishing Services — Backend Handoff
 */
import express from 'express';
import db from '../services/database.js';
import oauthManager from '../services/oauth-manager.js';
import { PLATFORM_KEYS, PLATFORM_LABELS, normalizePlatformKey } from '../lib/publishing-platforms.js';

const router = express.Router();

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

/** GET /connections — list connected platforms for the current user */
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
    const connections = result.rows.map((row) => ({
      platform: row.platform,
      label: PLATFORM_LABELS[row.platform] || row.platform,
      connected: true,
      site_name: row.site_name || undefined,
      site_url: row.site_url || undefined,
      account: row.account || undefined
    }));
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
      const { site_url, application_password } = rest;
      if (!site_url || typeof application_password !== 'string' || !application_password.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'WordPress connection requires site_url and application_password'
        });
      }
      const url = String(site_url).trim().replace(/\/+$/, '');
      const credentialsEncrypted = oauthManager.encryptToken(
        JSON.stringify({ site_url: url, application_password: application_password.trim() })
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

    if (platform === 'medium' || platform === 'substack') {
      return res.status(501).json({
        success: false,
        error: 'Not implemented',
        message: `${PLATFORM_LABELS[platform]} OAuth flow is not yet implemented. Connect WordPress or Ghost in the meantime.`
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

export default router;
