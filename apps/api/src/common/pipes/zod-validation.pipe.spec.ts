import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';
import { ValidationError } from '../errors/app-error';

describe('ZodValidationPipe', () => {
  const NameSchema = z.object({
    name: z.string().min(1),
    age: z.coerce.number().int().positive().optional(),
  });

  type NameInput = z.infer<typeof NameSchema>;

  const pipe = new ZodValidationPipe(NameSchema);

  it('passes through a valid value and returns the parsed result', () => {
    const result = pipe.transform({ name: 'Alice', age: '25' });
    expect(result).toEqual({ name: 'Alice', age: 25 }); // coercion applied
  });

  it('throws ValidationError for a missing required field', () => {
    expect(() => pipe.transform({})).toThrow(ValidationError);
  });

  it('includes per-field details in the thrown error', () => {
    try {
      pipe.transform({ name: '' }); // empty string fails min(1)
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const err = e as ValidationError;
      expect(err.httpStatus).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details.length).toBeGreaterThan(0);
      expect(err.details[0]).toHaveProperty('field', 'name');
      expect(err.details[0]).toHaveProperty('issue');
    }
  });

  it('throws ValidationError for a type mismatch', () => {
    expect(() =>
      pipe.transform({ name: 123 }), // number where string expected
    ).toThrow(ValidationError);
  });

  it('strips unknown fields by default (Zod strips extra keys)', () => {
    const result = pipe.transform({ name: 'Bob', unknownField: 'drop me' });
    expect((result as Record<string, unknown>)['unknownField']).toBeUndefined();
  });

  it('uses strict schema to reject unknown properties', () => {
    const StrictSchema = z.object({ id: z.string() }).strict();
    const strictPipe = new ZodValidationPipe(StrictSchema);
    expect(() => strictPipe.transform({ id: 'abc', extra: 'bad' })).toThrow(ValidationError);
  });

  describe('path flattening', () => {
    it('flattens nested paths to dot notation', () => {
      const NestedSchema = z.object({
        address: z.object({ city: z.string().min(1) }),
      });
      const nestedPipe = new ZodValidationPipe(NestedSchema);
      try {
        nestedPipe.transform({ address: { city: '' } });
        expect.fail('Should have thrown');
      } catch (e) {
        const err = e as ValidationError;
        expect(err.details[0]?.field).toBe('address.city');
      }
    });
  });

  describe('primitive schemas', () => {
    it('validates a UUID string', () => {
      const UuidPipe = new ZodValidationPipe(z.string().uuid());
      const uuid = '01HQX8K7M2VVTZ4XGXQNZRD5AB'.toLowerCase();
      // Valid UUID
      expect(() => new ZodValidationPipe(z.string()).transform(uuid)).not.toThrow();
      // Invalid UUID
      expect(() => UuidPipe.transform('not-a-uuid')).toThrow(ValidationError);
    });
  });

  describe('coercion', () => {
    it('coerces string to number', () => {
      const NumPipe = new ZodValidationPipe(z.coerce.number());
      expect(NumPipe.transform('42')).toBe(42);
    });
  });
});
