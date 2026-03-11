import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError, UnauthorizedError } from '../../lib/errors.js';

const mockGetAccessibleProjectSettings = vi.fn();
const mockUpdateProjectSettings = vi.fn();

vi.mock('../../services/project-settings-repository.js', () => ({
  getAccessibleProjectSettings: (...args) => mockGetAccessibleProjectSettings(...args),
  updateProjectSettings: (...args) => mockUpdateProjectSettings(...args)
}));

import {
  normalizeProjectSettingsPatch,
  toProjectSettingsResponse,
  getProjectSettingsForUser,
  saveProjectSettingsForUser
} from '../../services/project-settings.js';

describe('project-settings service', () => {
  beforeEach(() => {
    mockGetAccessibleProjectSettings.mockReset();
    mockUpdateProjectSettings.mockReset();
  });

  describe('normalizeProjectSettingsPatch', () => {
    it('returns empty patch for non-object input', () => {
      expect(normalizeProjectSettingsPatch(undefined)).toEqual({});
      expect(normalizeProjectSettingsPatch(null)).toEqual({});
      expect(normalizeProjectSettingsPatch(['a'])).toEqual({});
      expect(normalizeProjectSettingsPatch('text')).toEqual({});
    });

    it('keeps only known keys and stringifies values', () => {
      const out = normalizeProjectSettingsPatch({
        audienceSegment: 42,
        seoStrategy: false,
        contentTone: 'direct',
        defaultTemplate: 7,
        unknown: 'ignored'
      });
      expect(out).toEqual({
        audienceSegment: '42',
        seoStrategy: 'false',
        contentTone: 'direct',
        defaultTemplate: '7'
      });
    });

    it('normalizes ctaGoals to string array or empty array', () => {
      expect(normalizeProjectSettingsPatch({ ctaGoals: ['a', 2] })).toEqual({
        ctaGoals: ['a', '2']
      });
      expect(normalizeProjectSettingsPatch({ ctaGoals: 'x' })).toEqual({
        ctaGoals: []
      });
    });
  });

  describe('toProjectSettingsResponse', () => {
    it('maps row to API shape', () => {
      const out = toProjectSettingsResponse({
        settings: { contentTone: 'friendly' },
        updated_at: new Date('2026-01-02T00:00:00.000Z')
      });
      expect(out).toEqual({
        settings: { contentTone: 'friendly' },
        savedAt: '2026-01-02T00:00:00.000Z'
      });
    });
  });

  describe('getProjectSettingsForUser', () => {
    it('throws UnauthorizedError when user missing', async () => {
      await expect(getProjectSettingsForUser({ projectId: 'p1', userId: null })).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('throws NotFoundError when project is not accessible', async () => {
      mockGetAccessibleProjectSettings.mockResolvedValue(null);
      await expect(getProjectSettingsForUser({ projectId: 'p1', userId: 'u1' })).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns settings payload for accessible project', async () => {
      mockGetAccessibleProjectSettings.mockResolvedValue({
        id: 'p1',
        settings: { seoStrategy: 'brand' },
        updated_at: new Date('2026-02-01T10:00:00.000Z')
      });
      const out = await getProjectSettingsForUser({ projectId: 'p1', userId: 'u1' });
      expect(out).toEqual({
        settings: { seoStrategy: 'brand' },
        savedAt: '2026-02-01T10:00:00.000Z'
      });
    });
  });

  describe('saveProjectSettingsForUser', () => {
    it('throws NotFoundError when project is not accessible', async () => {
      mockGetAccessibleProjectSettings.mockResolvedValue(null);
      await expect(
        saveProjectSettingsForUser({
          projectId: 'p1',
          userId: 'u1',
          incomingSettings: { contentTone: 'x' }
        })
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('normalizes patch and returns saved settings', async () => {
      mockGetAccessibleProjectSettings.mockResolvedValue({ id: 'p1' });
      mockUpdateProjectSettings.mockResolvedValue({
        settings: { contentTone: 'professional', ctaGoals: ['lead_gen'] },
        updated_at: new Date('2026-02-01T12:00:00.000Z')
      });

      const out = await saveProjectSettingsForUser({
        projectId: 'p1',
        userId: 'u1',
        incomingSettings: { contentTone: 'professional', ctaGoals: ['lead_gen'], ignored: 'x' }
      });

      expect(mockUpdateProjectSettings).toHaveBeenCalledWith('p1', {
        contentTone: 'professional',
        ctaGoals: ['lead_gen']
      });
      expect(out).toEqual({
        settings: { contentTone: 'professional', ctaGoals: ['lead_gen'] },
        savedAt: '2026-02-01T12:00:00.000Z'
      });
    });
  });
});
