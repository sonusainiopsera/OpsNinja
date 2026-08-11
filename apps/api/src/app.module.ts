/**
 * AppModule – root NestJS module.
 *
 * Global provider registration order is significant:
 *
 *   1. APP_GUARD  – AuthGuard  (validates JWT, attaches PrincipalContext to request.user)
 *   2. APP_INTERCEPTOR – TenantContextInterceptor  (opens tenant-bound transaction)
 *
 * NestJS executes guards before interceptors, so the principal is always
 * resolved and attached before the interceptor tries to read it.  A unit test
 * in app.module.spec.ts asserts this registration order to prevent future
 * refactors from silently inverting it.
 */

import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { DbModule } from './data/db.module';
import { HealthModule } from './health/health.module';
import { AuthGuard } from './common/guards/auth.guard';
import { TenantContextInterceptor } from './common/tenant/tenant-context.interceptor';
import { UnitOfWork } from './data/unit-of-work';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DbModule,
    HealthModule,
  ],
  providers: [
    // ── Global guard (runs first) ────────────────────────────────────────────
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    // ── Global interceptor (runs after guard) ────────────────────────────────
    {
      provide: APP_INTERCEPTOR,
      inject: [Reflector, UnitOfWork, ConfigService],
      useFactory: (
        reflector: Reflector,
        unitOfWork: UnitOfWork,
        config: ConfigService,
      ) => new TenantContextInterceptor(reflector, unitOfWork, config),
    },
  ],
})
export class AppModule {}
