#!/usr/bin/env node
/**
 * Run the full Captain voice workflow against a live API (e.g. staging).
 * Usage: BASE_URL=... STAGING_TEST_EMAIL=... STAGING_TEST_PASSWORD=... node run-full-workflow.js
 * Or: BASE_URL=... STAGING_JWT=... node run-full-workflow.js
 * Staging: https://automate-my-blog-backend-env-staging-automate-my-blog.vercel.app
 * Loads .env from repo root if present.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = [
  { file: 'persona-blog.md', sourceType: 'blog_post' },
  { file: 'persona-whitepaper.md', sourceType: 'whitepaper' },
  { file: 'persona-email.eml', sourceType: 'email' },
  { file: 'persona-newsletter.html', sourceType: 'newsletter' },
  { file: 'persona-social.json', sourceType: 'social_post' },
  { file: 'persona-call-summary.txt', sourceType: 'call_summary' },
  { file: 'persona-other.txt', sourceType: 'other_document' },
];

const DEFAULT_STAGING = 'https://automate-my-blog-backend-env-staging-automate-my-blog.vercel.app';
const BASE_URL = (process.env.BASE_URL || process.env.STAGING_BASE_URL || DEFAULT_STAGING).replace(/\/$/, '');
const EMAIL = process.env.STAGING_TEST_EMAIL || process.env.VOICE_TEST_EMAIL;
const PASSWORD = process.env.STAGING_TEST_PASSWORD || process.env.VOICE_TEST_PASSWORD;
const JWT = process.env.STAGING_JWT || process.env.VOICE_TEST_JWT;

function log(msg, type = 'info') {
  const prefix = type === 'err' ? '❌' : type === 'ok' ? '✅' : '▶';
  console.log(`${prefix} ${msg}`);
}

async function login(baseUrl) {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Login failed (${res.status}): ${t}`);
  }
  const data = await res.json();
  if (!data.accessToken) throw new Error('Login response missing accessToken');
  const orgId = data.user?.organizationId || data.user?.organization_id;
  if (!orgId) throw new Error('Login response missing user.organizationId');
  return { token: data.accessToken, orgId, user: data.user };
}

async function uploadFixture(baseUrl, token, orgId, fixture) {
  const filePath = path.join(__dirname, fixture.file);
  if (!fs.existsSync(filePath)) {
    log(`Fixture missing: ${fixture.file}`, 'err');
    return null;
  }
  const body = new FormData();
  body.append('organizationId', orgId);
  body.append('sourceType', fixture.sourceType);
  body.append('files', new Blob([fs.readFileSync(filePath)]), fixture.file);

  const res = await fetch(`${baseUrl}/api/v1/voice-samples/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Upload ${fixture.file} failed (${res.status}): ${t}`);
  }
  const data = await res.json();
  return data;
}

async function listSamples(baseUrl, token, orgId) {
  const res = await fetch(`${baseUrl}/api/v1/voice-samples/${orgId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`List samples failed (${res.status})`);
  const data = await res.json();
  return data.samples || [];
}

async function getProfile(baseUrl, token, orgId) {
  const res = await fetch(`${baseUrl}/api/v1/voice-samples/${orgId}/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Get profile failed (${res.status})`);
  const data = await res.json();
  return data.profile;
}

async function getContext(baseUrl, token, orgId, useVoiceProfile = true) {
  const url = `${baseUrl}/api/v1/enhanced-blog-generation/context/${orgId}?useVoiceProfile=${useVoiceProfile}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Get context failed (${res.status})`);
  return await res.json();
}

async function main() {
  if (!BASE_URL) {
    log('Set BASE_URL or STAGING_BASE_URL to the API base (e.g. https://automate-my-blog-backend-env-staging-xxx.vercel.app)', 'err');
    process.exit(1);
  }
  let token, orgId;
  if (JWT) {
    token = JWT.replace(/^Bearer\s+/i, '');
    const meRes = await fetch(`${BASE_URL}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!meRes.ok) {
      log('STAGING_JWT invalid or expired', 'err');
      process.exit(1);
    }
    const me = await meRes.json();
    orgId = me.user?.organizationId || me.user?.organization_id;
    if (!orgId) {
      log('User has no organizationId', 'err');
      process.exit(1);
    }
    log(`Using JWT; orgId=${orgId}`);
  } else if (EMAIL && PASSWORD) {
    log('Logging in...');
    ({ token, orgId } = await login(BASE_URL));
    log(`Logged in; orgId=${orgId}`, 'ok');
  } else {
    log('Set STAGING_TEST_EMAIL + STAGING_TEST_PASSWORD, or STAGING_JWT', 'err');
    process.exit(1);
  }

  // 1. Upload all fixtures
  log('Uploading Captain fixtures...');
  for (const fixture of FIXTURES) {
    try {
      const result = await uploadFixture(BASE_URL, token, orgId, fixture);
      if (result?.samples?.length) {
        const ids = result.samples.map((s) => s.id).join(', ');
        log(`  ${fixture.file} (${fixture.sourceType}): ${result.samples.length} sample(s) ${ids}`, 'ok');
      }
    } catch (e) {
      log(`  ${fixture.file}: ${e.message}`, 'err');
    }
  }

  // 2. Poll until all samples are completed (or timeout)
  log('Waiting for voice analysis jobs (polling every 5s, max 3 min)...');
  const deadline = Date.now() + 180000;
  let lastPending = -1;
  while (Date.now() < deadline) {
    const samples = await listSamples(BASE_URL, token, orgId);
    const pending = samples.filter((s) => s.processing_status === 'pending' || s.processing_status === 'processing').length;
    const completed = samples.filter((s) => s.processing_status === 'completed').length;
    const failed = samples.filter((s) => s.processing_status === 'failed').length;
    if (pending !== lastPending) {
      log(`  Samples: ${completed} completed, ${pending} pending, ${failed} failed`);
      lastPending = pending;
    }
    if (pending === 0) {
      if (failed > 0) log(`  ${failed} sample(s) failed analysis`, 'err');
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  const samples = await listSamples(BASE_URL, token, orgId);
  const stillPending = samples.filter((s) => s.processing_status === 'pending' || s.processing_status === 'processing').length;
  if (stillPending > 0) {
    log(`Timeout: ${stillPending} sample(s) still pending. Worker may not be running or Redis unavailable.`, 'err');
  }

  // 3. Get aggregated profile
  const profile = await getProfile(BASE_URL, token, orgId);
  if (!profile) {
    log('No aggregated voice profile (expected after analyses complete).', 'err');
    process.exit(1);
  }
  log('Aggregated profile:', 'ok');
  log(`  sample_count=${profile.sample_count} total_word_count=${profile.total_word_count} confidence_score=${profile.confidence_score}`);
  if (profile.style && Object.keys(profile.style).length) {
    log(`  style keys: ${Object.keys(profile.style).slice(0, 8).join(', ')}`);
  }

  // 4. Get context with voice and verify voice is present
  const contextWithVoice = await getContext(BASE_URL, token, orgId, true);
  const contextNoVoice = await getContext(BASE_URL, token, orgId, false);
  const hasVoiceInContext = !!(contextWithVoice?.data?.voiceProfile || contextWithVoice?.metadata?.voiceProfileSummary);
  const voiceComparisonSupported = contextWithVoice?.metadata?.voiceComparisonSupported === true;
  log(`Context useVoiceProfile=true: voice present=${hasVoiceInContext}`, hasVoiceInContext ? 'ok' : 'err');
  log(`Context useVoiceProfile=false: voice present=${!!(contextNoVoice?.data?.voiceProfile)} (should be false)`, !contextNoVoice?.data?.voiceProfile ? 'ok' : 'err');
  log(`voiceComparisonSupported=${voiceComparisonSupported}`, 'info');

  log('Full Captain workflow completed.', 'ok');
}

main().catch((e) => {
  log(e.message, 'err');
  process.exit(1);
});
