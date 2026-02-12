/**
 * Unit tests for social voice ingestion (corpus building, enough-content check, ingest with mocks).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('social-voice-ingestion', () => {
  describe('hasEnoughContentForVoice / MIN_CORPUS_WORDS_FOR_VOICE', () => {
    it('exports MIN_CORPUS_WORDS_FOR_VOICE as 50', async () => {
      const { MIN_CORPUS_WORDS_FOR_VOICE } = await import('../../services/social-voice-ingestion.js');
      expect(MIN_CORPUS_WORDS_FOR_VOICE).toBe(50);
    });

    it('hasEnoughContentForVoice returns false below threshold', async () => {
      const { hasEnoughContentForVoice } = await import('../../services/social-voice-ingestion.js');
      expect(hasEnoughContentForVoice(0)).toBe(false);
      expect(hasEnoughContentForVoice(49)).toBe(false);
    });

    it('hasEnoughContentForVoice returns true at or above threshold', async () => {
      const { hasEnoughContentForVoice } = await import('../../services/social-voice-ingestion.js');
      expect(hasEnoughContentForVoice(50)).toBe(true);
      expect(hasEnoughContentForVoice(100)).toBe(true);
    });
  });

  describe('ingestSocialContentForOrganization', () => {
    it('returns empty corpus when socialHandles override is empty', async () => {
      const { ingestSocialContentForOrganization } = await import('../../services/social-voice-ingestion.js');
      const result = await ingestSocialContentForOrganization({
        organizationId: '00000000-0000-0000-0000-000000000001',
        socialHandles: {}
      });
      expect(result.corpus).toBe('');
      expect(result.wordCount).toBe(0);
      expect(result.platformsUsed).toEqual([]);
      expect(result.byPlatform).toEqual({});
    });
  });
});
