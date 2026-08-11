import { partitionMonths, partitionWindow, SMALL_PROFILE } from '../profiles';
import { buildTickets } from '../factories/tickets.factory';
import { buildTenants } from '../factories/organizations.factory';
import { SeededPrng } from '../prng';
import { DEFAULT_COLLISION_MATRIX } from '../collision-matrix';

const NOW = new Date('2025-01-15T00:00:00.000Z');

describe('partitionMonths', () => {
  it('returns at least 15 months for small profile (14 back + 1 forward + current)', () => {
    const months = partitionMonths(SMALL_PROFILE, NOW);
    expect(months.length).toBeGreaterThanOrEqual(15);
  });

  it('all entries are in YYYY-MM format', () => {
    const months = partitionMonths(SMALL_PROFILE, NOW);
    for (const m of months) {
      expect(m).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('months are in ascending order', () => {
    const months = partitionMonths(SMALL_PROFILE, NOW);
    for (let i = 1; i < months.length; i++) {
      expect(months[i] > months[i - 1]).toBe(true);
    }
  });

  it('includes a month beyond the current month (for purge testing)', () => {
    const months = partitionMonths(SMALL_PROFILE, NOW);
    const future = months[months.length - 1];
    expect(future > '2025-01').toBe(true);
  });
});

describe('buildTickets — partition spanning', () => {
  it('spans at least 14 distinct monthly partitions', () => {
    const prng = new SeededPrng(42);
    const { start, end } = partitionWindow(SMALL_PROFILE, NOW);
    const tenants = buildTenants(prng, 3);
    const orgIds = tenants.map((t) => prng.uuid());
    const userIds = tenants.map((t) => prng.uuid());
    const tkts = buildTickets(prng, tenants, orgIds, userIds, 400, start, end, DEFAULT_COLLISION_MATRIX);

    const partitions = new Set<string>();
    for (const t of tkts) {
      const y = t.createdAt.getUTCFullYear();
      const m = String(t.createdAt.getUTCMonth() + 1).padStart(2, '0');
      partitions.add(`${y}-${m}`);
    }
    expect(partitions.size).toBeGreaterThanOrEqual(14);
  });
});
