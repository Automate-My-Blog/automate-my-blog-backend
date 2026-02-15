/**
 * Unit tests for VoiceAnalyzerService.
 * @see GitHub issue #247
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbQuery = vi.fn();
vi.mock('../../services/database.js', () => ({ default: { query: mockDbQuery } }));

// Voice-analyzer creates OpenAI in constructor (and default export); need key before import
const orig = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

describe('VoiceAnalyzerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runVoiceAnalysis', () => {
    it('throws when content is empty', async () => {
      const { VoiceAnalyzerService } = await import('../../services/voice-analyzer.js');
      const openaiCreate = vi.fn();
      const service = new VoiceAnalyzerService();
      service.openai = { chat: { completions: { create: openaiCreate } } };

      await expect(service.runVoiceAnalysis('')).rejects.toThrow('Content is required');
      await expect(service.runVoiceAnalysis('   ')).rejects.toThrow('Content is required');
      await expect(service.runVoiceAnalysis(null)).rejects.toThrow();
      expect(openaiCreate).not.toHaveBeenCalled();
    });

    it('returns structured analysis and quality_score from OpenAI JSON', async () => {
      const mockResponse = {
        style_analysis: { sentence_length: 'mixed', voice_perspective: 'first' },
        vocabulary_analysis: { formality_level: 'professional' },
        structural_patterns: { opening_hook_type: 'question' },
        formatting_preferences: { heading_frequency: 'medium' },
        quality_score: 85,
      };
      const { VoiceAnalyzerService } = await import('../../services/voice-analyzer.js');
      const openaiCreate = vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockResponse) } }],
      });
      const service = new VoiceAnalyzerService();
      service.openai = { chat: { completions: { create: openaiCreate } } };

      const result = await service.runVoiceAnalysis('Sample paragraph for analysis.');

      expect(result.style_analysis).toEqual(mockResponse.style_analysis);
      expect(result.vocabulary_analysis).toEqual(mockResponse.vocabulary_analysis);
      expect(result.structural_patterns).toEqual(mockResponse.structural_patterns);
      expect(result.formatting_preferences).toEqual(mockResponse.formatting_preferences);
      expect(result.quality_score).toBe(85);
      expect(openaiCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          temperature: 0.2,
          response_format: { type: 'json_object' },
        })
      );
    });

    it('clamps quality_score to 0-100', async () => {
      const { VoiceAnalyzerService } = await import('../../services/voice-analyzer.js');
      const openaiCreate = vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                style_analysis: {},
                vocabulary_analysis: {},
                structural_patterns: {},
                formatting_preferences: {},
                quality_score: 150,
              }),
            },
          },
        ],
      });
      const service = new VoiceAnalyzerService();
      service.openai = { chat: { completions: { create: openaiCreate } } };

      const result = await service.runVoiceAnalysis('Text');
      expect(result.quality_score).toBe(100);
    });
  });

  describe('updateAggregatedProfile', () => {
    it('queries samples, upserts profile, and calls update_organization_data_availability', async () => {
      const orgId = '11111111-1111-1111-1111-111111111111';
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [
            {
              style_analysis: { voice_perspective: 'first' },
              vocabulary_analysis: {},
              structural_patterns: {},
              formatting_preferences: {},
              weight: 1,
              word_count: 100,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { VoiceAnalyzerService } = await import('../../services/voice-analyzer.js');
      const service = new VoiceAnalyzerService();
      service.openai = { chat: { completions: { create: vi.fn() } } };

      await service.updateAggregatedProfile(orgId);

      expect(mockDbQuery).toHaveBeenCalled();
      const insertCall = mockDbQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0].includes('aggregated_voice_profiles') || c[0].includes('ON CONFLICT'))
      );
      expect(insertCall).toBeDefined();
      const availabilityCall = mockDbQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('update_organization_data_availability')
      );
      expect(availabilityCall).toBeDefined();
      expect(availabilityCall[1][0]).toBe(orgId);
    });
  });

  describe('analyzeVoiceSample', () => {
    it('throws when sample not found', async () => {
      mockDbQuery.mockResolvedValue({ rows: [] });

      const { VoiceAnalyzerService } = await import('../../services/voice-analyzer.js');
      const service = new VoiceAnalyzerService();
      service.openai = { chat: { completions: { create: vi.fn() } } };

      await expect(service.analyzeVoiceSample('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        'Voice sample not found'
      );
    });
  });
});
