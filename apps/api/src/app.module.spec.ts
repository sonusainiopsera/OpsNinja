/**
 * Unit tests asserting the global guard and interceptor registration order in AppModule.
 *
 * NestJS executes guards before interceptors. The AuthGuard (APP_GUARD) verifies
 * the JWT and attaches request.user; TenantContextInterceptor (APP_INTERCEPTOR)
 * reads request.user to open the tenant-scoped transaction.
 *
 * If either registration is silently removed by a future refactor, every request
 * would either be unauthenticated (no guard) or fail with TENANT_CONTEXT_MISSING
 * (no interceptor). These tests catch that regression at the metadata level without
 * spinning up a full NestJS application.
 */

import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthGuard } from './common/auth/auth.guard';
import { TenantContextInterceptor } from './common/tenant/tenant-context.interceptor';

type ProviderMeta = { provide: symbol | string; useClass?: unknown };

function getProviders(): ProviderMeta[] {
  const meta = Reflect.getMetadata('providers', AppModule) as { providers?: ProviderMeta[] } | undefined;
  return meta?.providers ?? (meta as unknown as ProviderMeta[]) ?? [];
}

describe('AppModule — global provider registration', () => {
  // ── AuthGuard ─────────────────────────────────────────────────────────────

  it('registers AuthGuard as a global APP_GUARD', () => {
    const guardProviders = getProviders().filter((p) => p.provide === APP_GUARD);
    expect(guardProviders.length).toBeGreaterThan(0);

    const authGuardProvider = guardProviders.find((p) => p.useClass === AuthGuard);
    expect(authGuardProvider).toBeDefined();
  });

  // ── TenantContextInterceptor ──────────────────────────────────────────────

  it('registers TenantContextInterceptor as a global APP_INTERCEPTOR', () => {
    const interceptorProviders = getProviders().filter((p) => p.provide === APP_INTERCEPTOR);
    expect(interceptorProviders.length).toBeGreaterThan(0);

    const tenantInterceptorProvider = interceptorProviders.find(
      (p) => p.useClass === TenantContextInterceptor,
    );
    expect(tenantInterceptorProvider).toBeDefined();
  });

  it('TenantContextInterceptor is the first APP_INTERCEPTOR registered', () => {
    const interceptorProviders = getProviders().filter((p) => p.provide === APP_INTERCEPTOR);
    expect(interceptorProviders[0]?.useClass).toBe(TenantContextInterceptor);
  });
});
