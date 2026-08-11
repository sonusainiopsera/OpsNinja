import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/**
 * Per-request context stored in AsyncLocalStorage.
 * Seeded by RequestContextMiddleware at the start of each request.
 * Later populated by the auth guard (tenantId, principalId).
 */
export interface RequestContext {
  /** Unique trace identifier — generated or forwarded from X-Trace-ID header. */
  traceId: string;
  /** Resolved tenant identifier; null until auth guard runs. */
  tenantId: string | null;
  /** Resolved principal (user) identifier; null until auth guard runs. */
  principalId: string | null;
}

// ─── Singleton store ──────────────────────────────────────────────────────────

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Static service that exposes the current request context.
 * All reads come from the AsyncLocalStorage store — never leaks between requests
 * even under high concurrency.
 */
export const RequestContextService = {
  /**
   * Runs `callback` inside an AsyncLocalStorage context initialised with `context`.
   * Must be called by the middleware before any downstream code.
   */
  run(context: RequestContext, callback: () => void): void {
    storage.run(context, callback);
  },

  /** Returns the current request context, or undefined outside a request. */
  get(): RequestContext | undefined {
    return storage.getStore();
  },

  /** Returns the traceId or a fallback string when called outside a request. */
  getTraceId(): string {
    return storage.getStore()?.traceId ?? 'no-trace';
  },

  /**
   * Merges the provided partial context into the current store.
   * Used by the auth guard to add tenantId / principalId without re-entering storage.
   */
  set(partial: Partial<Omit<RequestContext, 'traceId'>>): void {
    const current = storage.getStore();
    if (current) {
      if (partial.tenantId !== undefined) current.tenantId = partial.tenantId;
      if (partial.principalId !== undefined) current.principalId = partial.principalId;
    }
  },
} as const;

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * NestJS middleware that seeds the AsyncLocalStorage context for each request.
 * Generates a UUID traceId or forwards the value of the `X-Trace-ID` header.
 * Exposes the traceId back on the response via `X-Trace-ID`.
 *
 * Register this as the FIRST middleware in app.module.ts to ensure all
 * downstream code (interceptors, guards, filters) has access to context.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incomingTraceId = req.headers['x-trace-id'];
    const traceId =
      typeof incomingTraceId === 'string' && incomingTraceId.length > 0
        ? incomingTraceId
        : randomUUID();

    res.setHeader('X-Trace-ID', traceId);

    RequestContextService.run({ traceId, tenantId: null, principalId: null }, next);
  }
}
