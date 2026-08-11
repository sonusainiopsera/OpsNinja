/**
 * Unit tests for org-audit-diff — WO-030.
 *
 * Covers:
 *  - buildDiffEntries: normal fields, PII fields, nested paths, empty inputs
 *  - maskOrgPiiSnapshot: key-level masking, non-PII passthrough
 *  - ORG_PII_FIELDS membership
 */

import { describe, it, expect } from 'vitest';
import {
  buildDiffEntries,
  maskOrgPiiSnapshot,
  ORG_PII_FIELDS,
  REDACTED_MARKER,
} from './org-audit-diff';

// ---------------------------------------------------------------------------
// buildDiffEntries
// ---------------------------------------------------------------------------

describe('buildDiffEntries', () => {
  it('returns empty array for null changedFields', () => {
    expect(buildDiffEntries(null, {}, {})).toEqual([]);
  });

  it('returns empty array for empty changedFields', () => {
    expect(buildDiffEntries([], {}, {})).toEqual([]);
  });

  it('returns non-redacted entry for a non-PII field', () => {
    const entries = buildDiffEntries(
      ['name'],
      { name: 'Acme Corp' },
      { name: 'Acme Inc' },
      new Set(), // empty PII set so 'name' is NOT PII here
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      field:    'name',
      before:   'Acme Corp',
      after:    'Acme Inc',
      redacted: false,
    });
  });

  it('masks PII fields with redacted marker', () => {
    const entries = buildDiffEntries(
      ['email', 'phone'],
      { email: 'alice@example.com', phone: '+1 555 0100' },
      { email: 'alice2@example.com', phone: '+1 555 0101' },
    );
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.redacted).toBe(true);
      expect(entry.before).toBe(REDACTED_MARKER);
      expect(entry.after).toBe(REDACTED_MARKER);
    }
  });

  it('sets redacted:true for contact name variants', () => {
    for (const field of ['name', 'firstName', 'lastName', 'displayName']) {
      const entries = buildDiffEntries(
        [field],
        { [field]: 'Old' },
        { [field]: 'New' },
      );
      expect(entries[0]!.redacted, `${field} should be redacted`).toBe(true);
    }
  });

  it('returns correct before/after for plain (non-PII) field', () => {
    const entries = buildDiffEntries(
      ['slaTier', 'region'],
      { slaTier: 'standard', region: 'eu-west' },
      { slaTier: 'premium',  region: 'eu-west' },
    );
    expect(entries.find((e) => e.field === 'slaTier')).toMatchObject({
      before:   'standard',
      after:    'premium',
      redacted: false,
    });
    expect(entries.find((e) => e.field === 'region')).toMatchObject({
      before:   'eu-west',
      after:    'eu-west',
      redacted: false,
    });
  });

  it('handles nested dotted paths for JSONB columns', () => {
    const entries = buildDiffEntries(
      ['customFieldValues.cloud_provider'],
      { customFieldValues: { cloud_provider: 'aws' } },
      { customFieldValues: { cloud_provider: 'gcp' } },
    );
    expect(entries[0]).toMatchObject({
      field:    'customFieldValues.cloud_provider',
      before:   'aws',
      after:    'gcp',
      redacted: false,
    });
  });

  it('returns undefined for missing nested path values', () => {
    const entries = buildDiffEntries(
      ['customFieldValues.missing_key'],
      {},
      {},
    );
    expect(entries[0]!.before).toBeUndefined();
    expect(entries[0]!.after).toBeUndefined();
  });

  it('handles create events (null beforeState)', () => {
    const entries = buildDiffEntries(
      ['slaTier'],
      null,
      { slaTier: 'standard' },
    );
    expect(entries[0]).toMatchObject({
      field:    'slaTier',
      before:   undefined,
      after:    'standard',
      redacted: false,
    });
  });

  it('handles deactivation events (null afterState)', () => {
    const entries = buildDiffEntries(
      ['status'],
      { status: 'active' },
      null,
    );
    expect(entries[0]).toMatchObject({
      field:    'status',
      before:   'active',
      after:    undefined,
      redacted: false,
    });
  });

  it('retains changed flag (redacted:true) even when stored value is already [REDACTED]', () => {
    // DefaultRedactor already masked email in storage; we still flag it
    const entries = buildDiffEntries(
      ['email'],
      { email: '[REDACTED]' },
      { email: '[REDACTED]' },
    );
    expect(entries[0]!.redacted).toBe(true);
    expect(entries[0]!.field).toBe('email');
  });
});

// ---------------------------------------------------------------------------
// maskOrgPiiSnapshot
// ---------------------------------------------------------------------------

describe('maskOrgPiiSnapshot', () => {
  it('replaces PII field values with the redacted marker', () => {
    const masked = maskOrgPiiSnapshot({
      email:   'alice@example.com',
      phone:   '+1 555 0100',
      name:    'Alice Smith',
      slaTier: 'standard',
    });
    expect(masked['email']).toBe(REDACTED_MARKER);
    expect(masked['phone']).toBe(REDACTED_MARKER);
    expect(masked['name']).toBe(REDACTED_MARKER);
    expect(masked['slaTier']).toBe('standard');
  });

  it('does not mutate the original object', () => {
    const original = { email: 'x@example.com', region: 'us' };
    const masked   = maskOrgPiiSnapshot(original);
    expect(original['email']).toBe('x@example.com'); // unchanged
    expect(masked['email']).toBe(REDACTED_MARKER);
  });

  it('preserves non-PII keys unchanged', () => {
    const masked = maskOrgPiiSnapshot({ id: 'abc', status: 'active', version: 3 });
    expect(masked).toMatchObject({ id: 'abc', status: 'active', version: 3 });
  });

  it('accepts a custom piiFields override', () => {
    const masked = maskOrgPiiSnapshot(
      { region: 'eu', slaTier: 'gold' },
      new Set(['slaTier']),
    );
    expect(masked['slaTier']).toBe(REDACTED_MARKER);
    expect(masked['region']).toBe('eu');
  });
});

// ---------------------------------------------------------------------------
// ORG_PII_FIELDS
// ---------------------------------------------------------------------------

describe('ORG_PII_FIELDS', () => {
  it('contains email', () => expect(ORG_PII_FIELDS.has('email')).toBe(true));
  it('contains phone', () => expect(ORG_PII_FIELDS.has('phone')).toBe(true));
  it('contains name',  () => expect(ORG_PII_FIELDS.has('name')).toBe(true));
  it('contains firstName', () => expect(ORG_PII_FIELDS.has('firstName')).toBe(true));
  it('contains lastName',  () => expect(ORG_PII_FIELDS.has('lastName')).toBe(true));
  it('does not contain slaTier', () => expect(ORG_PII_FIELDS.has('slaTier')).toBe(false));
  it('does not contain id',      () => expect(ORG_PII_FIELDS.has('id')).toBe(false));
  it('does not contain status',  () => expect(ORG_PII_FIELDS.has('status')).toBe(false));
});
