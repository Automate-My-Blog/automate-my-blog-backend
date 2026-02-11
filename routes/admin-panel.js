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
  const key = (req.headers && req.headers['x-admin-key']) || (req.query && req.query.admin_key) || '';
  return key === ADMIN_API_KEY;
}

function isSuperAdminUser(user) {
  if (!user) return false;
  const role = user.role || user.role_name;
  return role === 'super_admin' || !!(user.permissions && Array.isArray(user.permissions) && user.permissions.includes('view_platform_analytics'));
}

/**
 * Returns true if request is authorized (key or super_admin). Use after optionalAuth so req.user may be set.
 */
export function isAdminRequest(req) {
  return validAdminKey(req) || isSuperAdminUser(req.user);
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
  if (!isSuperAdminUser(req.user)) {
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

      try {
        const sizeResult = await db.query("SELECT pg_database_size(current_database()) AS bytes");
        dbStats.sizeBytes = sizeResult.rows?.[0]?.bytes ?? null;
      } catch (e) {
        dbStats.sizeBytes = null;
      }

      try {
        const jobSummary = await db.query(
          `SELECT status, type, COUNT(*) AS c FROM jobs GROUP BY status, type`
        );
        const byStatus = { queued: 0, running: 0, succeeded: 0, failed: 0 };
        const byType = { website_analysis: 0, content_generation: 0 };
        let totalJobs = 0;
        for (const row of jobSummary.rows || []) {
          const c = parseInt(row.c, 10);
          byStatus[row.status] = (byStatus[row.status] ?? 0) + c;
          byType[row.type] = (byType[row.type] || 0) + c;
          totalJobs += c;
        }
        dbStats.jobSummary = { byStatus, byType, total: totalJobs };
      } catch (e) {
        dbStats.jobSummary = null;
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
 * GET /api/v1/admin-panel/jobs/recent?limit=20
 * Recent jobs for the table.
 */
router.get('/jobs/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const result = await db.query(
      `SELECT id, type, status, progress, error, created_at, started_at, finished_at
       FROM jobs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    const jobs = (result.rows || []).map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      progress: row.progress,
      error: row.error ? String(row.error).slice(0, 200) : null,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at
    }));
    res.json({ success: true, jobs });
  } catch (err) {
    console.error('Admin jobs/recent error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to load jobs' });
  }
});

/**
 * GET /api/v1/admin-panel/cache/urls
 * List all website analysis cached URLs (organizations with last_analyzed_at).
 */
router.get('/cache/urls', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, website_url, last_analyzed_at
       FROM organizations
       WHERE last_analyzed_at IS NOT NULL AND website_url IS NOT NULL
       ORDER BY last_analyzed_at DESC`
    );
    const urls = (result.rows || []).map((row) => ({
      organizationId: row.id,
      name: row.name,
      websiteUrl: row.website_url,
      lastAnalyzedAt: row.last_analyzed_at
    }));
    res.json({ success: true, urls });
  } catch (err) {
    console.error('Admin cache/urls error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to list cache URLs' });
  }
});

/**
 * DELETE /api/v1/admin-panel/cache/all
 * Clear all website analysis cache (all orgs with cached data).
 */
router.delete('/cache/all', async (req, res) => {
  try {
    const orgs = await db.query(
      `SELECT id FROM organizations WHERE last_analyzed_at IS NOT NULL`
    );
    const orgIds = (orgs.rows || []).map((r) => r.id);
    if (orgIds.length === 0) {
      return res.json({ success: true, message: 'No cached entries to clear', cleared: 0 });
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
    console.error('Admin cache/all clear error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to clear cache' });
  }
});

/**
 * DELETE /api/v1/admin-panel/seo-cache
 * Clear all SEO analysis cache (comprehensive_seo_analyses). Next analyses use latest prompts.
 */
