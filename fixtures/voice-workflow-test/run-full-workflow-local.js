#!/usr/bin/env node
/**
 * Run the full Captain voice workflow locally: DB + file extractors + voice-analyzer (no HTTP, no Redis).
 * Verifies: extract text → insert samples → analyze → aggregate profile.
 *
 * Usage (from repo root):
 *   DATABASE_URL=... OPENAI_API_KEY=... node fixtures/voice-workflow-test/run-full-workflow-local.js
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../../services/database.js';
import { extractTextFromFile } from '../../utils/file-extractors.js';
import voiceAnalyzer from '../../services/voice-analyzer.js';

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

function log(msg, type = 'info') {
  const prefix = type === 'err' ? '❌' : type === 'ok' ? '✅' : '▶';
  console.log(`${prefix} ${msg}`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    log('DATABASE_URL is required', 'err');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    log('OPENAI_API_KEY is required for voice analysis', 'err');
    process.exit(1);
  }

  let orgId;
  const orgRes = await db.query(
    `INSERT INTO organizations (name, slug, session_id) VALUES ($1, $2, $3) RETURNING id`,
    ['Captain workflow test', 'captain-test-' + Date.now(), 'test-session-' + Date.now()]
  );
  orgId = orgRes.rows[0].id;
  log(`Created test org ${orgId}`, 'ok');

  const sampleIds = [];
  for (const fixture of FIXTURES) {
    const filePath = path.join(__dirname, fixture.file);
    if (!fs.existsSync(filePath)) {
      log(`Skip (missing): ${fixture.file}`, 'err');
      continue;
    }
    const buffer = fs.readFileSync(filePath);
    const name = path.basename(filePath);
    const ext = path.extname(name).toLowerCase();
    const mimeTypes = {
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.json': 'application/json',
      '.csv': 'text/csv',
      '.eml': 'message/rfc822',
    };
    const multerFile = {
      buffer,
      originalname: name,
      mimetype: mimeTypes[ext] || 'application/octet-stream',
    };
    let raw_content;
    try {
      raw_content = await extractTextFromFile(multerFile, fixture.sourceType);
    } catch (e) {
      log(`${fixture.file} extract failed: ${e.message}`, 'err');
      continue;
    }
    const word_count = raw_content.trim().split(/\s+/).filter(Boolean).length;
    const insert = await db.query(
      `INSERT INTO voice_samples (
        organization_id, source_type, file_name, file_size_bytes, raw_content, word_count,
        processing_status, weight
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', 1.0)
      RETURNING id`,
      [orgId, fixture.sourceType, name, buffer.length, raw_content, word_count]
    );
    const sampleId = insert.rows[0].id;
    sampleIds.push(sampleId);
    log(`  ${fixture.file} (${fixture.sourceType}): ${word_count} words → sample ${sampleId}`, 'ok');
  }

  if (sampleIds.length === 0) {
    log('No samples inserted', 'err');
    await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    process.exit(1);
  }

  log('Running voice analysis (OpenAI)...');
  for (const sampleId of sampleIds) {
    try {
      await voiceAnalyzer.analyzeVoiceSample(sampleId);
      log(`  Analyzed sample ${sampleId}`, 'ok');
    } catch (e) {
      log(`  Analyze ${sampleId} failed: ${e.message}`, 'err');
    }
  }

  const profileRes = await db.query('SELECT * FROM aggregated_voice_profiles WHERE organization_id = $1', [orgId]);
  const profile = profileRes.rows[0];
  if (!profile) {
    log('No aggregated profile after analysis', 'err');
    await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    process.exit(1);
  }
  log('Aggregated profile:', 'ok');
  log(`  sample_count=${profile.sample_count} total_word_count=${profile.total_word_count} confidence_score=${profile.confidence_score}`);
  if (profile.style && Object.keys(profile.style).length) {
    log(`  style keys: ${Object.keys(profile.style).join(', ')}`);
  }
  if (profile.vocabulary?.signature_phrases?.length) {
    log(`  signature_phrases: ${profile.vocabulary.signature_phrases.slice(0, 5).join('; ')}`);
  }

  await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
  log('Full Captain workflow (local) completed. Voice pipeline works.', 'ok');
}

main().catch((e) => {
  log(e.message, 'err');
  process.exit(1);
});
