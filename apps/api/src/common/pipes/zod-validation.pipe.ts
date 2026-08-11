import { PipeTransform, BadRequestException } from '@nestjs/common';
import type { ZodSchema } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request body validation failed.',
          details: result.error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        },
      });
    }
    return result.data;
  }
}
