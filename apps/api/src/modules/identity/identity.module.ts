/**
 * IdentityModule — authentication, token issuance, and session management.
 *
 * All routes in this module are decorated with @NoTenantContext because auth
 * endpoints run outside the per-request tenant transaction.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthController } from './auth.controller';
import { AdminAuthController } from './admin.auth.controller';
import { TokenService } from './services/token.service';
import { SessionService } from './services/session.service';
import { AuthAuditEmitter } from './services/auth-audit.emitter';
import { RefreshSessionRepository } from './repositories/refresh-session.repository';
import { AuditService } from '../../common/auth/audit.service';
import { SecurityModule } from '../../common/security/security.module';

@Module({
  imports: [ConfigModule, SecurityModule],
  controllers: [AuthController, AdminAuthController],
  providers: [
    TokenService,
    SessionService,
    AuditService,
    AuthAuditEmitter,
    {
      provide: 'REFRESH_SESSION_REPOSITORY',
      useClass: RefreshSessionRepository,
    },
  ],
  exports: [TokenService, SessionService, AuditService, AuthAuditEmitter],
})
export class IdentityModule {}
