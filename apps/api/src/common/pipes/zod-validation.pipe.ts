import { Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../errors/app-error';

/**
 * Zod-based validation pipe.
 *
 * Usage:
 * ```typescript
 * @Get('items')
 * list(@Query(new ZodValidationPipe(ListQuerySchema)) query: ListQuery) { ... }
 * ```
 *
 * Or register globally via app.useGlobalPipes() with a schema resolver.
 *
 * Behaviour:
 * - Parses and validates the value against the provided Zod schema.
 * - Returns the *parsed* value (coercions like z.coerce.number() are applied).
 * - Unknown properties are stripped unless the schema uses `.strict()` or `.passthrough()`.
 * - On failure, throws a `ValidationError` (HTTP 400) with per-field details,
 *   consumed by the global `AllExceptionsFilter`.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new ValidationError(
        result.error.errors.map((e: ZodError['errors'][number]) => ({
          field: e.path.length > 0 ? e.path.join('.') : '_root',
          issue: e.message,
        })),
      );
    }

    return result.data;
  }
}

/**
 * Convenience factory — creates a `ZodValidationPipe` from a schema.
 * Preferred in route decorators for readability.
 *
 * @example
 * @Param('id', zodPipe(z.string().uuid()))
 */
export function zodPipe<T>(schema: ZodSchema<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}
