import { deriveChangedFields } from './diff.util';

describe('deriveChangedFields', () => {
  it('returns null for two identical objects', () => {
    const obj = { status: 'open', priority: 'P2' };
    expect(deriveChangedFields(obj, obj)).toBeNull();
  });

  it('returns null when both snapshots are null', () => {
    expect(deriveChangedFields(null, null)).toBeNull();
  });

  it('returns changed top-level keys', () => {
    const before = { status: 'open', priority: 'P2' };
    const after = { status: 'resolved', priority: 'P2' };
    expect(deriveChangedFields(before, after)).toEqual(['status']);
  });

  it('returns dotted paths for nested JSONB changes', () => {
    const before = { custom_fields: { cloud_provider: 'gcp', region: 'us-east-1' } };
    const after = { custom_fields: { cloud_provider: 'aws', region: 'us-east-1' } };
    expect(deriveChangedFields(before, after)).toEqual(['custom_fields.cloud_provider']);
  });

  it('returns multiple dotted paths when several nested fields change', () => {
    const before = { custom_fields: { cloud_provider: 'gcp', tier: 'basic' } };
    const after = { custom_fields: { cloud_provider: 'aws', tier: 'enterprise' } };
    const result = deriveChangedFields(before, after);
    expect(result?.sort()).toEqual(['custom_fields.cloud_provider', 'custom_fields.tier'].sort());
  });

  it('ignores timestamp fields', () => {
    const before = { status: 'open', updatedAt: '2024-01-01', updated_at: '2024-01-01' };
    const after = { status: 'open', updatedAt: '2024-06-01', updated_at: '2024-06-01' };
    expect(deriveChangedFields(before, after)).toBeNull();
  });

  it('returns all leaf paths when before is null (creation)', () => {
    const after = { status: 'open', priority: 'P2' };
    const result = deriveChangedFields(null, after);
    expect(result?.sort()).toEqual(['priority', 'status'].sort());
  });

  it('returns all leaf paths when after is null (deletion)', () => {
    const before = { status: 'open', priority: 'P2' };
    const result = deriveChangedFields(before, null);
    expect(result?.sort()).toEqual(['priority', 'status'].sort());
  });

  it('detects newly added nested keys', () => {
    const before = { custom_fields: {} };
    const after = { custom_fields: { cloud_provider: 'aws' } };
    expect(deriveChangedFields(before, after)).toEqual(['custom_fields.cloud_provider']);
  });

  it('detects removed nested keys', () => {
    const before = { custom_fields: { cloud_provider: 'aws' } };
    const after = { custom_fields: {} };
    expect(deriveChangedFields(before, after)).toEqual(['custom_fields.cloud_provider']);
  });

  it('handles array value changes at top level', () => {
    const before = { tags: ['a', 'b'] };
    const after = { tags: ['a', 'c'] };
    expect(deriveChangedFields(before, after)).toEqual(['tags']);
  });
});
