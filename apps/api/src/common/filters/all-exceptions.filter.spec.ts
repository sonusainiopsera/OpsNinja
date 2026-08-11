import { describe, it, expect } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ZodError, z } from 'zod';
import { AllExceptionsFilter } from './all-exceptions.filter';
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  RateLimitError,
} from '../errors/app-error';
import { TamperedCursorError } from '@opsninja/shared';

const TRACE_ID = 'test-trace-id-0000';

// ─── Helper ───────────────────────────────────────────────────────────────────

function mapError(exception: unknown) {
  return AllExceptionsFilter.toEnvelope(exception, TRACE_ID);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AllExceptionsFilter.toEnvelope', () => {
  describe('envelope shape invariants', () => {
    it('always includes error.code, error.message, error.details, error.traceId', () => {
      const { body } = mapError(new NotFoundError('ticket', '1'));
      expect(body.error).toMatchObject({
        code: expect.any(String),
        message: expect.any(String),
        details: expect.any(Array),
        traceId: TRACE_ID,
      });
    });

    it('never includes a stack property in the envelope', () => {
      const { body } = mapError(new Error('boom'));
      expect(JSON.stringify(body)).not.toContain('stack');
    });

    it('never leaks SQL fragments in the envelope', () => {
      const err = new Error('syntax error near SELECT * FROM users WHERE 1=1');
      const { body } = mapError(err);
      expect(JSON.stringify(body)).not.toContain('SELECT');
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('AppError subclasses → correct HTTP status', () => {
    it('ValidationError → 400', () => {
      const err = new ValidationError([{ field: 'email', issue: 'Invalid email' }]);
      const { status, body } = mapError(err);
      expect(status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toEqual([{ field: 'email', issue: 'Invalid email' }]);
    });

    it('UnauthorizedError → 401', () => {
      const { status, body } = mapError(new UnauthorizedError());
      expect(status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('ForbiddenError → 403', () => {
      const { status, body } = mapError(new ForbiddenError());
      expect(status).toBe(403);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('NotFoundError → 404', () => {
      const { status, body } = mapError(new NotFoundError('ticket', 'TKT-1'));
      expect(status).toBe(404);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('TKT-1');
    });

    it('ConflictError → 409', () => {
      const { status, body } = mapError(new ConflictError());
      expect(status).toBe(409);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('UnprocessableEntityError → 422', () => {
      const { status, body } = mapError(
        new UnprocessableEntityError('SLA policy does not apply'),
      );
      expect(status).toBe(422);
      expect(body.error.code).toBe('UNPROCESSABLE_ENTITY');
    });

    it('RateLimitError → 429', () => {
      const { status, body } = mapError(new RateLimitError(60));
      expect(status).toBe(429);
      expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('TamperedCursorError (from packages/shared)', () => {
    it('maps to 400 INVALID_CURSOR', () => {
      const { status, body } = mapError(new TamperedCursorError());
      expect(status).toBe(400);
      expect(body.error.code).toBe('INVALID_CURSOR');
    });
  });

  describe('Zod validation errors', () => {
    it('maps to 400 VALIDATION_ERROR with per-field details', () => {
      let zodError: ZodError | undefined;
      try {
        z.object({ age: z.number() }).parse({ age: 'not-a-number' });
      } catch (e) {
        zodError = e as ZodError;
      }
      expect(zodError).toBeInstanceOf(ZodError);
      const { status, body } = mapError(zodError!);
      expect(status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.length).toBeGreaterThan(0);
      expect(body.error.details[0]).toHaveProperty('field');
      expect(body.error.details[0]).toHaveProperty('issue');
    });
  });

  describe('NestJS HttpException', () => {
    it('maps HttpException 404 to NOT_FOUND', () => {
      const { status, body } = mapError(new HttpException('Not found', HttpStatus.NOT_FOUND));
      expect(status).toBe(404);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('maps HttpException 403 to FORBIDDEN', () => {
      const { status, body } = mapError(
        new HttpException('Forbidden', HttpStatus.FORBIDDEN),
      );
      expect(status).toBe(403);
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('unknown throwables', () => {
    it('maps a plain Error to 500 INTERNAL_ERROR without leaking the message', () => {
      const err = new Error('database connection string: postgres://user:secret@host:5432/db');
      const { status, body } = mapError(err);
      expect(status).toBe(500);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      // The internal message must NOT appear in the response
      expect(body.error.message).toBe('An unexpected error occurred');
      expect(JSON.stringify(body)).not.toContain('database connection string');
      expect(JSON.stringify(body)).not.toContain('secret');
    });

    it('maps a thrown string to 500 INTERNAL_ERROR', () => {
      const { status, body } = mapError('something went wrong');
      expect(status).toBe(500);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('maps a thrown null to 500 INTERNAL_ERROR', () => {
      const { status, body } = mapError(null);
      expect(status).toBe(500);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('traceId propagation', () => {
    it('includes the provided traceId in every envelope', () => {
      const customTrace = 'custom-trace-xyz-789';
      const { body: b1 } = AllExceptionsFilter.toEnvelope(new NotFoundError('x'), customTrace);
      const { body: b2 } = AllExceptionsFilter.toEnvelope(new Error('boom'), customTrace);
      expect(b1.error.traceId).toBe(customTrace);
      expect(b2.error.traceId).toBe(customTrace);
    });
  });

  describe('HTTP status discipline', () => {
    const STATUS_MAP: Array<[number, string, AppError]> = [
      [400, 'VALIDATION_ERROR', new ValidationError([])],
      [401, 'UNAUTHORIZED', new UnauthorizedError()],
      [403, 'FORBIDDEN', new ForbiddenError()],
      [404, 'NOT_FOUND', new NotFoundError('resource')],
      [409, 'CONFLICT', new ConflictError()],
      [422, 'UNPROCESSABLE_ENTITY', new UnprocessableEntityError('rule failed')],
      [429, 'RATE_LIMIT_EXCEEDED', new RateLimitError(30)],
    ];

    it.each(STATUS_MAP)(
      '%i maps to code %s',
      (expectedStatus, expectedCode, error) => {
        const { status, body } = mapError(error);
        expect(status).toBe(expectedStatus);
        expect(body.error.code).toBe(expectedCode);
      },
    );
  });
});
