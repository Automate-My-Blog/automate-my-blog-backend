#!/usr/bin/env node
/**
 * Scientific voice profile test: GAN Writing document
 *
 * 1. Ingest: Upload GAN Writing docx as voice sample → wait for analysis
 * 2. Generate: Create a post in their tone (useVoiceProfile: true)
 * 3. Score: Evaluate generated post against reference excerpt
 *
 * Usage:
 *   BASE_URL=... STAGING_TEST_EMAIL=... STAGING_TEST_PASSWORD=... \
 *   GAN_DOCX_PATH=/Users/samhilll/Downloads/GAN\ Writing\ -\ 2024.docx \
 *   node scripts/gan-voice-test/run-gan-voice-test.js
 *
 * Requires: BASE_URL, STAGING_TEST_EMAIL, STAGING_TEST_PASSWORD, GAN_DOCX_PATH (defaults to Downloads path)
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = (process.env.BASE_URL || process.env.STAGING_BASE_URL || 'https://automate-my-blog-backend-env-staging-automate-my-blog.vercel.app').replace(/\/$/, '');
const EMAIL = process.env.STAGING_TEST_EMAIL;
const PASSWORD = process.env.STAGING_TEST_PASSWORD;
const DOCX_PATH = process.env.GAN_DOCX_PATH || '/Users/samhilll/Downloads/GAN Writing - 2024.docx';

const REFERENCE_EXCERPT = fs.readFileSync(path.join(__dirname, 'REFERENCE_EXCERPT.md'), 'utf8');

function log(msg, type = 'info') {
  const prefix = type === 'err' ? '❌' : type === 'ok' ? '✅' : '▶';
  console.log(`${prefix} ${msg}`);
}

async function login() {
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const orgId = data.user?.organizationId || data.user?.organization_id;
  if (!orgId) throw new Error('Login missing organizationId');
  return { token: data.accessToken, orgId, userId: data.user?.id };
}

async function uploadVoiceSample(token, orgId) {
  if (!fs.existsSync(DOCX_PATH)) throw new Error(`Document not found: ${DOCX_PATH}`);
  const body = new FormData();
  body.append('organizationId', orgId);
  body.append('sourceType', 'newsletter');
  body.append('files', new Blob([fs.readFileSync(DOCX_PATH)]), 'GAN Writing - 2024.docx');

  const res = await fetch(`${BASE_URL}/api/v1/voice-samples/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.samples?.[0]?.id;
}

async function waitForAnalysis(token, orgId, maxWaitMs = 300000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/api/v1/voice-samples/${orgId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`List samples failed (${res.status})`);
    const data = await res.json();
    const samples = data.samples || [];
    const pending = samples.filter((s) => s.processing_status === 'pending' || s.processing_status === 'processing').length;
    const completed = samples.filter((s) => s.processing_status === 'completed').length;
    log(`Samples: ${completed} completed, ${pending} pending`);
    if (pending === 0) {
      const profileRes = await fetch(`${BASE_URL}/api/v1/voice-samples/${orgId}/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const profileData = await profileRes.json();
      if (profileData.profile && profileData.profile.confidence_score >= 50) {
        return profileData.profile;
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Timeout waiting for voice analysis');
}

async function generatePost(token, orgId, userId) {
  const topic = {
    title: 'Why founder communities matter',
    targetAudience: 'Founders and startup leaders',
    primaryKeywords: ['founder community', 'venture capital', 'learning'],
  };
  const businessInfo = {
    businessType: 'Venture capital',
    targetAudience: 'Founders and startup leaders',
    industry: 'VC / Startup ecosystem',
  };

  const res = await fetch(`${BASE_URL}/api/v1/enhanced-blog-generation/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic,
      businessInfo,
      organizationId: orgId,
      options: { useVoiceProfile: true, autoSave: false },
    }),
  });
  if (!res.ok) throw new Error(`Generate failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data;
}

async function scoreGeneratedPost(generatedContent, referenceExcerpt) {
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  if (!process.env.OPENAI_API_KEY) {
    log('OPENAI_API_KEY not set; skipping LLM-based scoring', 'err');
    return null;
  }

  const prompt = `You are an expert writing analyst. Compare the GENERATED post below against the REFERENCE excerpt (original voice).

REFERENCE (original voice):
---
${referenceExcerpt.slice(0, 4000)}
---

GENERATED POST:
---
${generatedContent.slice(0, 8000)}
---

Score the generated post on how well it matches the reference voice. Respond with a single JSON object (no markdown, no code block):
{
  "tone_match": <1-10, how well the conversational/founder-friendly tone matches>,
  "structure_match": <1-10, bullet usage, sections, personal sign-off>,
  "vocabulary_consistency": <1-10, similar phrases, "we/I/you" usage, milestones style>,
  "overall_voice_match": <1-10, holistic fit>,
  "brief_reasoning": "<2-3 sentences explaining the scores>"
}`;

  const resp = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });
  const raw = resp.choices?.[0]?.message?.content;
  if (!raw) return null;
  return JSON.parse(raw);
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    log('Set STAGING_TEST_EMAIL and STAGING_TEST_PASSWORD', 'err');
    process.exit(1);
  }

  log('=== GAN Writing Voice Profile Test ===');
  log(`Document: ${DOCX_PATH}`);
  log(`API: ${BASE_URL}`);

  // 1. Login
  log('Logging in...');
  const { token, orgId, userId } = await login();
  log(`Org: ${orgId}`, 'ok');

  // 2. Ingest
  log('Uploading GAN Writing docx as voice sample...');
  const sampleId = await uploadVoiceSample(token, orgId);
  log(`Sample: ${sampleId}`, 'ok');

  log('Waiting for voice analysis (poll every 5s, max 5 min)...');
  const profile = await waitForAnalysis(token, orgId);
  log(`Profile ready: confidence=${profile.confidence_score} samples=${profile.sample_count}`, 'ok');

  // 3. Generate
  log('Generating post with useVoiceProfile=true...');
  const genResult = await generatePost(token, orgId, userId);
  const blogData = genResult.data || genResult.blogPost || genResult;
  const content = blogData?.content || blogData;
  const title = blogData?.title || 'Untitled';
  const voiceUsed = blogData?.voiceAdaptationUsed ?? genResult.voiceAdaptationUsed;
  const confidence = blogData?.voiceProfileConfidence ?? genResult.voiceProfileConfidence;

  log(`Generated: "${title}" (${(content || '').length} chars)`, 'ok');
  log(`voiceAdaptationUsed=${voiceUsed} voiceProfileConfidence=${confidence}`);

  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, 'gan-generated-post.md');
  fs.writeFileSync(outPath, `# ${title}\n\n${content || ''}`, 'utf8');
  log(`Saved to ${outPath}`, 'ok');

  // 4. Score
  log('Scoring generated post against reference...');
  const scores = await scoreGeneratedPost(content || '', REFERENCE_EXCERPT);
  if (scores) {
    const reportPath = path.join(outputDir, 'gan-voice-test-report.json');
    const report = {
      timestamp: new Date().toISOString(),
      document: DOCX_PATH,
      sampleId,
      profile: { confidence_score: profile.confidence_score, sample_count: profile.sample_count },
      generated: { title, voiceAdaptationUsed: voiceUsed, voiceProfileConfidence: confidence },
      scores: {
        tone_match: scores.tone_match,
        structure_match: scores.structure_match,
        vocabulary_consistency: scores.vocabulary_consistency,
        overall_voice_match: scores.overall_voice_match,
        brief_reasoning: scores.brief_reasoning,
      },
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    log(`Report: ${reportPath}`, 'ok');
    log('');
    log('=== Scores ===');
    log(`Tone match: ${scores.tone_match}/10`);
    log(`Structure match: ${scores.structure_match}/10`);
    log(`Vocabulary consistency: ${scores.vocabulary_consistency}/10`);
    log(`Overall voice match: ${scores.overall_voice_match}/10`);
    log(`Reasoning: ${scores.brief_reasoning}`);
  }

  log('');
  log('=== GAN Voice Test Complete ===', 'ok');
}

main().catch((e) => {
  log(e.message, 'err');
  process.exit(1);
});
