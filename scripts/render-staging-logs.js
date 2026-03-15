#!/usr/bin/env node
/**
 * Fetch Render staging worker logs and optionally analyze them.
 *
 * Prerequisites:
 *   - Render CLI installed: brew install render
 *   - Authenticated: render login (or set RENDER_API_KEY)
 *   - Workspace: run `render workspace set` once, or set RENDER_WORKSPACE_ID (e.g. tea-xxx from `render workspaces -o json`)
 *   - Staging worker service ID: set RENDER_STAGING_WORKER_SERVICE_ID or pass --service-id
 *     (Find it in Render Dashboard → your staging Background Worker → URL or Settings.)
 *
 * Usage:
 *   node scripts/render-staging-logs.js [options]
 *
 * Options:
 *   --service-id <id>  Render service ID for staging worker (or env RENDER_STAGING_WORKER_SERVICE_ID)
 *   --since <time>     e.g. 1h, 30m, 24h (default: 24h); used to set --start for render logs
 *   --limit <n>        max log entries (default: 200)
 *   --text <query>     filter logs containing this text
 *   --level <level>    filter by level (e.g. error, info)
 *   --output <file>    write raw output to file
 *   --no-analyze       only fetch (and optionally save), skip analysis
 */

import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';

const DEFAULT_SINCE = '24h';
const DEFAULT_LIMIT = 200;

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    serviceId: process.env.RENDER_STAGING_WORKER_SERVICE_ID || null,
    since: DEFAULT_SINCE,
    limit: DEFAULT_LIMIT,
    text: null,
    level: null,
    output: null,
    analyze: true,
  };
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--service-id' || args[i] === '-s') && args[i + 1]) {
      options.serviceId = args[++i];
    } else if (args[i] === '--since' && args[i + 1]) {
      options.since = args[++i];
    } else if ((args[i] === '--limit' || args[i] === '-n') && args[i + 1]) {
      options.limit = parseInt(args[++i], 10) || DEFAULT_LIMIT;
    } else if ((args[i] === '--text' || args[i] === '-q') && args[i + 1]) {
      options.text = args[++i];
    } else if (args[i] === '--level' && args[i + 1]) {
      options.level = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (args[i] === '--no-analyze') {
      options.analyze = false;
    }
  }
  return options;
}

/**
 * Parse --since (e.g. 1h, 30m, 24h) into milliseconds.
 */
function sinceToMs(since) {
  const match = since.trim().match(/^(\d+)(m|h|d)$/i);
  if (!match) {
    throw new Error(`Invalid --since "${since}". Use e.g. 1h, 30m, 24h.`);
  }
  const n = parseInt(match[1], 10);
  const unit = (match[2] || 'h').toLowerCase();
  const multipliers = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return n * (multipliers[unit] || multipliers.h);
}

/**
 * ISO string for Render CLI --start (logs from this time onward).
 */
function startTimeFromSince(since) {
  const ms = sinceToMs(since);
  return new Date(Date.now() - ms).toISOString();
}

function buildLogsCommand(opts) {
  if (!opts.serviceId) {
    throw new Error(
      'Staging worker service ID required. Set RENDER_STAGING_WORKER_SERVICE_ID or pass --service-id <id>. ' +
        'Find it in Render Dashboard → your staging Background Worker.'
    );
  }
  const parts = [
    'render', 'logs',
    '-r', opts.serviceId,
    '--output', 'json',
    '--confirm',
    '--limit', String(opts.limit),
  ];
  const sinceMs = sinceToMs(opts.since);
  if (sinceMs > 0 && sinceMs <= 24 * 60 * 60 * 1000) {
    parts.push('--start', startTimeFromSince(opts.since));
  }
  if (opts.text) parts.push('--text', opts.text);
  if (opts.level) parts.push('--level', opts.level);
  return parts;
}

