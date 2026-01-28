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

    it('returns purchase-only breakdown and Pay as You Go when no subscription', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { source_type: 'purchase', available: '2', used: '1' },
          ],
        });

      const credits = await billing.getUserCredits('user-uuid');
      expect(credits.basePlan).toBe('Pay as You Go');
      expect(credits.isUnlimited).toBe(false);
      expect(credits.availableCredits).toBe(2);
      expect(credits.usedCredits).toBe(1);
      expect(credits.breakdown.purchases).toBe(2);
      expect(credits.breakdown.subscription).toBe(0);
      expect(credits.breakdown.referrals).toBe(0);
    });

    it('includes used credits in totalCredits', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ plan_name: 'Free', is_unlimited: false }] })
        .mockResolvedValueOnce({
          rows: [
            { source_type: 'subscription', available: '3', used: '2' },
          ],
        });

      const credits = await billing.getUserCredits('user-uuid');
      expect(credits.availableCredits).toBe(3);
      expect(credits.usedCredits).toBe(2);
      expect(credits.totalCredits).toBe(5);
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

  describe('getBillingHistory', () => {
    it('returns rows from generation_history and referral_rewards', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          { type: 'generation', timestamp: new Date(), credits_used: 1, description: 'Blog post generation' },
          { type: 'reward', timestamp: new Date(), credits_used: -1, description: 'Referral bonus: +1 free blog post' },
        ],
      });

      const history = await billing.getBillingHistory('user-uuid', 50);
      expect(history).toHaveLength(2);
      expect(history[0].type).toBe('generation');
      expect(history[0].credits_used).toBe(1);
      expect(history[1].type).toBe('reward');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UNION ALL'),
        expect.any(Array)
      );
    });

    it('throws when db errors', async () => {
      vi.mocked(db.query).mockRejectedValueOnce(new Error('DB error'));
      await expect(billing.getBillingHistory('user-uuid')).rejects.toThrow('DB error');
    });
  });

  describe('applyPendingRewards', () => {
    it('returns bonusCredits when user has active rewards', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ reward_count: '3', total_value: '45.00' }],
      });

      const out = await billing.applyPendingRewards('user-uuid');
      expect(out.success).toBe(true);
      expect(out.bonusCredits).toBe(3);
      expect(out.totalRewardValue).toBe(45);
      expect(out.message).toContain('3 bonus credits');
    });

    it('returns zero bonusCredits when no pending rewards', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ reward_count: '0', total_value: '0' }],
      });

      const out = await billing.applyPendingRewards('user-uuid');
      expect(out.success).toBe(true);
      expect(out.bonusCredits).toBe(0);
      expect(out.message).toContain('No pending rewards');
    });

    it('throws when db errors', async () => {
      vi.mocked(db.query).mockRejectedValueOnce(new Error('DB error'));
      await expect(billing.applyPendingRewards('user-uuid')).rejects.toThrow('DB error');
    });
  });

  describe('markRewardAsUsed', () => {
    it('calls db update and resolves', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
      await expect(billing.markRewardAsUsed('user-uuid')).resolves.toBeUndefined();
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE referral_rewards'),
        ['user-uuid']
      );
    });

    it('throws when db errors', async () => {
      vi.mocked(db.query).mockRejectedValueOnce(new Error('DB error'));
      await expect(billing.markRewardAsUsed('user-uuid')).rejects.toThrow('DB error');
    });
  });
});
