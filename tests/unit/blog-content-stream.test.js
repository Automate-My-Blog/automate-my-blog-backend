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

    it('extracts content when content key is first (streaming prompt order)', () => {
      const buffer = '{"content":"# Title\\n\\nFirst para.\\n\\n## Section\\n\\nBody.","title":"Title","tags":[]}';
      expect(service._extractContentValueFromStreamBuffer(buffer)).toBe(
        '# Title\n\nFirst para.\n\n## Section\n\nBody.'
      );
    });
  });

  describe('_streamNewlineChunkIfNeeded', () => {
    it('returns empty when alreadyEmitted ends with newline', () => {
      expect(service._streamNewlineChunkIfNeeded('# Title\n\n', 'Next para')).toBe('');
      expect(service._streamNewlineChunkIfNeeded('Para.\n\n', '## Section')).toBe('');
    });

    it('returns \\n\\n after main title when next is start of new block (not mid-title)', () => {
      expect(service._streamNewlineChunkIfNeeded('# How to Test APIs', ' In today')).toBe(''); // continuation of title, no inject
      expect(service._streamNewlineChunkIfNeeded('# Title', '## Section')).toBe('\n\n'); // new heading after title
      expect(service._streamNewlineChunkIfNeeded('# Title', 'First paragraph.')).toBe('\n\n'); // new paragraph after title
    });

    it('does not inject in middle of title (next chunk continues same line)', () => {
      expect(service._streamNewlineChunkIfNeeded('# How to', ' Test')).toBe('');
      expect(service._streamNewlineChunkIfNeeded('# Align', ' and Flow')).toBe('');
    });

    it('returns \\n\\n before ## / ### when previous does not end with newline', () => {
      expect(service._streamNewlineChunkIfNeeded('Some text', '## Section')).toBe('\n\n');
      expect(service._streamNewlineChunkIfNeeded('Some text', '### Subsection')).toBe('\n\n');
      expect(service._streamNewlineChunkIfNeeded('Paragraph.', '### Sub')).toBe('\n\n');
    });

    it('returns \\n\\n after paragraph end when next does not start with newline or #', () => {
      expect(service._streamNewlineChunkIfNeeded('First sentence.', ' Second para')).toBe('\n\n');
      expect(service._streamNewlineChunkIfNeeded('Really? ', 'Yes.')).toBe('\n\n');
    });

    it('returns empty when newContent is empty', () => {
      expect(service._streamNewlineChunkIfNeeded('# Title', '')).toBe('');
    });

    it('returns empty when next starts with newline (no double break)', () => {
      expect(service._streamNewlineChunkIfNeeded('# Title', '\n\nNext')).toBe('');
    });
  });
});