function ensureWorkspace() {
  const workspaceId = process.env.RENDER_WORKSPACE_ID;
  if (!workspaceId) return;
  try {
    execFileSync('render', ['workspace', 'set', workspaceId, '--confirm'], {
      encoding: 'utf-8',
      timeout: 10000,
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // ignore; logs command will fail with a clear message if workspace is required
  }
}

function fetchLogs(opts) {
  ensureWorkspace();
  const parts = buildLogsCommand(opts);
  const [bin, ...args] = parts;
  console.error('Running: render logs -r', opts.serviceId, '...');
  try {
    const out = execFileSync(bin, args, {
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, CI: '1' },
    });
    return out;
  } catch (e) {
    if (e.stderr) console.error(e.stderr);
    if (e.stdout) console.error(e.stdout);
    throw new Error(
      `render logs failed: ${e.message}. Ensure Render CLI is installed (brew install render), ` +
        'logged in (render login or RENDER_API_KEY), and RENDER_STAGING_WORKER_SERVICE_ID is set.'
    );
  }
}

/**
 * Render CLI outputs a stream of pretty-printed JSON objects (one per log entry).
 * Objects are separated by "}\n{" or "}{". Parse by splitting on that boundary.
 */
function parseLogsOutput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const first = trimmed.charAt(0);
  if (first === '[') {
    return JSON.parse(trimmed);
  }
  if (first === '{' && trimmed.charAt(trimmed.length - 1) === '}' && trimmed.indexOf('}\n{') === -1 && trimmed.indexOf('}{') === -1) {
    const obj = JSON.parse(trimmed);
    if (Array.isArray(obj.logs)) return obj.logs;
    if (Array.isArray(obj.entries)) return obj.entries;
    return [obj];
  }
  const entries = [];
  const segments = trimmed.split(/\}\s*\{/);
  for (let i = 0; i < segments.length; i++) {
    let seg = segments[i].trim();
    if (!seg) continue;
    if (!seg.startsWith('{')) seg = '{' + seg;
    if (!seg.endsWith('}')) seg = seg + '}';
    try {
      entries.push(JSON.parse(seg));
    } catch {
      entries.push({ message: seg.slice(0, 200) });
    }
  }
  return entries;
}

function levelFromLabels(labels) {
  if (!Array.isArray(labels)) return 'info';
  const levelLabel = labels.find((l) => l && l.name === 'level');
  return (levelLabel && levelLabel.value) ? levelLabel.value.toLowerCase() : 'info';
}

function analyze(entries) {
  const byLevel = {};
  const errors = [];
  const jobMatches = [];

  for (const log of entries) {
    const msg = log.message ?? log.messageBody ?? log.text ?? '';
    const level = (log.level || log.severity || levelFromLabels(log.labels) || 'info').toLowerCase();
    byLevel[level] = (byLevel[level] || 0) + 1;

    if (level === 'error' || level === 'fatal' || /error|Error|failed|Failed|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
      errors.push({
        ts: log.timestamp ?? log.timestampInMs ?? log.createdAt ?? '',
        level,
        message: String(msg).slice(0, 300),
      });
    }
    if (/job|queue|website_analysis|content_generation|content_calendar|amb-jobs|Processing/i.test(msg)) {
      jobMatches.push({ ts: log.timestamp ?? log.createdAt ?? '', message: String(msg).slice(0, 200) });
    }
  }

  console.log('\n--- Render staging worker log analysis ---\n');
  console.log('By level:', byLevel);
  if (errors.length > 0) {
    console.log('\nRecent errors/failures:');
    errors.slice(-25).forEach((e) => {
      console.log(`  ${e.ts} [${e.level}] ${e.message}`);
    });
  }
  if (jobMatches.length > 0) {
    console.log('\nRecent job/queue-related lines (last 15):');
    jobMatches.slice(-15).forEach((e) => {
      console.log(`  ${e.ts} ${e.message}`);
    });
  }
  console.log('');
}

function main() {
  const opts = parseArgs();
  const raw = fetchLogs(opts);
  const entries = parseLogsOutput(raw);

  console.error(`Fetched ${entries.length} log entries (staging worker, since ${opts.since}).`);

  if (opts.output) {
    writeFileSync(opts.output, raw, 'utf-8');
    console.error(`Wrote raw logs to ${opts.output}.`);
  }

  if (opts.analyze && entries.length > 0) {
    analyze(entries);
  } else if (!opts.analyze) {
    console.log(raw);
  }
}

main();
