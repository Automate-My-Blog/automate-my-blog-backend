/**
 * Admin panel: stats and cache management.
 * Protected by super_admin JWT or ADMIN_API_KEY (header x-admin-key or query admin_key).
 */

import express from 'express';
import db from '../services/database.js';
import { getConnection } from '../services/job-queue.js';

const router = express.Router();

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

function validAdminKey(req) {
  if (!ADMIN_API_KEY) return false;
  const key = req.headers['x-admin-key'] || req.query.admin_key || '';
  return key === ADMIN_API_KEY;
}

/**
 * Require either ADMIN_API_KEY or authenticated super_admin (call after authMiddleware for JWT path).
 */
export function requireAdmin(req, res, next) {
  if (validAdminKey(req)) return next();
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Provide x-admin-key header, admin_key query, or log in as super_admin'
    });
  }
  const role = req.user.role || req.user.role_name;
  const isSuperAdmin = role === 'super_admin' || (req.user.permissions && Array.isArray(req.user.permissions) && req.user.permissions.includes('view_platform_analytics'));
  if (!isSuperAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Super admin or admin API key required'
    });
  }
  next();
}

/**
 * Normalize URL for cache lookup (match website-analysis-pipeline logic).
 */
function urlVariants(url) {
  try {
    const u = new URL(url);
    const domain = u.hostname;
    return [url, `http://${domain}`, `https://${domain}`];
  } catch {
    return [url];
  }
}

/**
 * GET /api/v1/admin-panel/stats
 * Application and DB statistics.
 */
router.get('/stats', async (req, res) => {
  try {
    const appStats = {
      nodeVersion: process.version,
      env: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      redis: 'unknown'
    };
    try {
      const conn = getConnection();
      appStats.redis = conn ? 'connected' : 'not_configured';
    } catch (e) {
      appStats.redis = 'error';
      appStats.redisError = e?.message || String(e);
    }

    const dbStats = { connected: false, tables: {}, platformMetrics: null };
    try {
      const test = await db.query('SELECT 1');
      dbStats.connected = !!test?.rows?.[0];

      const tables = [
        'users',
        'organizations',
        'projects',
        'blog_posts',
        'jobs',
        'organization_intelligence',
        'audiences',
        'cta_analysis',
        'website_pages',
        'comprehensive_seo_analyses',
        'leads'
      ];
      for (const table of tables) {
        try {
          const r = await db.query(`SELECT COUNT(*) AS c FROM ${table}`);
          dbStats.tables[table] = parseInt(r.rows[0]?.c ?? 0, 10);
        } catch (e) {
          dbStats.tables[table] = null;
        }
      }

      try {
        const metrics = await db.query('SELECT * FROM platform_metrics_summary');
        if (metrics.rows?.[0]) dbStats.platformMetrics = metrics.rows[0];
      } catch (e) {
        dbStats.platformMetrics = null;
      }
    } catch (e) {
      dbStats.error = e?.message || String(e);
    }

    res.json({
      success: true,
      app: appStats,
      db: dbStats
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({
      success: false,
      error: err?.message || 'Failed to load stats'
    });
  }
});

/**
 * GET /api/v1/admin-panel/cache?url=...
 * View cache entry for a given URL (website analysis cache).
 */
router.get('/cache', async (req, res) => {
  try {
    const url = (req.query.url || '').trim();
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "url" is required'
      });
    }
    const variants = urlVariants(url);
    const orgs = await db.query(
      `SELECT id, name, website_url, last_analyzed_at, created_at, owner_user_id, session_id
       FROM organizations
       WHERE website_url = ANY($1)
       ORDER BY last_analyzed_at DESC NULLS LAST`,
      [variants]
    );
    const rows = orgs.rows || [];
    const result = rows.map((o) => ({
      organizationId: o.id,
      name: o.name,
      websiteUrl: o.website_url,
      lastAnalyzedAt: o.last_analyzed_at,
      createdAt: o.created_at,
      hasOwner: !!o.owner_user_id,
      hasSession: !!o.session_id
    }));

    res.json({
      success: true,
      url: url,
      entries: result
    });
  } catch (err) {
    console.error('Admin cache view error:', err);
    res.status(500).json({
      success: false,
      error: err?.message || 'Failed to view cache'
    });
  }
});

