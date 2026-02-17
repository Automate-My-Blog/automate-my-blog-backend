#!/usr/bin/env node
/**
 * Score-only: run scoring against existing gan-generated-post-local.md
 * Uses gpt-4o (supports response_format json_object). No ingest/analyze/generate.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');
const GENERATED_PATH = path.join(OUTPUT_DIR, 'gan-generated-post-local.md');
const REFERENCE_PATH = path.join(__dirname, 'REFERENCE_EXCERPT.md');
const REPORT_PATH = path.join(OUTPUT_DIR, 'gan-voice-test-report-local.json');

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
    model: 'gpt-4o',
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });
  const raw = resp.choices?.[0]?.message?.content;
  if (!raw) return null;
  return JSON.parse(raw);
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY required');
    process.exit(1);
  }
  if (!fs.existsSync(GENERATED_PATH)) {
    console.error('❌ No generated post found:', GENERATED_PATH);
    console.error('   Run run-gan-voice-test-local.js first.');
    process.exit(1);
  }

  const generated = fs.readFileSync(GENERATED_PATH, 'utf8');
  const content = generated.replace(/^# .+\n\n/, '');
  const reference = fs.readFileSync(REFERENCE_PATH, 'utf8');

  console.log('▶ Scoring existing output (gpt-4o)...');
  const scores = await scoreGeneratedPost(content, reference);
  if (!scores) {
    console.error('❌ Scoring failed');
    process.exit(1);
  }

  const report = {
    timestamp: new Date().toISOString(),
    mode: 'local',
    scoreOnly: true,
    generated: GENERATED_PATH,
    scores: {
      tone_match: scores.tone_match,
      structure_match: scores.structure_match,
      vocabulary_consistency: scores.vocabulary_consistency,
      overall_voice_match: scores.overall_voice_match,
      brief_reasoning: scores.brief_reasoning,
    },
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log('✅ Report:', REPORT_PATH);
  console.log('');
  console.log('=== Scores ===');
  console.log(`Tone match: ${scores.tone_match}/10`);
  console.log(`Structure match: ${scores.structure_match}/10`);
  console.log(`Vocabulary consistency: ${scores.vocabulary_consistency}/10`);
  console.log(`Overall voice match: ${scores.overall_voice_match}/10`);
  console.log(`Reasoning: ${scores.brief_reasoning}`);
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
