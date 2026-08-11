/**
 * Unit tests for the org-scope filter (WO-066 AC #4, #10).
 *
 * Pure function — no DI, no network.
 */

import { applyOrgScopeFilter } from './org-scope-filter';
import {
  CANNED_DELTA_PAYLOAD,
  CANNED_DELTA_TENANT_ONLY,
} from '../../test/fixtures/frame.fixtures';
import { ORG_1_ID, ORG_2_ID } from '../../test/fixtures/jwt.fixtures';

describe('applyOrgScopeFilter', () => {
  describe('empty scope set (unrestricted principal)', () => {
    it('returns the same payload reference (no copy)', () => {
      const result = applyOrgScopeFilter(CANNED_DELTA_PAYLOAD, new Set());
      expect(result).toBe(CANNED_DELTA_PAYLOAD);
    });

    it('preserves all org breakdown entries', () => {
      const result = applyOrgScopeFilter(CANNED_DELTA_PAYLOAD, new Set());
      expect(result.orgBreakdown).toHaveLength(2);
    });

    it('preserves globalCounters', () => {
      const result = applyOrgScopeFilter(CANNED_DELTA_PAYLOAD, new Set());
      expect(result.globalCounters).toEqual(CANNED_DELTA_PAYLOAD.globalCounters);
    });
  });

  describe('scope set containing ORG_1_ID only', () => {
    const scope = new Set([ORG_1_ID]);

    it('strips ORG_2_ID from orgBreakdown', () => {
      const result = applyOrgScopeFilter(CANNED_DELTA_PAYLOAD, scope);
      expect(result.orgBreakdown).toHaveLength(1);
      expect(result.orgBreakdown[0]!.organizationId).toBe(ORG_1_ID);
    });

    it('does not mutate the original payload', () => {
      applyOrgScopeFilter(CANNED_DELTA_PAYLOAD, scope);
      expect(CANNED_DELTA_PAYLOAD.orgBreakdown).toHaveLength(2);
    });

    it('preserves globalCounters unchanged', () => {
      const result = applyOrgScopeFilter(CANNED_DELTA_PAYLOAD, scope);
      expect(result.globalCounters).toBe(CANNED_DELTA_PAYLOAD.globalCounters);
    });
  });

  describe('scope set containing ORG_2_ID only', () => {
    const scope = new Set([ORG_2_ID]);

    it('strips ORG_1_ID from orgBreakdown', () => {
      const result = applyOrgScopeFilter(CANNED_DELTA_PAYLOAD, scope);
      expect(result.orgBreakdown).toHaveLength(1);
      expect(result.orgBreakdown[0]!.organizationId).toBe(ORG_2_ID);
    });
  });

  describe('scope set with both orgs', () => {
    const scope = new Set([ORG_1_ID, ORG_2_ID]);

    it('passes through all entries', () => {
      const result = applyOrgScopeFilter(CANNED_DELTA_PAYLOAD, scope);
      expect(result.orgBreakdown).toHaveLength(2);
    });
  });

  describe('scope set with no matching orgs', () => {
    const scope = new Set(['unknown-org-uuid']);

    it('returns empty orgBreakdown', () => {
      const result = applyOrgScopeFilter(CANNED_DELTA_PAYLOAD, scope);
      expect(result.orgBreakdown).toHaveLength(0);
    });

    it('preserves globalCounters', () => {
      const result = applyOrgScopeFilter(CANNED_DELTA_PAYLOAD, scope);
      expect(result.globalCounters).toBe(CANNED_DELTA_PAYLOAD.globalCounters);
    });
  });

  describe('payload with empty orgBreakdown', () => {
    it('handles payload with no org entries gracefully', () => {
      const result = applyOrgScopeFilter(CANNED_DELTA_TENANT_ONLY, new Set([ORG_1_ID]));
      expect(result.orgBreakdown).toHaveLength(0);
      expect(result.globalCounters).toEqual(CANNED_DELTA_TENANT_ONLY.globalCounters);
    });
  });
});
