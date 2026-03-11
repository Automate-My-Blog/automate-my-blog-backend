#!/usr/bin/env node
/**
 * Cursor automation: run Vercel staging logs, analyze for problems, create GitHub issues.
 *
 * 1. Runs vercel-staging-logs.js (error-level logs) and writes raw JSON to a temp file.
 * 2. Parses logs, groups by path + status + message signature.
 * 3. For each problem group, creates a GitHub issue unless an open issue already
 *    exists for that path+status (avoids duplicates). Uses label "staging-logs".
 *
 * Prerequisites:
 *   - vercel CLI linked and logged in (or VERCEL_TOKEN)
 *   - gh CLI installed and authenticated (gh auth login)
 *
 * Usage:
 *   node scripts/analyze-staging-logs-create-issues.js [--since 24h] [--dry-run]
 *
 * Options:
 *   --since <time>   Log window (default: 24h)
 *   --dry-run        Do not create issues; only print what would be created
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const LABEL = 'staging-logs';
const DEFAULT_SINCE = '24h';

function parseArgs() {
  const args = process.argv.slice(2);
  let since = DEFAULT_SINCE;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since' && args[i + 1]) since = args[++i];
    if (args[i] === '--dry-run') dryRun = true;
  }
  return { since, dryRun };
}

function runVercelLogs(since, outputPath) {
  const cmd = `node scripts/vercel-staging-logs.js --since ${since} --limit 500 --level error --output "${outputPath}" --no-analyze`;
  console.error('Running:', cmd);
  try {
    execSync(cmd, { encoding: 'utf-8', timeout: 90000, maxBuffer: 10 * 1024 * 1024, cwd: process.cwd() });
  } catch (e) {
    console.error(e.stderr || e.message);
    throw new Error('vercel-staging-logs.js failed. Ensure vercel link and vercel login (or VERCEL_TOKEN).');
  }
}

function parseJsonLines(raw) {
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { message: line };
      }
    });
}

/** Normalize message to a short signature for grouping (first meaningful part). */
function messageSignature(msg) {
  if (!msg || typeof msg !== 'string') return '(no message)';
  const s = msg.replace(/\s+/g, ' ').trim().slice(0, 80);
  return s || '(no message)';
}

/** Group log entries into problem buckets by path + status; count and collect message samples. */
function groupProblems(entries) {
  const byPathStatus = new Map();
  for (const log of entries) {
    const status = log.responseStatusCode;
    const path = log.requestPath || log.request?.path || '?';
    const level = (log.level || '').toLowerCase();
    const isError = level === 'error' || level === 'fatal' || (status >= 500 && log.message);
    if (!isError) continue;

    const method = log.requestMethod || 'GET';
    const k = `${path}\t${String(status ?? '?')}\t${method}`;
    if (!byPathStatus.has(k)) {
      byPathStatus.set(k, {
        path,
        method,
        status: status ?? '?',
        count: 0,
        messageSamples: [],
      });
    }
    const p = byPathStatus.get(k);
    p.count += 1;
    const sample = (log.message || '').trim().slice(0, 300);
    if (sample && !p.messageSamples.includes(sample)) {
      p.messageSamples.push(sample);
    }
  }
  return Array.from(byPathStatus.values());
}

function getExistingOpenIssueTitles() {
  try {
    const out = execSync(
      `gh issue list --label "${LABEL}" --state open --json title`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const list = JSON.parse(out);
    return (list || []).map((i) => i.title || '');
  } catch {
    return [];
  }
}

function issueAlreadyExists(titles, path, status) {
  const pathPart = path.replace(/\s/g, '');
  const statusStr = String(status);
  for (const t of titles) {
    if (t.includes(statusStr) && (t.includes(path) || t.includes(pathPart))) return true;
  }
  return false;
}

function createIssue(problem, dryRun) {
  const firstMsg = problem.messageSamples[0] ? messageSignature(problem.messageSamples[0]).slice(0, 50) : 'see logs';
  const title = `[Staging] ${problem.status} on ${problem.method} ${problem.path} — ${firstMsg}`;
  const samples = problem.messageSamples.slice(0, 5).length
    ? problem.messageSamples.slice(0, 5).join('\n- ')
    : '(no message in logs)';
  const body = `## Summary
Staging logs show **${problem.status}** responses for \`${problem.method} ${problem.path}\` (${problem.count} occurrence(s) in the analyzed window).

## Source
Automated run of \`scripts/analyze-staging-logs-create-issues.js\` (Vercel staging logs, error-level).

## Sample log message(s)
- ${samples}

## Next steps
- Reproduce on staging with the same path/method.
- Check Vercel runtime logs or \`vercel logs --branch staging --level error\` for stack traces.
- Fix backend validation/error handling or document expected client behavior.
`;

  if (dryRun) {
    console.log('[dry-run] Would create issue:', title);
    return null;
  }

  try {
    const out = execSync(
      `gh issue create --title ${JSON.stringify(title)} --body ${JSON.stringify(body)} --label "${LABEL}"`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    console.log('Created:', out.trim());
    return out.trim();
  } catch (e) {
    console.error('Failed to create issue:', e.stderr || e.message);
    return null;
  }
}

function main() {
  const { since, dryRun } = parseArgs();
  const tmpDir = mkdtempSync(join(tmpdir(), 'staging-logs-'));
  const outputPath = join(tmpDir, 'errors.jsonl');

  console.error(`Fetching staging logs (since ${since})...`);
  runVercelLogs(since, outputPath);

  const raw = readFileSync(outputPath, 'utf-8');
  const entries = parseJsonLines(raw);
  const problems = groupProblems(entries);

  console.error(`Found ${problems.length} distinct problem type(s) from ${entries.length} error-level log entries.`);

  if (problems.length === 0) {
    console.log('No problems to report. Exiting.');
    return;
  }

  const existingTitles = getExistingOpenIssueTitles();
  let created = 0;
  for (const p of problems) {
    if (issueAlreadyExists(existingTitles, p.path, p.status)) {
      console.error(`Skipping (open issue exists): ${p.status} ${p.path}`);
      continue;
    }
    const url = createIssue(p, dryRun);
    if (url) {
      created++;
      existingTitles.push(`[Staging] ${p.status} on ${p.method} ${p.path}`);
    }
  }

  console.log(dryRun ? `[dry-run] Would create ${problems.length} issue(s).` : `Created ${created} new issue(s).`);
}

main();