/**
 * DELETE /api/v1/admin-panel/cache?url=...
 * Clear website analysis cache for a given URL (forces re-analysis on next request).
 */
router.delete('/cache', async (req, res) => {
  try {
    const url = (req.query.url || req.body?.url || '').trim();
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "url" or body "url" is required'
      });
    }
    const variants = urlVariants(url);
    const orgs = await db.query(
      'SELECT id FROM organizations WHERE website_url = ANY($1)',
      [variants]
    );
    const orgIds = (orgs.rows || []).map((r) => r.id);
    if (orgIds.length === 0) {
      return res.json({
        success: true,
        message: 'No cache entries found for this URL',
        cleared: 0
      });
    }

    let cleared = 0;
    for (const orgId of orgIds) {
      await db.transaction(async (client) => {
        const intelIds = await client.query(
          'SELECT id FROM organization_intelligence WHERE organization_id = $1',
          [orgId]
        );
        const ids = (intelIds.rows || []).map((r) => r.id);
        if (ids.length > 0) {
          await client.query(
            'DELETE FROM audiences WHERE organization_intelligence_id = ANY($1)',
            [ids]
          );
        }
        await client.query('DELETE FROM organization_intelligence WHERE organization_id = $1', [orgId]);
        await client.query('DELETE FROM cta_analysis WHERE organization_id = $1', [orgId]);
        await client.query('DELETE FROM website_pages WHERE organization_id = $1', [orgId]);
        await client.query(
          'UPDATE organizations SET last_analyzed_at = NULL WHERE id = $1',
          [orgId]
        );
      });
      cleared += 1;
    }

    res.json({
      success: true,
      message: `Cleared website analysis cache for ${cleared} organization(s)`,
      cleared
    });
  } catch (err) {
    console.error('Admin cache clear error:', err);
    res.status(500).json({
      success: false,
      error: err?.message || 'Failed to clear cache'
    });
  }
});

/**
 * GET /api/v1/admin-panel
 * Serve simple admin panel HTML (same as GET /admin below).
 */
function adminPanelHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AutoBlog Admin</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 1.5rem; background: #0f0f12; color: #e4e4e7; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .sub { color: #71717a; font-size: 0.9rem; margin-bottom: 1.5rem; }
    section { background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
    section h2 { font-size: 1rem; margin: 0 0 0.75rem; color: #a1a1aa; }
    pre, code { background: #27272a; padding: 0.2em 0.4em; border-radius: 4px; font-size: 0.85em; }
    pre { overflow: auto; padding: 0.75rem; margin: 0; white-space: pre-wrap; }
    .row { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.75rem; }
    input[type="url"] { flex: 1; min-width: 200px; padding: 0.5rem 0.75rem; border: 1px solid #3f3f46; border-radius: 6px; background: #27272a; color: #e4e4e7; }
    button { padding: 0.5rem 1rem; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-primary:hover { background: #2563eb; }
    .btn-danger { background: #dc2626; color: #fff; }
    .btn-danger:hover { background: #b91c1c; }
    .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
    .msg { margin-top: 0.5rem; padding: 0.5rem; border-radius: 6px; font-size: 0.9rem; }
    .msg.success { background: #14532d; color: #86efac; }
    .msg.error { background: #450a0a; color: #fca5a5; }
    .msg.info { background: #1e3a5f; color: #93c5fd; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #27272a; }
    th { color: #71717a; font-weight: 500; }
  </style>
</head>
<body>
  <h1>AutoBlog Admin</h1>
  <p class="sub">Application stats and website analysis cache</p>

  <section>
    <h2>Application &amp; DB stats</h2>
    <div class="row">
      <button class="btn-primary" id="refresh-stats">Refresh</button>
    </div>
    <pre id="stats-output">Click Refresh to load.</pre>
  </section>

  <section>
    <h2>Cache by URL</h2>
    <p style="margin: 0 0 0.75rem; color: #a1a1aa; font-size: 0.9rem;">View or clear website analysis cache for a given URL.</p>
    <div class="row">
      <input type="url" id="cache-url" placeholder="https://example.com" />
      <button class="btn-primary" id="view-cache">View</button>
      <button class="btn-danger" id="clear-cache">Clear cache</button>
    </div>
    <div id="cache-msg"></div>
    <div id="cache-result"></div>
  </section>

  <script>
    const base = (window.location.pathname.indexOf('admin-panel') !== -1
      ? window.location.pathname.replace(/\\/?admin-panel\\/?.*$/, '') + '/api/v1/admin-panel'
      : '/api/v1/admin-panel');
    const adminKey = new URLSearchParams(window.location.search).get('admin_key') || '';

    function headers() {
      const h = { 'Content-Type': 'application/json' };
      if (adminKey) h['x-admin-key'] = adminKey;
      return h;
    }

    function opts(method) {
      return { method, headers: headers(), credentials: 'same-origin' };
    }

    document.getElementById('refresh-stats').onclick = async () => {
      const el = document.getElementById('stats-output');
      el.textContent = 'Loading…';
      try {
        const r = await fetch(base + '/stats', opts('GET'));
        const data = await r.json();
        el.textContent = r.ok ? JSON.stringify(data, null, 2) : 'Error: ' + (data.error || data.message || r.status);
      } catch (e) {
        el.textContent = 'Error: ' + e.message;
      }
    };

    function showCacheMsg(msg, type) {
      const el = document.getElementById('cache-msg');
      el.className = 'msg ' + (type || 'info');
      el.textContent = msg;
      el.style.display = 'block';
    }

    function showCacheResult(html) {
      document.getElementById('cache-result').innerHTML = html;
    }

    document.getElementById('view-cache').onclick = async () => {
      const url = document.getElementById('cache-url').value.trim();
      if (!url) { showCacheMsg('Enter a URL', 'error'); return; }
      showCacheMsg('Loading…', 'info');
      showCacheResult('');
      try {
        const r = await fetch(base + '/cache?url=' + encodeURIComponent(url), opts('GET'));
        const data = await r.json();
        if (!r.ok) {
          showCacheMsg(data.error || data.message || r.status, 'error');
          return;
        }
        showCacheMsg(data.entries.length ? 'Found ' + data.entries.length + ' cache entry(ies).' : 'No cache for this URL.');
        if (data.entries.length === 0) return;
        let table = '<table><tr><th>Organization</th><th>URL</th><th>Last analyzed</th></tr>';
        data.entries.forEach(e => {
          table += '<tr><td>' + (e.name || e.organizationId) + '</td><td>' + (e.websiteUrl || '') + '</td><td>' + (e.lastAnalyzedAt || '—') + '</td></tr>';
        });
        table += '</table>';
        showCacheResult(table);
      } catch (e) {
        showCacheMsg('Error: ' + e.message, 'error');
      }
    };

    document.getElementById('clear-cache').onclick = async () => {
      const url = document.getElementById('cache-url').value.trim();
      if (!url) { showCacheMsg('Enter a URL', 'error'); return; }
      if (!confirm('Clear website analysis cache for “' + url + '”? Next analysis will re-run from scratch.')) return;
      const btn = document.getElementById('clear-cache');
      btn.disabled = true;
      showCacheMsg('Clearing…', 'info');
      try {
        const r = await fetch(base + '/cache?url=' + encodeURIComponent(url), { ...opts('DELETE') });
        const data = await r.json();
        if (r.ok) {
          showCacheMsg(data.message || 'Cache cleared.', 'success');
          document.getElementById('cache-result').innerHTML = '';
        } else {
          showCacheMsg(data.error || data.message || r.status, 'error');
        }
      } catch (e) {
        showCacheMsg('Error: ' + e.message, 'error');
      }
      btn.disabled = false;
    };
  </script>
</body>
</html>`;
}

router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(adminPanelHtml());
});

export { adminPanelHtml };
export default router;
