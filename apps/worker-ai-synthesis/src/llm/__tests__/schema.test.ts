import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFirstJsonObject, parseAndValidate, SynthesisOutputSchema } from '../schema.js';
import { InvalidModelOutputError } from '../errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../../../../test/fixtures/threads');

function loadCanned(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, 'canned-response.json'), 'utf8'));
}

// ---------------------------------------------------------------------------
// extractFirstJsonObject
// ---------------------------------------------------------------------------

describe('extractFirstJsonObject', () => {
  it('returns null for empty string', () => {
    expect(extractFirstJsonObject('')).toBeNull();
  });

  it('extracts a simple JSON object', () => {
    const result = extractFirstJsonObject('{"key":"value"}');
    expect(result).toBe('{"key":"value"}');
  });

  it('extracts JSON embedded in prose', () => {
    const text = 'Here is the result:\n\n{"a":1,"b":2}\n\nThat is all.';
    expect(extractFirstJsonObject(text)).toBe('{"a":1,"b":2}');
  });

  it('handles nested objects', () => {
    const text = '{"outer":{"inner":true}}';
    const result = extractFirstJsonObject(text);
    expect(result).toBe('{"outer":{"inner":true}}');
  });

  it('ignores trailing brace in prose after JSON', () => {
    const text = '{"a":1} and then another { brace';
    expect(extractFirstJsonObject(text)).toBe('{"a":1}');
  });

  it('returns null for truncated JSON', () => {
    expect(extractFirstJsonObject('{"crux": "Incomplete JSON')).toBeNull();
  });

  it('returns null for prose without JSON', () => {
    expect(extractFirstJsonObject('No JSON here at all.')).toBeNull();
  });

  it('handles JSON with arrays', () => {
    const text = '{"items":["a","b"],"count":2}';
    expect(extractFirstJsonObject(text)).toBe(text);
  });

  it('extracts valid response with prose wrapper from fixture', () => {
    const canned = loadCanned();
    const text = canned.validResponseWithProse as string;
    const extracted = extractFirstJsonObject(text);
    expect(extracted).not.toBeNull();
    expect(() => JSON.parse(extracted!)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseAndValidate — success cases
// ---------------------------------------------------------------------------

describe('parseAndValidate — success', () => {
  it('parses a valid JSON string', () => {
    const canned = loadCanned();
    const text = JSON.stringify(canned.validResponse);
    const result = parseAndValidate(text);
    expect(result.crux).toBeTypeOf('string');
    expect(result.resolution).toBeTypeOf('string');
    expect(Array.isArray(result.affected_areas)).toBe(true);
  });

  it('parses valid response with prose wrapper', () => {
    const canned = loadCanned();
    const text = canned.validResponseWithProse as string;
    const result = parseAndValidate(text);
    expect(result.crux.length).toBeGreaterThan(0);
  });

  it('allows empty affected_areas array', () => {
    const canned = loadCanned();
    const result = parseAndValidate(JSON.stringify(canned.validResponseEmptyAreas));
    expect(result.affected_areas).toHaveLength(0);
  });

  it('accepts all valid confidence levels', () => {
    for (const confidence of ['high', 'medium', 'low'] as const) {
      const obj = {
        crux: 'Some crux.',
        resolution: 'Some resolution.',
        affected_areas: [{ area_label: 'Service', confidence }],
      };
      expect(() => parseAndValidate(JSON.stringify(obj))).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// parseAndValidate — failure cases
// ---------------------------------------------------------------------------

describe('parseAndValidate — failure', () => {
  it('throws InvalidModelOutputError for malformed response (no JSON)', () => {
    const canned = loadCanned();
    expect(() => parseAndValidate(canned.malformedResponse as string)).toThrow(
      InvalidModelOutputError,
    );
  });

  it('throws InvalidModelOutputError for truncated JSON', () => {
    const canned = loadCanned();
    expect(() => parseAndValidate(canned.truncatedJsonResponse as string)).toThrow(
      InvalidModelOutputError,
    );
  });

  it('throws InvalidModelOutputError for wrong schema', () => {
    const canned = loadCanned();
    expect(() => parseAndValidate(JSON.stringify(canned.wrongSchemaResponse))).toThrow(
      InvalidModelOutputError,
    );
  });

  it('throws InvalidModelOutputError for invalid confidence enum', () => {
    const canned = loadCanned();
    expect(() => parseAndValidate(JSON.stringify(canned.invalidConfidenceResponse))).toThrow(
      InvalidModelOutputError,
    );
  });

  it('throws InvalidModelOutputError for crux exceeding 1200 chars', () => {
    const canned = loadCanned();
    expect(() => parseAndValidate(JSON.stringify(canned.cruxTooLongResponse))).toThrow(
      InvalidModelOutputError,
    );
  });

  it('includes issueCount in thrown error', () => {
    const canned = loadCanned();
    let error: unknown;
    try {
      parseAndValidate(JSON.stringify(canned.wrongSchemaResponse));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(InvalidModelOutputError);
    expect((error as InvalidModelOutputError).issueCount).toBeGreaterThan(0);
  });

  it('includes provided traceId in thrown error', () => {
    const canned = loadCanned();
    let error: unknown;
    try {
      parseAndValidate(canned.malformedResponse as string, 'trace-abc-123');
    } catch (e) {
      error = e;
    }
    expect((error as InvalidModelOutputError).traceId).toBe('trace-abc-123');
  });
});

// ---------------------------------------------------------------------------
// Zod schema directly
// ---------------------------------------------------------------------------

describe('SynthesisOutputSchema', () => {
  it('rejects crux shorter than 1 char', () => {
    const result = SynthesisOutputSchema.safeParse({
      crux: '',
      resolution: 'Valid.',
      affected_areas: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects resolution shorter than 1 char', () => {
    const result = SynthesisOutputSchema.safeParse({
      crux: 'Valid.',
      resolution: '',
      affected_areas: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 10 affected areas', () => {
    const areas = Array.from({ length: 11 }, (_, i) => ({
      area_label: `Area ${i}`,
      confidence: 'medium' as const,
    }));
    const result = SynthesisOutputSchema.safeParse({
      crux: 'Valid crux.',
      resolution: 'Valid resolution.',
      affected_areas: areas,
    });
    expect(result.success).toBe(false);
  });
});
