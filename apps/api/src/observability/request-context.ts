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
/**
 * Request-scoped AsyncLocalStorage context.
 *
 * Stores the authenticated principal and the active database transaction handle
 * so any service can read them without constructor-plumbing through every call
 * signature.
 *
 * Usage:
 *   // Inside any service or repository:
 *   const principal = RequestContextStore.getPrincipal();
 *   const tx = RequestContextStore.getTx();
 */

import { AsyncLocalStorage } from 'async_hooks';
import { DrizzleHandle } from '@opsninja/db';
import { ErrorCode } from '../common/errors/app-errors';

// ─── Principal types ──────────────────────────────────────────────────────────

export type PrincipalKind = 'staff' | 'portal' | 'machine';

/**
 * Fully resolved, typed representation of the authenticated actor.
 * Populated from the JWT claims + Redis scope cache by the auth guard.
 */
export interface PrincipalContext {
  /** UUID of the owning tenant. */
  tenantId: string;
  /** UUID of the authenticated user (or machine credential). */
  userId: string;
  /** Trust tier of the principal. */
  principalKind: PrincipalKind;
  /** RBAC roles granted to this principal within the tenant. */
  roles: string[];
  /**
   * Organization UUIDs in scope for portal principals and scoped staff agents.
   * Empty array means "no org restriction" for staff, "all own orgs" for portal.
   */
  orgScopeIds: string[];
  /** Distributed trace identifier carried from the incoming request. */
  traceId: string;
}

// ─── Context store ────────────────────────────────────────────────────────────

export interface RequestContext {
  principal?: PrincipalContext;
  /** Active Drizzle transaction handle for the current request. */
  tx?: DrizzleHandle;
  /** RFC 7239 / X-Request-ID value for log correlation. */
  requestId?: string;
  /** High-resolution timestamp when the request entered the interceptor. */
  requestStartedAt?: bigint;
}

/** Throws when the caller tries to access the tenant context outside a bound transaction. */
export class TenantContextMissingError extends Error {
  readonly code = ErrorCode.TENANT_CONTEXT_MISSING;

  constructor(detail?: string) {
    super(
      `TENANT_CONTEXT_MISSING${detail ? `: ${detail}` : ''}. ` +
        'This is a programming defect – ensure all database access goes through ' +
        'UnitOfWork.withTenantTransaction() or a bound TenantRepository.',
    );
    this.name = 'TenantContextMissingError';
  }
}

// ─── Module-private storage ───────────────────────────────────────────────────

const _store = new AsyncLocalStorage<RequestContext>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Immutable container for the per-request AsyncLocalStorage context.
 *
 * The `run()` entry point is called once per request by the tenant-context
 * interceptor.  All other code uses the typed getters.
 */
export class RequestContextStore {
  private constructor() {}

  /**
   * Execute `fn` inside a new request context.
   * Contexts are nested automatically by AsyncLocalStorage; calling `run()` a
   * second time (e.g. from a worker job) creates an independent child context
   * rather than sharing state with the parent.
   */
  static run<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
    return _store.run(context, fn);
  }

  /** Returns the raw context object for the current async chain, or undefined. */
  static get(): RequestContext | undefined {
    return _store.getStore();
  }

  /**
   * Returns the PrincipalContext for the current request.
   * @throws {TenantContextMissingError} when called outside a bound transaction.
   */
  static getPrincipal(): PrincipalContext {
    const ctx = _store.getStore();
    if (!ctx?.principal) {
      throw new TenantContextMissingError('principal not set');
    }
    return ctx.principal;
  }

  /**
   * Returns the active Drizzle transaction handle for the current request.
   * @throws {TenantContextMissingError} when called outside a bound transaction.
   */
  static getTx(): DrizzleHandle {
    const ctx = _store.getStore();
    if (!ctx?.tx) {
      throw new TenantContextMissingError('transaction handle not set');
    }
    return ctx.tx;
  }

  /** Returns the request-scoped trace ID, falling back to a default when absent. */
  static getTraceId(): string {
    return _store.getStore()?.principal?.traceId ?? _store.getStore()?.requestId ?? 'unknown';
  }

  /**
   * Mutates the current context store in-place.
   * Only the tenant-context interceptor and unit-of-work should call this.
   *
   * @internal
   */
  static _set(patch: Partial<RequestContext>): void {
    const ctx = _store.getStore();
    if (!ctx) {
      throw new TenantContextMissingError('no active context – call run() first');
    }
    Object.assign(ctx, patch);
  }
}
