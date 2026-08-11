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
import { PortalVerificationController } from './portal-signup/portal-verification.controller';
import { PortalVerificationService } from './portal-signup/portal-verification.service';
import { TokenCodec } from './portal-signup/token.codec';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PortalSignupController } from './portal-signup/portal-signup.controller';
import { PortalSignupService } from './portal-signup/portal-signup.service';
import { SignupThrottleGuard } from './guards/signup-throttle.guard';

@Module({
  imports: [ConfigModule, SecurityModule, OrganizationsModule],
  controllers: [AuthController, AdminAuthController, PortalVerificationController, PortalSignupController],
  providers: [
    TokenService,
    SessionService,
    AuditService,
    AuthAuditEmitter,
    PortalVerificationService,
    TokenCodec,
    PortalSignupService,
    SignupThrottleGuard,
    {
      provide: 'REFRESH_SESSION_REPOSITORY',
      useClass: RefreshSessionRepository,
    },
  ],
  exports: [TokenService, SessionService, AuditService, AuthAuditEmitter],
})
export class IdentityModule {}
