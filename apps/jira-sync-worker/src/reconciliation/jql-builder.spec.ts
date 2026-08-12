/**
 * jql-builder.spec.ts — unit tests for buildReconciliationJql (WO-057 AC10).
 *
 * All tests are pure: no mocks, no I/O — just deterministic function calls.
 */

import { buildReconciliationJql, buildIdempotencyMarkerJql } from './jql-builder';
import { RECON_LOOKBACK_MAX_HOURS, RECON_PAGE_SIZE } from '@opsninja/db';

describe('buildReconciliationJql', () => {
  // -------------------------------------------------------------------------
  // Empty / invalid project key lists
  // -------------------------------------------------------------------------

  it('returns null jql when project keys array is empty', () => {
    const result = buildReconciliationJql({ projectKeys: [], lookbackHours: 2 });
    expect(result.jql).toBeNull();
    expect(result.fields).toEqual(['status', 'assignee', 'updated', 'resolution', 'summary']);
    expect(result.maxResults).toBe(RECON_PAGE_SIZE);
  });

  it('returns null jql when all keys fail validation', () => {
    const result = buildReconciliationJql({
      projectKeys: ['', '!INVALID!', '..bad..'],
      lookbackHours: 2,
    });
    expect(result.jql).toBeNull();
  });

  it('filters out invalid keys but includes valid ones', () => {
    const result = buildReconciliationJql({
      projectKeys: ['VALID', '!BAD!', 'ALSO_VALID'],
      lookbackHours: 2,
    });
    expect(result.jql).not.toBeNull();
    expect(result.jql).toContain('"VALID"');
    expect(result.jql).toContain('"ALSO_VALID"');
    expect(result.jql).not.toContain('BAD');
  });

  // -------------------------------------------------------------------------
  // Single project key
  // -------------------------------------------------------------------------

  it('builds correct JQL for a single project key', () => {
    const result = buildReconciliationJql({ projectKeys: ['PLAT'], lookbackHours: 2 });
    expect(result.jql).toBe('project in ("PLAT") AND updated >= -120m ORDER BY updated ASC');
  });

  it('uppercases project keys', () => {
    const result = buildReconciliationJql({ projectKeys: ['plat'], lookbackHours: 2 });
    expect(result.jql).toContain('"PLAT"');
  });

  // -------------------------------------------------------------------------
  // Multiple project keys
  // -------------------------------------------------------------------------

  it('builds JQL with multiple keys using comma-separated list', () => {
    const result = buildReconciliationJql({
      projectKeys: ['PLAT', 'OPS', 'INFRA'],
      lookbackHours: 1,
    });
    expect(result.jql).toBe(
      'project in ("PLAT", "OPS", "INFRA") AND updated >= -60m ORDER BY updated ASC',
    );
  });

  // -------------------------------------------------------------------------
  // Lookback clamping
  // -------------------------------------------------------------------------

  it('clamps lookbackHours below 1 to 1 (→ 60 minutes)', () => {
    const result = buildReconciliationJql({ projectKeys: ['PLAT'], lookbackHours: 0 });
    expect(result.jql).toContain('-60m');
  });

  it('clamps lookbackHours above max to RECON_LOOKBACK_MAX_HOURS', () => {
    const result = buildReconciliationJql({
      projectKeys: ['PLAT'],
      lookbackHours: RECON_LOOKBACK_MAX_HOURS + 1000,
    });
    expect(result.jql).toContain(`-${RECON_LOOKBACK_MAX_HOURS * 60}m`);
  });

  it('accepts exactly RECON_LOOKBACK_MAX_HOURS without clamping', () => {
    const result = buildReconciliationJql({
      projectKeys: ['PLAT'],
      lookbackHours: RECON_LOOKBACK_MAX_HOURS,
    });
    expect(result.jql).toContain(`-${RECON_LOOKBACK_MAX_HOURS * 60}m`);
  });

  it('uses lookback of 2h (default) correctly', () => {
    const result = buildReconciliationJql({ projectKeys: ['PLAT'], lookbackHours: 2 });
    expect(result.jql).toContain('-120m');
  });

  // -------------------------------------------------------------------------
  // Fields and maxResults
  // -------------------------------------------------------------------------

  it('always returns the minimal fields list', () => {
    const result = buildReconciliationJql({ projectKeys: ['PLAT'], lookbackHours: 2 });
    expect(result.fields).toEqual(
      expect.arrayContaining(['status', 'assignee', 'updated', 'resolution', 'summary']),
    );
  });

  it('always returns RECON_PAGE_SIZE as maxResults', () => {
    const result = buildReconciliationJql({ projectKeys: ['PLAT'], lookbackHours: 2 });
    expect(result.maxResults).toBe(RECON_PAGE_SIZE);
  });

  // -------------------------------------------------------------------------
  // ORDER BY
  // -------------------------------------------------------------------------

  it('orders by updated ASC so reconciliation processes oldest changes first', () => {
    const result = buildReconciliationJql({ projectKeys: ['PLAT'], lookbackHours: 2 });
    expect(result.jql).toContain('ORDER BY updated ASC');
  });
});

describe('buildIdempotencyMarkerJql', () => {
  it('builds JQL for idempotency marker search', () => {
    const result = buildIdempotencyMarkerJql('PLAT', 'abc123');
    expect(result).not.toBeNull();
    expect(result).toContain('"PLAT"');
    expect(result).toContain('opsninja:abc123');
  });

  it('returns null for invalid project key', () => {
    const result = buildIdempotencyMarkerJql('!INVALID', 'abc123');
    expect(result).toBeNull();
  });

  it('uppercases the project key', () => {
    const result = buildIdempotencyMarkerJql('plat', 'test');
    expect(result).toContain('"PLAT"');
  });
});
