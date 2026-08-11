/**
 * Zod schema for model structured output and defensive JSON extraction.
 *
 * The model is instructed to emit a single JSON object. In practice it may
 * wrap the object in prose ("Here is the analysis: {...}") or add markdown
 * code fences. The extraction helper locates the first balanced JSON object
 * without eval or regex-only parsing, then Zod validates the parsed value.
 */

import { z } from 'zod';
import { InvalidModelOutputError } from './errors.js';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const ConfidenceEnum = z.enum(['low', 'medium', 'high']);

const AffectedAreaSchema = z.object({
  area_label: z.string().min(1).max(80),
  confidence:  ConfidenceEnum,
});

/**
 * Canonical model output schema.
 * crux: one-sentence problem distillation (1–1 200 chars).
 * resolution: current state or how the issue was resolved (1–2 000 chars).
 * affected_areas: up to 10 system components with confidence.
 */
export const SynthesisOutputSchema = z.object({
  crux:           z.string().min(1).max(1200),
  resolution:     z.string().min(1).max(2000),
  affected_areas: z.array(AffectedAreaSchema).max(10),
});

export type SynthesisOutput = z.infer<typeof SynthesisOutputSchema>;
export type AffectedAreaOutput = z.infer<typeof AffectedAreaSchema>;

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/**
 * Locates and returns the first balanced JSON object `{...}` in the input
 * string without using eval. Returns `null` if no balanced object is found.
 *
 * Algorithm:
 *  1. Find the first `{` character.
 *  2. Walk forward counting `{` / `}`, skipping string literals.
 *  3. When the counter reaches 0 we have a balanced object.
 *  4. Attempt JSON.parse on the extracted substring.
 */
export function extractFirstJsonObject(text: string): unknown | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === undefined) break;

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') { depth++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate) as unknown;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Parse and validate
// ---------------------------------------------------------------------------

/**
 * Extracts and validates model output against SynthesisOutputSchema.
 *
 * @throws InvalidModelOutputError when extraction or validation fails.
 */
export function parseAndValidate(rawText: string, traceId?: string): SynthesisOutput {
  const extracted = extractFirstJsonObject(rawText);

  if (extracted === null) {
    throw new InvalidModelOutputError(1, traceId);
  }

  const result = SynthesisOutputSchema.safeParse(extracted);

  if (!result.success) {
    throw new InvalidModelOutputError(result.error.issues.length, traceId);
  }

  return result.data;
}
