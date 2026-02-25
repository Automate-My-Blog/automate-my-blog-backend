#!/usr/bin/env node
/**
 * Verify voice workflow test fixtures: run file extractors on each file.
 * Run from repo root: node fixtures/voice-workflow-test/verify-fixtures.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractTextFromFile } from '../../utils/file-extractors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = [
  { file: 'persona-blog.md', sourceType: 'blog_post' },
  { file: 'persona-whitepaper.md', sourceType: 'whitepaper' },
  { file: 'persona-email.eml', sourceType: 'email' },
  { file: 'persona-newsletter.html', sourceType: 'newsletter' },
  { file: 'persona-social.json', sourceType: 'social_post' },
  { file: 'persona-social.csv', sourceType: 'social_post' },
  { file: 'persona-call-summary.txt', sourceType: 'call_summary' },
  { file: 'persona-other.txt', sourceType: 'other_document' },
];

let failed = 0;
for (const { file, sourceType } of FIXTURES) {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.log(`⏭️  ${file} (missing)`);
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
  try {
    const text = await extractTextFromFile(multerFile, sourceType);
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const preview = text.slice(0, 80).replace(/\n/g, ' ') + (text.length > 80 ? '...' : '');
    console.log(`✅ ${file} (${sourceType}): ${wordCount} words — "${preview}"`);
  } catch (err) {
    console.log(`❌ ${file} (${sourceType}): ${err.message}`);
    failed++;
  }
}
process.exit(failed > 0 ? 1 : 0);
