/**
 * File extraction utilities for voice adaptation.
 * Extracts plain text from uploaded files (PDF, DOCX, HTML, TXT, MD, JSON, CSV, EML).
 *
 * @see GitHub issue #246
 */
import * as cheerio from 'cheerio';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const MAX_TEXT_LENGTH = 500_000;
const SUPPORTED_SOURCE_TYPES = new Set([
  'blog_post',
  'whitepaper',
  'email',
  'newsletter',
  'social_post',
  'call_summary',
  'other_document'
]);

/**
 * Extract plain text from HTML string (strip tags, normalize whitespace).
 * @param {string} content - Raw HTML
 * @returns {string}
 */
export function extractTextFromHTML(content) {
  if (!content || typeof content !== 'string') return '';
  const $ = cheerio.load(content);
  $('script, style, noscript').remove();
  const text = $('body').length ? $('body').text() : $.text();
  return normalizeWhitespace(text).trim();
}

/**
 * Extract text from a PDF buffer.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
export async function extractTextFromPDF(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('PDF extraction requires a non-empty buffer');
  }
  const result = await pdfParse(buffer);
  const text = result?.text ?? '';
  return truncateIfNeeded(normalizeWhitespace(text).trim());
}

/**
 * Extract raw text from a DOCX buffer.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
export async function extractTextFromDOCX(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('DOCX extraction requires a non-empty buffer');
  }
  const result = await mammoth.extractRawText({ buffer });
  const text = result?.value ?? '';
  return truncateIfNeeded(normalizeWhitespace(text).trim());
}

/**
 * Extract text from JSON content; structure depends on sourceType (e.g. tweets export).
 * @param {string} content - Raw JSON string
 * @param {string} [sourceType] - e.g. 'social_post' for tweet-like arrays
 * @returns {string}
 */
export function extractTextFromJSON(content, sourceType = 'other_document') {
  if (!content || typeof content !== 'string') return '';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Invalid JSON');
  }
  const parts = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && typeof item === 'object') {
        const text = item.full_text ?? item.text ?? item.content ?? item.body;
        if (typeof text === 'string') parts.push(text);
      } else if (typeof item === 'string') {
        parts.push(item);
      }
    }
  } else if (parsed && typeof parsed === 'object') {
    const text =
      parsed.full_text ??
      parsed.text ??
      parsed.content ??
      parsed.body ??
      parsed.transcript;
    if (typeof text === 'string') parts.push(text);
    if (Array.isArray(parsed.tweets))
      parts.push(...extractTextFromJSON(JSON.stringify(parsed.tweets), sourceType).split('\n\n').filter(Boolean));
  }
  return truncateIfNeeded(normalizeWhitespace(parts.join('\n\n')).trim());
}

/**
 * Extract text from CSV (e.g. tweet export): concatenate text-like columns.
 * @param {string} content - Raw CSV string
 * @returns {string}
 */
export function extractTextFromCSV(content) {
  if (!content || typeof content !== 'string') return '';
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return '';
  const header = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
  const textCol = header.findIndex((h) => /text|content|body|tweet|message/.test(h));
  const parts = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    const val = textCol >= 0 && cells[textCol] != null ? cells[textCol] : cells.join(' ');
    if (typeof val === 'string' && val.trim()) parts.push(val.trim());
  }
  return truncateIfNeeded(normalizeWhitespace(parts.join('\n\n')).trim());
}

/**
 * Parse a single CSV line (handles quoted fields).
 */
function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === ',' && !inQuotes) || (c === '\n' && !inQuotes)) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

/**
 * Extract body text from .eml email content.
 * @param {string} content - Raw EML string
 * @returns {string}
 */
