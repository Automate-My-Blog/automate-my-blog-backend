#!/usr/bin/env node
/**
 * Extract text from GAN Writing docx for analysis.
 * Usage: node scripts/gan-voice-test/extract-docx.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractTextFromDOCX } from '../../utils/file-extractors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCX_PATH = '/Users/samhilll/Downloads/GAN Writing - 2024.docx';
const OUTPUT_PATH = path.join(__dirname, 'gan-writing-extracted.txt');

async function main() {
  if (!fs.existsSync(DOCX_PATH)) {
    console.error('Document not found:', DOCX_PATH);
    process.exit(1);
  }
  const buffer = fs.readFileSync(DOCX_PATH);
  const text = await extractTextFromDOCX(buffer);
  fs.writeFileSync(OUTPUT_PATH, text, 'utf8');
  console.log(`Extracted ${text.length} chars, ${text.split(/\s+/).filter(Boolean).length} words`);
  console.log('Saved to:', OUTPUT_PATH);
  console.log('\n--- Preview (first 3000 chars) ---\n');
  console.log(text.slice(0, 3000));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
