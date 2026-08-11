import { filterFrameForSocket, isTenantWideRole, type DashboardFrame } from '../org-scope-filter';

const ORG_1 = 'org-1111';
const ORG_2 = 'org-2222';
const ORG_3 = 'org-3333';

const FULL_FRAME: DashboardFrame = {
  type: 'delta',
  tenantId: 'tenant-a',
  seq: 1,
  sentAt: '2026-01-01T00:00:00Z',
  payload: {
    openTickets: 100,
    orgBreakdown: [
      { organization_id: ORG_1, openTickets: 40 },
      { organization_id: ORG_2, openTickets: 35 },
      { organization_id: ORG_3, openTickets: 25 },
    ],
  },
};

describe('filterFrameForSocket', () => {
  it('returns frame unchanged for tenant-wide principals', () => {
    const result = filterFrameForSocket(FULL_FRAME, new Set([ORG_1]), true);
    expect(result.payload.orgBreakdown).toHaveLength(3);
  });

  it('filters breakdown to only orgs in scope set', () => {
    const scopeIds = new Set([ORG_1, ORG_2]);
    const result = filterFrameForSocket(FULL_FRAME, scopeIds, false);
    expect(result.payload.orgBreakdown).toHaveLength(2);
    expect(result.payload.orgBreakdown!.map((e) => e.organization_id)).toEqual([ORG_1, ORG_2]);
  });

  it('returns empty breakdown for principal with no orgs in scope', () => {
    const scopeIds = new Set<string>();
    const result = filterFrameForSocket(FULL_FRAME, scopeIds, false);
    expect(result.payload.orgBreakdown).toHaveLength(0);
  });

  it('preserves top-level payload fields', () => {
    const scopeIds = new Set([ORG_1]);
    const result = filterFrameForSocket(FULL_FRAME, scopeIds, false);
    expect(result.payload.openTickets).toBe(100);
  });

  it('does not mutate the original frame', () => {
    const scopeIds = new Set([ORG_1]);
    filterFrameForSocket(FULL_FRAME, scopeIds, false);
    expect(FULL_FRAME.payload.orgBreakdown).toHaveLength(3);
  });

  it('returns frame unchanged when breakdown is undefined', () => {
    const frameNoBreakdown: DashboardFrame = {
      ...FULL_FRAME,
      payload: { openTickets: 50 },
    };
    const result = filterFrameForSocket(frameNoBreakdown, new Set([ORG_1]), false);
    expect(result).toEqual(frameNoBreakdown);
  });

  it('returns frame unchanged when breakdown is empty', () => {
    const frameEmpty: DashboardFrame = {
      ...FULL_FRAME,
      payload: { openTickets: 0, orgBreakdown: [] },
    };
    const result = filterFrameForSocket(frameEmpty, new Set([ORG_1]), false);
    expect(result.payload.orgBreakdown).toHaveLength(0);
  });

  it('single org in scope returns only that org', () => {
    const scopeIds = new Set([ORG_3]);
    const result = filterFrameForSocket(FULL_FRAME, scopeIds, false);
    expect(result.payload.orgBreakdown).toHaveLength(1);
    expect(result.payload.orgBreakdown![0]!.organization_id).toBe(ORG_3);
  });
});

describe('isTenantWideRole', () => {
  it('returns true for admin', () => {
    expect(isTenantWideRole(['admin'])).toBe(true);
  });

  it('returns true for manager', () => {
    expect(isTenantWideRole(['manager'])).toBe(true);
  });

  it('returns true for supervisor', () => {
    expect(isTenantWideRole(['supervisor'])).toBe(true);
  });

  it('returns false for agent', () => {
    expect(isTenantWideRole(['agent'])).toBe(false);
  });

  it('returns false for empty roles', () => {
    expect(isTenantWideRole([])).toBe(false);
  });

  it('returns true when mixed roles include a tenant-wide role', () => {
    expect(isTenantWideRole(['agent', 'manager'])).toBe(true);
  });
});
