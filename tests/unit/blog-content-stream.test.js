/**
 * Unit tests: Blog content stream — _extractContentValueFromStreamBuffer and generate-stream contract.
 * Ensures content-chunk events carry only post-body markdown (no title/meta/wrapper JSON).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openai', () => ({
  default: class MockOpenAI {
    constructor() {}
  }
}));

vi.mock('../../services/database.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../services/stream-manager.js', () => ({ default: { publish: vi.fn() } }));
vi.mock('../../services/visual-content-generation.js', () => ({ default: {} }));
vi.mock('../../services/grok-tweet-search.js', () => ({ default: {} }));
vi.mock('../../services/youtube-video-search.js', () => ({ default: {} }));
vi.mock('../../services/news-article-search.js', () => ({ default: {} }));
vi.mock('../../services/email.js', () => ({ default: {} }));

// OpenAIService constructor requires OPENAI_API_KEY; stub so service can load
vi.mock('../../services/openai.js', () => ({
  OpenAIService: class OpenAIService {
    constructor() {}
  }
}));

import enhancedBlogGenerationService from '../../services/enhanced-blog-generation.js';

describe('blog content stream', () => {
  const service = enhancedBlogGenerationService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('_extractContentValueFromStreamBuffer', () => {
    it('returns empty string when buffer has no "content" key', () => {
      expect(service._extractContentValueFromStreamBuffer('')).toBe('');
      expect(service._extractContentValueFromStreamBuffer('{"title": "Hi"}')).toBe('');
      expect(service._extractContentValueFromStreamBuffer('"metaDescription": "desc"')).toBe('');
    });

    it('returns empty string before opening quote of content value', () => {
      expect(service._extractContentValueFromStreamBuffer('"content": ')).toBe('');
      expect(service._extractContentValueFromStreamBuffer('"content":')).toBe('');
    });

    it('extracts content value when buffer ends inside the string', () => {
      const buffer = '{"title":"A","content":"# Hello\n\nWorld';
      expect(service._extractContentValueFromStreamBuffer(buffer)).toBe('# Hello\n\nWorld');
    });

    it('extracts full content value when string is closed', () => {
      const buffer = '{"title":"A","content":"# Hello\\n\\nWorld"}';
      expect(service._extractContentValueFromStreamBuffer(buffer)).toBe('# Hello\n\nWorld');
    });

    it('unescapes \\n to real newline', () => {
      const buffer = '"content": "line1\\nline2"';
      expect(service._extractContentValueFromStreamBuffer(buffer)).toBe('line1\nline2');
    });

    it('unescapes \\" inside value', () => {
      const buffer = '"content": "Say \\"hi\\""';
      expect(service._extractContentValueFromStreamBuffer(buffer)).toBe('Say "hi"');
    });

    it('unescapes \\\\ to single backslash', () => {
      const buffer = '"content": "path\\\\to\\\\file"';
      expect(service._extractContentValueFromStreamBuffer(buffer)).toBe('path\\to\\file');
    });

    it('ignores title and metaDescription — only content value', () => {
      const buffer = '{"title":"My Title","subtitle":"Sub","metaDescription":"Meta desc here.","content":"# Body only"}';
      expect(service._extractContentValueFromStreamBuffer(buffer)).toBe('# Body only');
    });

    it('handles content with escaped and unescaped chars', () => {
      const buffer = '"content": "Head\\n\\nPara with \\"quote\\"."';
      expect(service._extractContentValueFromStreamBuffer(buffer)).toBe('Head\n\nPara with "quote".');
    });

    it('stops at closing quote of content value (does not include later keys)', () => {
      const buffer = '{"content":"only this","tags":["a","b"],"ctaSuggestions":[]}';
      expect(service._extractContentValueFromStreamBuffer(buffer)).toBe('only this');
    });

    it('allows whitespace after colon in "content" : "', () => {
      const buffer = '"content" : "value"';
      expect(service._extractContentValueFromStreamBuffer(buffer)).toBe('value');
    });
  });
});