export function extractTextFromEML(content) {
  if (!content || typeof content !== 'string') return '';
  const boundary = content.match(/boundary="?([^";\s]+)"?/i);
  const parts = [];
  let body = content;
  if (boundary) {
    const sections = content.split(new RegExp(`--${boundary[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'));
    for (const section of sections) {
      const headerEnd = section.indexOf('\n\n');
      if (headerEnd === -1) continue;
      const headers = section.slice(0, headerEnd);
      const rest = section.slice(headerEnd + 2);
      if (/content-type:\s*text\/plain/i.test(headers)) {
        parts.push(rest.replace(/\r\n/g, '\n').trim());
      } else if (/content-type:\s*text\/html/i.test(headers) && parts.length === 0) {
        parts.push(extractTextFromHTML(rest));
      }
    }
  }
  if (parts.length === 0) {
    const idx = content.indexOf('\n\n');
    body = idx >= 0 ? content.slice(idx + 2) : content;
    if (/<html/i.test(body)) body = extractTextFromHTML(body);
    else body = body.replace(/\r\n/g, '\n').trim();
    parts.push(body);
  }
  return truncateIfNeeded(normalizeWhitespace(parts.join('\n\n')).trim());
}

/**
 * Main dispatcher: extract text from file based on mimetype/filename and optional sourceType.
 * @param {{ buffer?: Buffer, originalname?: string, mimetype?: string }} file - Multer file object
 * @param {string} [sourceType] - Voice sample source type (blog_post, email, etc.)
 * @returns {Promise<string>}
 */
export async function extractTextFromFile(file, sourceType = 'other_document') {
  if (!file) throw new Error('File is required');
  const buffer = file.buffer;
  const name = (file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  if (buffer && Buffer.isBuffer(buffer) && buffer.length === 0) {
    throw new Error('File is empty');
  }

  // Binary formats first (by mime/extension)
  if (mime.includes('pdf') || name.endsWith('.pdf')) {
    if (!buffer || buffer.length === 0) throw new Error('PDF requires a non-empty buffer');
    return extractTextFromPDF(buffer);
  }
  if (mime.includes('wordprocessingml') || mime.includes('docx') || name.endsWith('.docx')) {
    if (!buffer || buffer.length === 0) throw new Error('DOCX requires a non-empty buffer');
    return extractTextFromDOCX(buffer);
  }

  const content = buffer ? buffer.toString('utf8') : '';
  if (buffer && Buffer.isBuffer(buffer) && !isLikelyUTF8(buffer)) {
    throw new Error('Unsupported binary format. Use .pdf or .docx for documents.');
  }

  if (mime.includes('html') || name.endsWith('.html') || name.endsWith('.htm')) {
    return extractTextFromHTML(content);
  }
  if (mime.includes('json') || name.endsWith('.json')) {
    return extractTextFromJSON(content, sourceType);
  }
  if (mime.includes('csv') || name.endsWith('.csv')) {
    return extractTextFromCSV(content);
  }
  if (mime.includes('rfc822') || name.endsWith('.eml')) {
    return extractTextFromEML(content);
  }
  if (mime.includes('plain') || name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown')) {
    return truncateIfNeeded(normalizeWhitespace(content).trim());
  }

  throw new Error(`Unsupported format: ${mime || name || 'unknown'}. Use .txt, .md, .html, .pdf, .docx, .json, .csv, or .eml.`);
}

function normalizeWhitespace(s) {
  return String(s).replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
}

function truncateIfNeeded(s) {
  if (s.length <= MAX_TEXT_LENGTH) return s;
  return s.slice(0, MAX_TEXT_LENGTH) + '\n\n[Content truncated for analysis.]';
}

function isLikelyUTF8(buffer) {
  if (buffer.length < 3) return true;
  const slice = buffer.slice(0, 1000);
  let valid = 0;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] <= 0x7f || (slice[i] >= 0xc0 && slice[i] <= 0xdf)) valid++;
  }
  return valid / slice.length > 0.9;
}

export { SUPPORTED_SOURCE_TYPES, MAX_TEXT_LENGTH };
