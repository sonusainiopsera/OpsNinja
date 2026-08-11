/**
 * AppModule – root NestJS module.
 *
 * Global provider registration order is significant:
 *
 *   1. APP_GUARD  – AuthGuard  (validates JWT, attaches PrincipalContext to request.user)
 *   2. APP_INTERCEPTOR[0] – TenantContextInterceptor  (outer, opens tenant-bound transaction)
 *   3. APP_INTERCEPTOR[1] – AuditInterceptor           (inner, populates AuditContext inside the tx)
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
import { RedisModule } from './common/redis/redis.module';
import { IdentityModule } from './modules/identity/identity.module';
import { AuditModule } from './common/audit/audit.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { AuthGuard } from './common/guards/auth.guard';
import { TenantContextInterceptor } from './common/tenant/tenant-context.interceptor';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { UnitOfWork } from './data/unit-of-work';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DbModule,
    RedisModule,
    AuditModule,
    HealthModule,
    IdentityModule,
    TicketsModule,
    ReportingModule,
    NotificationsModule,
    WebhooksModule,
    OrganizationsModule,
  ],
  providers: [
    // ── Global guard (runs first) ────────────────────────────────────────────
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    // ── Global interceptors (run after guard, outermost first) ──────────────
    {
      provide: APP_INTERCEPTOR,
      inject: [Reflector, UnitOfWork, ConfigService],
      useFactory: (
        reflector: Reflector,
        unitOfWork: UnitOfWork,
        config: ConfigService,
      ) => new TenantContextInterceptor(reflector, unitOfWork, config),
    },
    // AuditInterceptor is registered second → runs INSIDE TenantContextInterceptor
    // so the DB transaction is already open when AuditContext is populated.
    {
      provide: APP_INTERCEPTOR,
      inject: [Reflector, AuditInterceptor],
      useFactory: (_reflector: Reflector, interceptor: AuditInterceptor) => interceptor,
    },
  ],
})
export class AppModule {}
