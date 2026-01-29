/**
 * Unit tests: expireCredits job.
 * Mocks database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/database.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

const db = (await import('../../services/database.js')).default;
let expireOldCredits;

beforeEach(async () => {
  vi.mocked(db.query).mockReset();
  const mod = await import('../../jobs/expireCredits.js');
  expireOldCredits = mod.expireOldCredits;
});

describe('expireCredits', () => {
  it('returns expired count when credits are expired', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [
        { id: 'c1', user_id: 'u1', source_type: 'subscription', quantity: 1, expires_at: new Date() },
        { id: 'c2', user_id: 'u2', source_type: 'purchase', quantity: 2, expires_at: new Date() },
      ],
    });

    const out = await expireOldCredits();
    expect(out).toEqual({ expired: 2 });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE user_credits[\s\S]*SET status = 'expired'[\s\S]*RETURNING/)
    );
  });

  it('returns zero when no credits to expire', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    const out = await expireOldCredits();
    expect(out).toEqual({ expired: 0 });
  });

  it('throws when db errors', async () => {
    vi.mocked(db.query).mockRejectedValueOnce(new Error('Connection refused'));
    await expect(expireOldCredits()).rejects.toThrow('Connection refused');
  });
});
