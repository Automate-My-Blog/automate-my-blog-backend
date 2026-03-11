#!/usr/bin/env node
/**
 * Fetch Vercel staging logs and optionally analyze them.
 *
 * Prerequisites:
 *   - vercel CLI installed and logged in (or VERCEL_TOKEN set)
 *   - repo linked: vercel link (from repo root)
 *
 * Usage:
 *   node scripts/vercel-staging-logs.js [options]
 *
 * Options:
 *   --since <time>     e.g. 1h, 30m, 24h (default: 24h)
 *   --limit <n>        max entries (default: 500)
 *   --level <level>    filter: error, warning, info, fatal (repeatable)
 *   --status-code <c>  e.g. 5xx, 500
 *   --query <text>     full-text search in messages
 *   --output <file>    write raw JSON lines to file
 *   --no-analyze       only fetch (and optionally save), skip analysis
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const DEFAULT_SINCE = '24h';
const DEFAULT_LIMIT = 500;

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    since: DEFAULT_SINCE,
    limit: DEFAULT_LIMIT,
    level: [],
    statusCode: null,
    query: null,
    output: null,
    analyze: true,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since' && args[i + 1]) {
      options.since = args[++i];
    } else if ((args[i] === '--limit' || args[i] === '-n') && args[i + 1]) {
      options.limit = parseInt(args[++i], 10) || DEFAULT_LIMIT;
    } else if ((args[i] === '--level' || args[i] === '-l') && args[i + 1]) {
      options.level.push(args[++i]);
    } else if ((args[i] === '--status-code') && args[i + 1]) {
      options.statusCode = args[++i];
    } else if ((args[i] === '--query' || args[i] === '-q') && args[i + 1]) {
      options.query = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (args[i] === '--no-analyze') {
      options.analyze = false;
    }
  }
  return options;
}

function buildCliCommand(opts) {
  const parts = [
    'vercel', 'logs',
    '--branch', 'staging',
    '--environment', 'preview',
    '--json',
    '--since', opts.since,
    '--limit', String(opts.limit),
  ];
  opts.level.forEach(l => { parts.push('--level', l); });
  if (opts.statusCode) parts.push('--status-code', opts.statusCode);
  if (opts.query) parts.push('--query', opts.query);
  return parts.join(' ');
}

function fetchLogs(opts) {
  const cmd = buildCliCommand(opts);
  console.error('Running:', cmd);
  try {
    const out = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return out;
  } catch (e) {
    if (e.stderr) console.error(e.stderr);
    throw new Error(`vercel logs failed: ${e.message}. Ensure 'vercel link' and 'vercel login' (or VERCEL_TOKEN).`);
  }
}

function parseJsonLines(raw) {
  const lines = raw.trim().split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      entries.push({ message: line });
    }
  }
  return entries;
}

function analyze(entries) {
  const byLevel = {};
  const byStatus = {};
  const byPath = {};
  const errors = [];

  for (const log of entries) {
    const level = log.level || 'info';
    byLevel[level] = (byLevel[level] || 0) + 1;

    const status = log.responseStatusCode;
    if (status != null) {
      const bucket = status >= 500 ? '5xx' : status >= 400 ? '4xx' : String(status);
      byStatus[bucket] = (byStatus[bucket] || 0) + 1;
    }

    const path = log.requestPath || log.request?.path;
    if (path) {
      byPath[path] = (byPath[path] || 0) + 1;
    }

    if (level === 'error' || level === 'fatal' || (status >= 500 && log.message)) {
      errors.push({
        ts: log.timestampInMs ? new Date(log.timestampInMs).toISOString() : log.timestamp,
        status: status,
        path: path,
        message: (log.message || '').slice(0, 200),
      });
    }
  }

  console.log('\n--- Staging log analysis ---\n');
  console.log('By level:', byLevel);
  console.log('By status:', byStatus);
  if (Object.keys(byPath).length > 0) {
    const topPaths = Object.entries(byPath)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
    console.log('Top paths:', Object.fromEntries(topPaths));
  }
  if (errors.length > 0) {
    console.log('\nRecent errors/failures:');
    errors.slice(-20).forEach(e => {
      console.log(`  ${e.ts} ${e.status || ''} ${e.path || ''} ${e.message}`);
    });
  }
  console.log('');
}

function main() {
  const opts = parseArgs();
  const raw = fetchLogs(opts);
  const entries = parseJsonLines(raw);

  console.error(`Fetched ${entries.length} log entries (staging, since ${opts.since}).`);

  if (opts.output) {
    writeFileSync(opts.output, raw, 'utf-8');
    console.error(`Wrote raw logs to ${opts.output}.`);
  }

  if (opts.analyze && entries.length > 0) {
    analyze(entries);
  } else if (!opts.analyze && entries.length > 0) {
    console.log(raw);
  }
}

main();
