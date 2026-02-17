#!/usr/bin/env node
/**
 * Scientific voice profile test: GAN Writing (LOCAL MODE)
 *
 * Uses a fresh org with ONLY the GAN sample for a clean test. No API; DB + services directly.
 *
 * 1. Ingest: Create org, insert GAN docx as voice sample, run analyzer
 * 2. Generate: Create post via enhanced-blog-generation service
 * 3. Score: Evaluate generated post against reference excerpt
 *
 * Usage:
 *   DATABASE_URL=... OPENAI_API_KEY=... GAN_DOCX_PATH=/path/to/GAN\ Writing\ -\ 2024.docx \
 *   node scripts/gan-voice-test/run-gan-voice-test-local.js
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../../services/database.js';
import { extractTextFromFile } from '../../utils/file-extractors.js';
import voiceAnalyzer from '../../services/voice-analyzer.js';
import enhancedBlogGenerationService from '../../services/enhanced-blog-generation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCX_PATH = process.env.GAN_DOCX_PATH || '/Users/samhilll/Downloads/GAN Writing - 2024.docx';
const REFERENCE_EXCERPT = fs.readFileSync(path.join(__dirname, 'REFERENCE_EXCERPT.md'), 'utf8');

function log(msg, type = 'info') {
  const prefix = type === 'err' ? '❌' : type === 'ok' ? '✅' : '▶';
  console.log(`${prefix} ${msg}`);
}

async function scoreGeneratedPost(generatedContent, referenceExcerpt) {
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
  if (!process.env.DATABASE_URL) {
    log('DATABASE_URL required', 'err');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    log('OPENAI_API_KEY required', 'err');
    process.exit(1);
  }
  if (!fs.existsSync(DOCX_PATH)) {
    log(`Document not found: ${DOCX_PATH}`, 'err');
    process.exit(1);
  }

  log('=== GAN Writing Voice Profile Test (LOCAL) ===');
  log(`Document: ${DOCX_PATH}`);

  // 1. Create fresh org
  const slug = 'gan-test-' + Date.now();
  const sessionId = 'gan-test-session-' + Date.now();
  const orgRes = await db.query(
    `INSERT INTO organizations (name, slug, session_id) VALUES ($1, $2, $3) RETURNING id`,
    ['GAN Voice Test Org', slug, sessionId]
  );
  const orgId = orgRes.rows[0].id;
  log(`Created org ${orgId}`, 'ok');

  // 2. Extract text from docx and insert voice sample
  const buffer = fs.readFileSync(DOCX_PATH);
  const multerFile = {
    buffer,
    originalname: 'GAN Writing - 2024.docx',
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  const raw_content = await extractTextFromFile(multerFile, 'newsletter');
  const word_count = raw_content.trim().split(/\s+/).filter(Boolean).length;

  const insertRes = await db.query(
    `INSERT INTO voice_samples (
      organization_id, source_type, file_name, file_size_bytes, raw_content, word_count,
      processing_status, weight, title
    ) VALUES ($1, 'newsletter', $2, $3, $4, $5, 'pending', 1.0, $6)
    RETURNING id`,
    [orgId, 'GAN Writing - 2024.docx', buffer.length, raw_content, word_count, 'GAN Writing - 2024']
  );
  const sampleId = insertRes.rows[0].id;
  log(`Inserted sample ${sampleId} (${word_count} words)`, 'ok');

  // 3. Run voice analysis
  log('Running voice analysis...');
  await voiceAnalyzer.analyzeVoiceSample(sampleId);
  log('Analysis complete', 'ok');

  const profileRes = await db.query('SELECT * FROM aggregated_voice_profiles WHERE organization_id = $1', [orgId]);
  const profile = profileRes.rows[0];
  log(`Profile: confidence=${profile.confidence_score} sample_count=${profile.sample_count}`, 'ok');

  // 4. Generate post
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

  log('Generating post with useVoiceProfile=true...');
  const result = await enhancedBlogGenerationService.generateEnhancedBlogPost(
    topic,
    businessInfo,
    orgId,
    '',
    { useVoiceProfile: true, autoSave: false }
  );
  const content = result.content || '';
  const title = result.title || 'Untitled';
  const voiceUsed = result.voiceAdaptationUsed;
  const confidence = result.voiceProfileConfidence;

  log(`Generated: "${title}" (${content.length} chars)`, 'ok');
  log(`voiceAdaptationUsed=${voiceUsed} voiceProfileConfidence=${confidence}`);

  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, 'gan-generated-post-local.md');
  fs.writeFileSync(outPath, `# ${title}\n\n${content}`, 'utf8');
  log(`Saved to ${outPath}`, 'ok');

  // 5. Score
  log('Scoring generated post against reference...');
  const scores = await scoreGeneratedPost(content, REFERENCE_EXCERPT);
  if (scores) {
    const reportPath = path.join(outputDir, 'gan-voice-test-report-local.json');
    const report = {
      timestamp: new Date().toISOString(),
      mode: 'local',
      document: DOCX_PATH,
      sampleId,
      orgId,
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

  // Cleanup
  await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
  log('');
  log('=== GAN Voice Test Complete (Local) ===', 'ok');
}

main().catch((e) => {
  log(e.message, 'err');
  process.exit(1);
});
