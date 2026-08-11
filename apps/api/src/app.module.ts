/**
 * Root application module.
 *
 * Global interceptor registration order is CRITICAL for correctness:
 *  1. APP_GUARD (JwtAuthGuard) — verifies JWT signature, attaches principal to request.user
 *  2. APP_INTERCEPTOR (TenantContextInterceptor) — reads principal, opens tenant transaction
 *
 * A unit test in app.module.spec.ts asserts this order cannot be silently inverted
 * by a future refactor.
 */

import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TenantContextInterceptor } from './common/tenant/tenant-context.interceptor';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    HealthModule,
  ],
  providers: [
    // ---------------------------------------------------------------------------
    // Global interceptor: TenantContextInterceptor
    //
    // Registered as APP_INTERCEPTOR so it applies to every route that is not
    // decorated with @NoTenantContext. It must be listed AFTER the auth guard
    // (APP_GUARD) because it reads request.user which the guard populates.
    //
    // TEST ASSERTION: apps/api/src/app.module.spec.ts verifies that
    // TenantContextInterceptor appears as the first (and currently only)
    // APP_INTERCEPTOR in the module metadata.
    // ---------------------------------------------------------------------------
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
  ],
})
export class AppModule {}
