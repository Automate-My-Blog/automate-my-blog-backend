/**
 * Unit tests for voice adaptation file extractors.
 * @see GitHub issue #246
 */
import { describe, it, expect } from 'vitest';
import {
  extractTextFromHTML,
  extractTextFromPDF,
  extractTextFromDOCX,
  extractTextFromJSON,
  extractTextFromCSV,
  extractTextFromEML,
  extractTextFromFile,
  SUPPORTED_SOURCE_TYPES,
  MAX_TEXT_LENGTH,
} from '../../utils/file-extractors.js';

describe('file-extractors', () => {
  describe('extractTextFromHTML', () => {
    it('extracts text and strips tags', () => {
      const html = '<html><body><h1>Title</h1><p>Hello <b>world</b>.</p></body></html>';
      const out = extractTextFromHTML(html);
      expect(out).toContain('Title');
      expect(out).toContain('Hello');
      expect(out).toContain('world');
      expect(out).not.toMatch(/<[^>]+>/);
    });

    it('removes script and style content', () => {
      const html = '<body><p>Visible</p><script>alert(1)</script><style>.x{}</style></body>';
      expect(extractTextFromHTML(html)).toBe('Visible');
    });

    it('returns empty string for empty or non-string input', () => {
      expect(extractTextFromHTML('')).toBe('');
      expect(extractTextFromHTML(null)).toBe('');
      expect(extractTextFromHTML(undefined)).toBe('');
    });

    it('normalizes whitespace', () => {
      expect(extractTextFromHTML('<p>  a   b  \n  c  </p>')).toBe('a b c');
    });
  });

  describe('extractTextFromJSON', () => {
    it('extracts text from array of objects with text/full_text/content', () => {
      const json = JSON.stringify([
        { full_text: 'First tweet' },
        { text: 'Second' },
        { content: 'Third' },
      ]);
      expect(extractTextFromJSON(json)).toContain('First tweet');
      expect(extractTextFromJSON(json)).toContain('Second');
      expect(extractTextFromJSON(json)).toContain('Third');
    });

    it('extracts from single object with text field', () => {
      const json = JSON.stringify({ body: 'Email body here' });
      expect(extractTextFromJSON(json)).toBe('Email body here');
    });

    it('throws on invalid JSON', () => {
      expect(() => extractTextFromJSON('not json')).toThrow('Invalid JSON');
    });

    it('returns empty string for empty input', () => {
      expect(extractTextFromJSON('')).toBe('');
    });
  });

  describe('extractTextFromCSV', () => {
    it('extracts text from column named text or content', () => {
      const csv = 'id,text,date\n1,"Hello world",2024-01-01\n2,"Second row",2024-01-02';
      const out = extractTextFromCSV(csv);
      expect(out).toContain('Hello world');
      expect(out).toContain('Second row');
    });

    it('returns empty string for empty or header-only CSV', () => {
      expect(extractTextFromCSV('')).toBe('');
      expect(extractTextFromCSV('a,b,c')).toBe('');
    });
  });

  describe('extractTextFromEML', () => {
    it('extracts body after headers', () => {
      const eml = 'From: a@b.com\nTo: c@d.com\nSubject: Hi\n\nThis is the body.';
      expect(extractTextFromEML(eml)).toContain('This is the body.');
    });

    it('handles multipart and prefers text/plain', () => {
      const eml = [
        'Content-Type: multipart/alternative; boundary="BOUND"',
        '--BOUND',
        'Content-Type: text/plain',
        '',
        'Plain part',
        '--BOUND',
        'Content-Type: text/html',
        '',
        '<p>HTML part</p>',
        '--BOUND--',
      ].join('\n');
      const out = extractTextFromEML(eml);
      expect(out).toContain('Plain part');
    });
  });

  describe('extractTextFromPDF', () => {
    it('throws on empty buffer', async () => {
      await expect(extractTextFromPDF(Buffer.alloc(0))).rejects.toThrow('non-empty buffer');
      await expect(extractTextFromPDF(undefined)).rejects.toThrow('non-empty buffer');
    });

  });

  describe('extractTextFromDOCX', () => {
    it('throws on empty buffer', async () => {
      await expect(extractTextFromDOCX(Buffer.alloc(0))).rejects.toThrow('non-empty buffer');
    });

    it('rejects when given invalid DOCX buffer', async () => {
      const invalidDocx = Buffer.from('not a docx');
      await expect(extractTextFromDOCX(invalidDocx)).rejects.toBeDefined();
    });
  });

  describe('extractTextFromFile', () => {
    it('extracts plain text from .txt file', async () => {
      const file = { buffer: Buffer.from('Hello world', 'utf8'), originalname: 'sample.txt', mimetype: 'text/plain' };
      const out = await extractTextFromFile(file);
      expect(out).toBe('Hello world');
    });

    it('extracts text from HTML file', async () => {
      const file = {
        buffer: Buffer.from('<html><body><p>Content</p></body></html>', 'utf8'),
        originalname: 'page.html',
        mimetype: 'text/html',
      };
      const out = await extractTextFromFile(file);
      expect(out).toContain('Content');
    });

    it('extracts from JSON file', async () => {
      const file = {
        buffer: Buffer.from(JSON.stringify([{ text: 'Tweet one' }]), 'utf8'),
        originalname: 'tweets.json',
        mimetype: 'application/json',
      };
      const out = await extractTextFromFile(file);
      expect(out).toContain('Tweet one');
    });

    it('throws when file is missing', async () => {
      await expect(extractTextFromFile(null)).rejects.toThrow('File is required');
    });

    it('throws when file buffer is empty', async () => {
      const file = { buffer: Buffer.alloc(0), originalname: 'empty.txt', mimetype: 'text/plain' };
      await expect(extractTextFromFile(file)).rejects.toThrow('empty');
    });

    it('throws for unsupported format', async () => {
      const file = { buffer: Buffer.from('x'), originalname: 'file.xyz', mimetype: 'application/octet-stream' };
      await expect(extractTextFromFile(file)).rejects.toThrow('Unsupported format');
    });
  });

  describe('constants', () => {
    it('SUPPORTED_SOURCE_TYPES includes expected source types', () => {
      expect(SUPPORTED_SOURCE_TYPES.has('blog_post')).toBe(true);
      expect(SUPPORTED_SOURCE_TYPES.has('email')).toBe(true);
      expect(SUPPORTED_SOURCE_TYPES.has('social_post')).toBe(true);
    });

    it('MAX_TEXT_LENGTH is a positive number', () => {
      expect(MAX_TEXT_LENGTH).toBeGreaterThan(0);
    });
  });
});
