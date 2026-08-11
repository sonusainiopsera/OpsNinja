/**
 * Root application module.
 *
 * Global provider registration order is CRITICAL for correctness:
 *  1. APP_GUARD (AuthGuard) — verifies JWT, resolves permissions, attaches principal to request.user
 *  2. APP_INTERCEPTOR (TenantContextInterceptor) — reads principal, opens tenant transaction
 *
 * NestJS executes guards before interceptors in the request pipeline, so this
 * ordering is guaranteed by the framework regardless of registration order.
 *
 * Unit tests in app.module.spec.ts assert both registrations cannot be silently removed.
 */

import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TenantContextInterceptor } from './common/tenant/tenant-context.interceptor';
import { AuthGuard } from './common/auth/auth.guard';
import { AuthModule } from './common/auth/auth.module';
import { RedisModule } from './common/redis/redis.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { TicketsModule } from './modules/tickets/tickets.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    RedisModule,
    IdentityModule,
    AuthModule,
    HealthModule,
    TicketsModule,
    ReportingModule,
    NotificationsModule,
    WebhooksModule,
  ],
  providers: [
    // ── Global guard: AuthGuard ───────────────────────────────────────────────
    // Runs before every interceptor. Verifies the JWT, resolves RBAC permissions,
    // and attaches request.user for TenantContextInterceptor.
    // Routes decorated with @Public() bypass the guard entirely.
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    // ── Global interceptor: TenantContextInterceptor ──────────────────────────
    // Reads request.user (set by AuthGuard), opens the tenant-scoped transaction,
    // and wraps the handler inside withTenantTransaction.
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
  ],
})
export class AppModule {}