router.delete('/seo-cache', async (req, res) => {
  try {
    const countResult = await db.query('SELECT COUNT(*) AS c FROM comprehensive_seo_analyses');
    const before = parseInt(countResult.rows?.[0]?.c ?? 0, 10);
    const result = await db.query('DELETE FROM comprehensive_seo_analyses RETURNING id');
    const cleared = result.rowCount ?? 0;
    res.json({
      success: true,
      message: cleared > 0 ? `Cleared ${cleared} SEO analysis cache entry(ies).` : 'No SEO cache entries to clear.',
      cleared,
      before
    });
  } catch (err) {
    console.error('Admin seo-cache clear error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to clear SEO cache' });
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
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 1100px; margin: 0 auto; padding: 1.5rem; background: #0f0f12; color: #e4e4e7; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .sub { color: #71717a; font-size: 0.9rem; margin-bottom: 1.5rem; }
    section { background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
    section h2 { font-size: 1rem; margin: 0 0 0.75rem; color: #a1a1aa; }
    .row { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.75rem; }
    .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
    .chart-wrap { position: relative; height: 220px; }
    input[type="url"] { flex: 1; min-width: 200px; padding: 0.5rem 0.75rem; border: 1px solid #3f3f46; border-radius: 6px; background: #27272a; color: #e4e4e7; }
    button { padding: 0.5rem 1rem; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-primary:hover { background: #2563eb; }
    .btn-danger { background: #dc2626; color: #fff; }
    .btn-danger:hover { background: #b91c1c; }
    .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-sm { padding: 0.25rem 0.5rem; font-size: 0.85rem; }
    .msg { margin-top: 0.5rem; padding: 0.5rem; border-radius: 6px; font-size: 0.9rem; }
    .msg.success { background: #14532d; color: #86efac; }
    .msg.error { background: #450a0a; color: #fca5a5; }
    .msg.info { background: #1e3a5f; color: #93c5fd; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #27272a; }
    th { color: #71717a; font-weight: 500; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.75rem; margin-bottom: 1rem; }
    .stat-card { background: #27272a; border-radius: 6px; padding: 0.75rem; }
    .stat-card .label { color: #a1a1aa; font-size: 0.8rem; }
    .stat-card .value { font-size: 1.1rem; font-weight: 600; }
  </style>
</head>
<body>
  <h1>AutoBlog Admin</h1>
  <p class="sub">Stats, job queue, cache · <a href="/admin/login" id="logout-link">Log out</a></p>

  <section>
    <h2>Overview</h2>
    <div class="row"><button class="btn-primary" id="refresh-stats">Refresh</button></div>
    <div id="stats-error" class="msg" style="display: none;"></div>
    <div id="stat-cards" class="stat-grid"></div>
    <div id="stats-charts" class="charts"></div>
  </section>

  <section>
    <h2>SEO analysis cache</h2>
    <p style="margin: 0 0 0.75rem; color: #a1a1aa; font-size: 0.9rem;">Cached comprehensive SEO analyses. Clear to force new analyses to use the latest prompts.</p>
    <div class="row">
      <span id="seo-cache-count" style="color: #a1a1aa;">—</span>
      <button class="btn-danger" id="clear-seo-cache">Clear all SEO cache</button>
    </div>
    <div id="seo-cache-msg" class="msg" style="display: none;"></div>
  </section>

  <section>
    <h2>Cached URLs (website analysis)</h2>
    <div class="row">
      <button class="btn-primary" id="load-cache-urls">Load list</button>
      <button class="btn-danger" id="clear-all-cache">Clear all cache</button>
    </div>
    <div id="cache-urls-msg" class="msg" style="display: none;"></div>
    <div id="cache-urls-table"></div>
  </section>

  <section>
    <h2>Recent jobs</h2>
    <div class="row"><button class="btn-primary" id="load-recent-jobs">Load recent jobs</button></div>
    <div id="recent-jobs-table"></div>
  </section>

  <section>
    <h2>Cache by URL</h2>
    <p style="margin: 0 0 0.75rem; color: #a1a1aa; font-size: 0.9rem;">View or clear cache for a single URL.</p>
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
    const adminToken = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('adminToken') : null;

    function headers() {
      const h = { 'Content-Type': 'application/json' };
      if (adminKey) h['x-admin-key'] = adminKey;
      if (adminToken) h['Authorization'] = 'Bearer ' + adminToken;
      return h;
    }

    function opts(method) {
      return { method, headers: headers(), credentials: 'same-origin' };
    }

    function checkAuth(r) {
      if (r.status === 401) {
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('adminToken');
        window.location.href = '/admin/login';
      }
    }

    document.getElementById('logout-link').onclick = function(e) {
      e.preventDefault();
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('adminToken');
      window.location.href = '/admin/login';
    };

    function formatBytes(n) {
      if (n == null) return '—';
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      return (n / (1024 * 1024)).toFixed(2) + ' MB';
    }

    let jobChart = null, tablesChart = null;
    async function loadStats() {
      const cardsEl = document.getElementById('stat-cards');
      const chartsEl = document.getElementById('stats-charts');
      const errEl = document.getElementById('stats-error');
      cardsEl.innerHTML = 'Loading…';
      chartsEl.innerHTML = '';
      errEl.style.display = 'none';
      if (typeof Chart !== 'undefined' && jobChart) { jobChart.destroy(); jobChart = null; }
      if (typeof Chart !== 'undefined' && tablesChart) { tablesChart.destroy(); tablesChart = null; }
      try {
        const r = await fetch(base + '/stats', opts('GET'));
        checkAuth(r);
        const data = await r.json();
        if (!r.ok) {
          cardsEl.innerHTML = '';
          errEl.textContent = data.error || data.message || r.status;
          errEl.style.display = 'block';
          return;
        }
        const app = data.app || {};
        const db = data.db || {};
        cardsEl.innerHTML = '<div class="stat-card"><span class="label">Node</span><div class="value">' + (app.nodeVersion || '—') + '</div></div>' +
          '<div class="stat-card"><span class="label">Redis</span><div class="value">' + (app.redis || '—') + '</div></div>' +
          '<div class="stat-card"><span class="label">DB size</span><div class="value">' + formatBytes(db.sizeBytes) + '</div></div>' +
          '<div class="stat-card"><span class="label">Jobs total</span><div class="value">' + (db.jobSummary ? db.jobSummary.total : '—') + '</div></div>';
        if (db.jobSummary && typeof Chart !== 'undefined') {
          const ctx = document.createElement('canvas').getContext('2d');
          const wrap = document.createElement('div');
          wrap.className = 'chart-wrap';
          wrap.appendChild(ctx.canvas);
          chartsEl.appendChild(wrap);
          const s = db.jobSummary.byStatus;
          jobChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
              labels: ['Queued', 'Running', 'Succeeded', 'Failed'],
              datasets: [{ data: [s.queued || 0, s.running || 0, s.succeeded || 0, s.failed || 0], backgroundColor: ['#3b82f6', '#eab308', '#22c55e', '#ef4444'] }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
          });
        }
        if (db.tables && typeof Chart !== 'undefined') {
          const ctx2 = document.createElement('canvas').getContext('2d');
          const wrap2 = document.createElement('div');
          wrap2.className = 'chart-wrap';
          wrap2.appendChild(ctx2.canvas);
          chartsEl.appendChild(wrap2);
          const names = Object.keys(db.tables);
          const vals = names.map(function(k) { return db.tables[k] || 0; });
          tablesChart = new Chart(ctx2, {
            type: 'bar',
            data: {
              labels: names,
              datasets: [{ label: 'Rows', data: vals, backgroundColor: '#3b82f6' }]
            },
            options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
          });
        }
        var seoEl = document.getElementById('seo-cache-count');
        if (seoEl) seoEl.textContent = (db.tables && db.tables.comprehensive_seo_analyses != null) ? db.tables.comprehensive_seo_analyses + ' cached analyses' : '—';
      } catch (e) {
        cardsEl.innerHTML = '';
        document.getElementById('stats-error').textContent = 'Error: ' + e.message;
        document.getElementById('stats-error').style.display = 'block';
      }
    }
    document.getElementById('refresh-stats').onclick = loadStats;
    loadStats();

    document.getElementById('clear-seo-cache').onclick = async () => {
      if (!confirm('Clear all SEO analysis cache? Next analyses will use the latest prompts.')) return;
      var msgEl = document.getElementById('seo-cache-msg');
      msgEl.style.display = 'block';
      msgEl.className = 'msg info';
      msgEl.textContent = 'Clearing…';
      try {
        var r = await fetch(base + '/seo-cache', { method: 'DELETE', headers: headers(), credentials: 'same-origin' });
        checkAuth(r);
        var data = await r.json();
        msgEl.className = 'msg ' + (r.ok ? 'success' : 'error');
        msgEl.textContent = r.ok ? (data.message || 'Cleared') : (data.error || data.message || r.status);
        if (r.ok) loadStats();
      } catch (e) {
        msgEl.className = 'msg error';
        msgEl.textContent = 'Error: ' + e.message;
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

    document.getElementById('load-cache-urls').onclick = async () => {
      const msgEl = document.getElementById('cache-urls-msg');
      const tableEl = document.getElementById('cache-urls-table');
      msgEl.style.display = 'none';
      tableEl.innerHTML = 'Loading…';
      try {
        const r = await fetch(base + '/cache/urls', opts('GET'));
        checkAuth(r);
        const data = await r.json();
        if (!r.ok) { msgEl.textContent = data.error || data.message || r.status; msgEl.className = 'msg error'; msgEl.style.display = 'block'; tableEl.innerHTML = ''; return; }
        if (!data.urls || data.urls.length === 0) { tableEl.innerHTML = '<p style="color:#a1a1aa">No cached URLs.</p>'; return; }
        let html = '<table><tr><th>URL</th><th>Last analyzed</th><th></th></tr>';
        data.urls.forEach(function(u) {
          html += '<tr><td>' + (u.websiteUrl || '') + '</td><td>' + (u.lastAnalyzedAt || '—') + '</td><td><button class="btn-danger btn-sm" data-url="' + (u.websiteUrl || '').replace(/"/g, '&quot;') + '">Clear</button></td></tr>';
        });
        html += '</table>';
        tableEl.innerHTML = html;
        tableEl.querySelectorAll('button[data-url]').forEach(function(btn) {
          btn.onclick = async function() {
            var url = btn.getAttribute('data-url');
            if (!confirm('Clear cache for ' + url + '?')) return;
            try {
              var rr = await fetch(base + '/cache?url=' + encodeURIComponent(url), { method: 'DELETE', headers: headers(), credentials: 'same-origin' });
              checkAuth(rr);
              if (rr.ok) document.getElementById('load-cache-urls').click();
            } catch (e) { msgEl.textContent = e.message; msgEl.className = 'msg error'; msgEl.style.display = 'block'; }
          };
        });
      } catch (e) { msgEl.textContent = 'Error: ' + e.message; msgEl.className = 'msg error'; msgEl.style.display = 'block'; tableEl.innerHTML = ''; }
    };

    document.getElementById('clear-all-cache').onclick = async () => {
      if (!confirm('Clear all website analysis cache? This cannot be undone.')) return;
      const msgEl = document.getElementById('cache-urls-msg');
      try {
        const r = await fetch(base + '/cache/all', { method: 'DELETE', headers: headers(), credentials: 'same-origin' });
        checkAuth(r);
        const data = await r.json();
        msgEl.style.display = 'block';
        msgEl.className = 'msg ' + (r.ok ? 'success' : 'error');
        msgEl.textContent = r.ok ? (data.message || 'Cleared') : (data.error || data.message || r.status);
        if (r.ok) document.getElementById('load-cache-urls').click();
      } catch (e) { msgEl.textContent = e.message; msgEl.className = 'msg error'; msgEl.style.display = 'block'; }
    };

    document.getElementById('load-recent-jobs').onclick = async () => {
      const tableEl = document.getElementById('recent-jobs-table');
      tableEl.innerHTML = 'Loading…';
      try {
        const r = await fetch(base + '/jobs/recent?limit=25', opts('GET'));
        checkAuth(r);
        const data = await r.json();
        if (!r.ok) { tableEl.innerHTML = '<p class="msg error">' + (data.error || data.message || r.status) + '</p>'; return; }
        if (!data.jobs || data.jobs.length === 0) { tableEl.innerHTML = '<p style="color:#a1a1aa">No jobs.</p>'; return; }
        let html = '<table><tr><th>Type</th><th>Status</th><th>Created</th><th>Error</th></tr>';
        data.jobs.forEach(function(j) {
          html += '<tr><td>' + (j.type || '') + '</td><td>' + (j.status || '') + '</td><td>' + (j.createdAt || '—') + '</td><td>' + (j.error ? '<span title="' + (j.error || '').replace(/"/g, '&quot;') + '">' + (j.error.slice(0, 50)) + (j.error.length > 50 ? '…' : '') + '</span>' : '—') + '</td></tr>';
        });
        html += '</table>';
        tableEl.innerHTML = html;
      } catch (e) { tableEl.innerHTML = '<p class="msg error">Error: ' + e.message + '</p>'; }
    };

    document.getElementById('view-cache').onclick = async () => {
      const url = document.getElementById('cache-url').value.trim();
      if (!url) { showCacheMsg('Enter a URL', 'error'); return; }
      showCacheMsg('Loading…', 'info');
      showCacheResult('');
      try {
        const r = await fetch(base + '/cache?url=' + encodeURIComponent(url), opts('GET'));
        checkAuth(r);
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
        checkAuth(r);
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

/**
 * Login page HTML: email/password form that uses POST /api/v1/auth/login.
 * Only super_admin users are allowed; token is stored in sessionStorage and used for /admin.
 */
export function adminLoginHtml() {
  return loginFormHtml();
}

function loginFormHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Login — AutoBlog</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 400px; margin: 4rem auto; padding: 1.5rem; background: #0f0f12; color: #e4e4e7; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .sub { color: #71717a; font-size: 0.9rem; margin-bottom: 1.5rem; }
    form { background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 1.5rem; }
    label { display: block; margin-bottom: 0.25rem; color: #a1a1aa; font-size: 0.9rem; }
    input[type="email"], input[type="password"] { width: 100%; padding: 0.6rem 0.75rem; margin-bottom: 1rem; border: 1px solid #3f3f46; border-radius: 6px; background: #27272a; color: #e4e4e7; }
    button { width: 100%; padding: 0.6rem 1rem; border-radius: 6px; border: none; background: #3b82f6; color: #fff; font-weight: 500; cursor: pointer; }
    button:hover { background: #2563eb; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .msg { margin-top: 1rem; padding: 0.6rem; border-radius: 6px; font-size: 0.9rem; }
    .msg.error { background: #450a0a; color: #fca5a5; }
    .msg.success { background: #14532d; color: #86efac; }
    a { color: #3b82f6; }
    .loading { color: #a1a1aa; text-align: center; padding: 2rem; }
  </style>
</head>
<body>
  <div id="admin-root">
    <div id="login-form-container">
      <h1>Admin Login</h1>
      <p class="sub">Sign in with a super admin account</p>
      <form id="login-form">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required autocomplete="email" />
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password" />
        <button type="submit" id="submit-btn">Sign in</button>
        <div id="msg" class="msg" style="display: none;"></div>
      </form>
    </div>
    <div id="loading-panel" class="loading" style="display: none;">Loading panel…</div>
  </div>
  <script>
    (function() {
      var token = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('adminToken') : null;
      var adminKey = new URLSearchParams(window.location.search).get('admin_key') || '';

      if (token || adminKey) {
        document.getElementById('login-form-container').style.display = 'none';
        document.getElementById('loading-panel').style.display = 'block';
        var headers = { 'Content-Type': 'text/html' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        if (adminKey) headers['x-admin-key'] = adminKey;
        fetch('/api/v1/admin-panel', { method: 'GET', headers: headers, credentials: 'same-origin' })
          .then(function(r) {
            if (r.status === 401) {
              if (sessionStorage) sessionStorage.removeItem('adminToken');
              window.location.href = '/admin';
              return null;
            }
            return r.text();
          })
          .then(function(html) {
            if (!html) return;
            document.open();
            document.write(html);
            document.close();
          })
          .catch(function(err) {
            document.getElementById('loading-panel').textContent = 'Error: ' + (err.message || 'Failed to load');
            document.getElementById('login-form-container').style.display = 'block';
            document.getElementById('loading-panel').style.display = 'none';
          });
        return;
      }

      var form = document.getElementById('login-form');
      var msg = document.getElementById('msg');
      var submitBtn = document.getElementById('submit-btn');
      function showMsg(text, type) {
        msg.textContent = text;
        msg.className = 'msg ' + (type || 'error');
        msg.style.display = 'block';
      }
      form.onsubmit = async function(e) {
        e.preventDefault();
        submitBtn.disabled = true;
        msg.style.display = 'none';
        var email = document.getElementById('email').value.trim();
        var password = document.getElementById('password').value;
        try {
          var r = await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
            credentials: 'same-origin'
          });
          var data = await r.json().catch(function() { return {}; });
          if (!r.ok) {
            showMsg(data.message || data.error || 'Login failed');
            submitBtn.disabled = false;
            return;
          }
          var role = data.user && (data.user.role || data.user.role_name);
          if (role !== 'super_admin') {
            showMsg('Access denied. Super admin account required.');
            submitBtn.disabled = false;
            return;
          }
          if (data.accessToken) sessionStorage.setItem('adminToken', data.accessToken);
          window.location.href = '/admin';
        } catch (err) {
          showMsg('Error: ' + (err.message || 'Request failed'));
          submitBtn.disabled = false;
        }
      };
    })();
  </script>
</body>
</html>`;
}

/**
 * Shell for GET /admin: shows login form, or if token/admin_key present fetches panel with auth and writes it.
 * Use this for GET /admin so that after redirect from login the client can send the token via fetch.
 */
export function adminShellHtml() {
  return loginFormHtml();
}

export { adminPanelHtml };
export default router;
