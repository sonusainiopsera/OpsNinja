/**
 * Unit test asserting the global interceptor registration order in AppModule.
 *
 * The tenant-context interceptor reads request.user populated by the JWT auth
 * guard. If they were swapped, the interceptor would always see an empty principal
 * and reject every request with 500 TENANT_CONTEXT_MISSING.
 *
 * This test asserts that TenantContextInterceptor is registered as APP_INTERCEPTOR
 * in AppModule's providers metadata, preventing a silent inversion by a future
 * refactor.
 */

import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppModule } from './app.module';
import { TenantContextInterceptor } from './common/tenant/tenant-context.interceptor';

describe('AppModule registration order', () => {
  it('registers TenantContextInterceptor as a global APP_INTERCEPTOR', () => {
    // Retrieve the providers metadata registered on the module class.
    const moduleMetadata: { providers?: Array<{ provide: symbol; useClass?: unknown }> } =
      Reflect.getMetadata('providers', AppModule) ?? {};

    const interceptorProviders = (moduleMetadata.providers ?? []).filter(
      (p) => p.provide === APP_INTERCEPTOR,
    );

    expect(interceptorProviders.length).toBeGreaterThan(0);

    const tenantInterceptorProvider = interceptorProviders.find(
      (p) => p.useClass === TenantContextInterceptor,
    );

    expect(tenantInterceptorProvider).toBeDefined();
  });

  it('TenantContextInterceptor is the first APP_INTERCEPTOR registered', () => {
    const moduleMetadata: { providers?: Array<{ provide: symbol; useClass?: unknown }> } =
      Reflect.getMetadata('providers', AppModule) ?? {};

    const interceptorProviders = (moduleMetadata.providers ?? []).filter(
      (p) => p.provide === APP_INTERCEPTOR,
    );

    // If there are multiple APP_INTERCEPTORs in the future, TenantContext must
    // remain first because it opens the transaction and sets up the context
    // that subsequent interceptors may depend on.
    expect(interceptorProviders[0]?.useClass).toBe(TenantContextInterceptor);
  });
});
