import { deriveChangedFields } from '../derive-changed-fields';

describe('deriveChangedFields', () => {
  it('returns empty array for identical objects', () => {
    expect(deriveChangedFields({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toEqual([]);
  });

  it('detects top-level value change', () => {
    expect(deriveChangedFields({ status: 'open' }, { status: 'closed' })).toEqual(['status']);
  });

  it('detects added key', () => {
    const result = deriveChangedFields({ a: 1 }, { a: 1, b: 2 });
    expect(result).toContain('b');
  });

  it('detects removed key', () => {
    const result = deriveChangedFields({ a: 1, b: 2 }, { a: 1 });
    expect(result).toContain('b');
  });

  it('returns empty array for null inputs', () => {
    expect(deriveChangedFields(null, null)).toEqual([]);
  });

  it('returns all keys when before is null', () => {
    const result = deriveChangedFields(null, { a: 1, b: 2 });
    expect(result).toEqual(['a', 'b']);
  });

  it('returns all keys when after is null', () => {
    const result = deriveChangedFields({ a: 1 }, null);
    expect(result).toEqual(['a']);
  });

  it('flattens nested JSONB custom_fields changes', () => {
    const before = { custom_fields: { cloud_provider: 'aws', region: 'us-east-1' } };
    const after  = { custom_fields: { cloud_provider: 'gcp', region: 'us-east-1' } };
    const result = deriveChangedFields(before, after);
    expect(result).toEqual(['custom_fields.cloud_provider']);
  });

  it('includes parent key when nested object changed wholesale', () => {
    const before = { meta: { x: 1 } };
    const after  = { meta: { x: 2 } };
    const result = deriveChangedFields(before, after);
    expect(result).toContain('meta.x');
  });

  it('handles array values as opaque (not flattened)', () => {
    const before = { tags: ['a', 'b'] };
    const after  = { tags: ['a', 'c'] };
    expect(deriveChangedFields(before, after)).toEqual(['tags']);
  });

  it('does not report unchanged nested fields', () => {
    const before = { custom_fields: { a: 1, b: 2 } };
    const after  = { custom_fields: { a: 1, b: 2 } };
    expect(deriveChangedFields(before, after)).toEqual([]);
  });

  it('handles multiple changed fields', () => {
    const before = { status: 'open', priority: 'p4', assigneeId: null };
    const after  = { status: 'in_progress', priority: 'p1', assigneeId: 'usr-1' };
    const result = deriveChangedFields(before, after);
    expect(result).toEqual(expect.arrayContaining(['status', 'priority', 'assigneeId']));
    expect(result).toHaveLength(3);
  });
});
