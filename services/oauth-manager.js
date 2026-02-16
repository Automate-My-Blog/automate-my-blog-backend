import crypto from 'crypto';
import db from './database.js';
import dotenv from 'dotenv';

dotenv.config();

const ENCRYPTION_KEY = process.env.OAUTH_ENCRYPTION_KEY; // 32-byte hex key
const ALGORITHM = 'aes-256-gcm';

/**
 * OAuth Manager Service
 * Handles encrypted storage and automatic refresh of OAuth tokens
 */
export class OAuthManager {
  /**
   * Encrypt token with AES-256-GCM
   */
  encryptToken(token) {
    if (!ENCRYPTION_KEY) {
      throw new Error('OAUTH_ENCRYPTION_KEY not configured in environment');
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt token
   */
  decryptToken(encryptedToken) {
    if (!ENCRYPTION_KEY) {
      throw new Error('OAUTH_ENCRYPTION_KEY not configured in environment');
    }

    const [ivHex, authTagHex, encrypted] = encryptedToken.split(':');
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(ENCRYPTION_KEY, 'hex'),
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Store OAuth tokens for user
   */
  async storeCredentials(userId, serviceName, tokens, scopes, serviceConfig = {}) {
    const accessTokenEncrypted = this.encryptToken(tokens.access_token);
    const refreshTokenEncrypted = this.encryptToken(tokens.refresh_token);
    const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));

    const query = `
      INSERT INTO user_oauth_credentials
        (user_id, service_name, access_token_encrypted, refresh_token_encrypted,
         expires_at, scopes, service_config, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
      ON CONFLICT (user_id, service_name)
      DO UPDATE SET
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
        expires_at = EXCLUDED.expires_at,
        scopes = EXCLUDED.scopes,
        service_config = EXCLUDED.service_config,
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `;

    const result = await db.query(query, [
      userId,
      serviceName,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      expiresAt,
      JSON.stringify(scopes),
      JSON.stringify(serviceConfig)
    ]);

    return result.rows[0].id;
  }

  /**
   * Get credentials for user and service (auto-refresh if expired)
   */
  async getCredentials(userId, serviceName) {
    const query = `
      SELECT * FROM user_oauth_credentials
      WHERE user_id = $1 AND service_name = $2 AND status = 'active'
    `;

    const result = await db.query(query, [userId, serviceName]);
    if (!result.rows || result.rows.length === 0) {
      return null;
    }

    const cred = result.rows[0];

    // Check if token is expired or expiring soon (within 5 minutes)
    const expiresAt = new Date(cred.expires_at);
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    if (expiresAt <= fiveMinutesFromNow) {
      console.log(`🔄 Token for ${serviceName} expired/expiring, refreshing...`);
      return await this.refreshCredentials(userId, serviceName, cred);
    }

    // Decrypt and return
    const accessToken = this.decryptToken(cred.access_token_encrypted);
    const refreshToken = this.decryptToken(cred.refresh_token_encrypted);

    // Log access for audit
    await this.logAccess(cred.id, 'accessed');

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: cred.expires_at,
      scopes: JSON.parse(cred.scopes),
      service_config: JSON.parse(cred.service_config || '{}')
    };
  }

  /**
   * Refresh OAuth token
   */
  async refreshCredentials(userId, serviceName, existingCred) {
    try {
      const refreshToken = this.decryptToken(existingCred.refresh_token_encrypted);

      // Call Google OAuth2 token endpoint
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        })
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const tokens = await response.json();

      // Store refreshed tokens
      await this.storeCredentials(
        userId,
        serviceName,
        {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || refreshToken, // Some services don't return new refresh token
          expires_in: tokens.expires_in
        },
        JSON.parse(existingCred.scopes),
        JSON.parse(existingCred.service_config || '{}')
      );

      // Log refresh for audit
      await this.logAccess(existingCred.id, 'refreshed');

      return await this.getCredentials(userId, serviceName);
    } catch (error) {
      console.error(`❌ Failed to refresh ${serviceName} token:`, error);

      // Mark as error
      await db.query(
        `UPDATE user_oauth_credentials
         SET status = 'error', error_message = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [error.message, existingCred.id]
      );

      throw error;
    }
  }

  /**
   * Revoke credentials
   */
  async revokeCredentials(userId, serviceName) {
    const cred = await this.getCredentials(userId, serviceName);
    if (!cred) return;

    // Revoke with Google
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${cred.access_token}`, {
        method: 'POST'
      });
    } catch (error) {
      console.error('Error revoking token with Google:', error);
      // Continue to mark as revoked in DB even if Google revocation fails
    }

    // Mark as revoked in DB
    await db.query(
      `UPDATE user_oauth_credentials
       SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND service_name = $2`,
      [userId, serviceName]
    );

    // Get credential ID for audit log
    const result = await db.query(
      `SELECT id FROM user_oauth_credentials WHERE user_id = $1 AND service_name = $2`,
      [userId, serviceName]
    );

    if (result.rows.length > 0) {
      await this.logAccess(result.rows[0].id, 'revoked');
    }
  }

  /**
   * Log credential access for audit trail
   */
  async logAccess(credentialId, action, req = null) {
    const query = `
      INSERT INTO oauth_credential_audit (credential_id, action, ip_address, user_agent)
      VALUES ($1, $2, $3, $4)
    `;

    await db.query(query, [
      credentialId,
      action,
      req?.ip || null,
      req?.headers?.['user-agent'] || null
    ]);
  }
}

const oauthManager = new OAuthManager();
export default oauthManager;
