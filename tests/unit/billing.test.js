/**
 * Unit tests: Billing service (getUserCredits, hasCredits).
 * Mocks database and email.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

vi.mock('../../services/database.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

vi.mock('../../services/email.js', () => ({
  default: {
    sendLowCreditWarning: vi.fn().mockResolvedValue(undefined),
  },
}));

const db = (await import('../../services/database.js')).default;
let billing;

beforeAll(async () => {
  const mod = await import('../../services/billing.js');
  billing = mod.default;
});

afterEach(() => {
  vi.mocked(db.query).mockReset();
});

describe('billing', () => {
  describe('getUserCredits', () => {
    it('returns unlimited when user has unlimited subscription', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ plan_name: 'Pro', is_unlimited: true }],
      });

      const credits = await billing.getUserCredits('user-uuid');
      expect(credits.isUnlimited).toBe(true);
      expect(credits.availableCredits).toBe(999999);
      expect(credits.basePlan).toBe('Pro');
    });

    it('returns breakdown when user has limited credits', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ plan_name: 'Free', is_unlimited: false }] })
        .mockResolvedValueOnce({
          rows: [
            { source_type: 'subscription', available: '1', used: '0' },
            { source_type: 'referral', available: '2', used: '0' },
          ],
        });

      const credits = await billing.getUserCredits('user-uuid');
      expect(credits.isUnlimited).toBe(false);
      expect(credits.availableCredits).toBe(3);
      expect(credits.usedCredits).toBe(0);
      expect(credits.breakdown.subscription).toBe(1);
      expect(credits.breakdown.referrals).toBe(2);
    });

    it('returns fallback when db errors', async () => {
      vi.mocked(db.query).mockRejectedValueOnce(new Error('Connection refused'));

      const credits = await billing.getUserCredits('user-uuid');
      expect(credits.basePlan).toBe('Pay as You Go');
      expect(credits.availableCredits).toBe(0);
      expect(credits.usedCredits).toBe(0);
    });
  });

  describe('hasCredits', () => {
    it('returns true when user has sufficient credits', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ plan_name: 'Free', is_unlimited: false }] })
        .mockResolvedValueOnce({
          rows: [{ source_type: 'subscription', available: '5', used: '0' }],
        });

      const has = await billing.hasCredits('user-uuid', 2);
      expect(has).toBe(true);
    });

    it('returns false when user has insufficient credits', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ plan_name: 'Free', is_unlimited: false }] })
        .mockResolvedValueOnce({
          rows: [{ source_type: 'subscription', available: '1', used: '0' }],
        });

      const has = await billing.hasCredits('user-uuid', 2);
      expect(has).toBe(false);
    });

    it('returns false when getUserCredits throws', async () => {
      vi.mocked(db.query).mockRejectedValueOnce(new Error('DB error'));

      const has = await billing.hasCredits('user-uuid');
      expect(has).toBe(false);
    });
  });
});
