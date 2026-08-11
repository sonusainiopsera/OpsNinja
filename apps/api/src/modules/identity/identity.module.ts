import { Module } from '@nestjs/common';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { AuthController } from './auth.controller';
import { UserScopeController } from './users.controller';
import { AdminAuthController } from './admin-auth.controller';
import { RefreshSessionRepository } from './repositories/refresh-session.repository';
import { PermissionResolverService } from './services/permission-resolver.service';
import { OrgScopeService } from './services/org-scope.service';
import { AuthAuditEmitter } from './services/auth-audit.emitter';
import { PrincipalContextProvider } from '../../common/auth/principal-context.provider';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { PortalSignupModule } from './portal-signup/portal-signup.module';

@Module({
  imports: [PortalSignupModule],
  controllers: [AuthController, UserScopeController, AdminAuthController],
  providers: [
    TokenService,
    SessionService,
    RefreshSessionRepository,
    PermissionResolverService,
    OrgScopeService,
    AuthAuditEmitter,
    PrincipalContextProvider,
    OrganizationsRepository,
  ],
  exports: [
    TokenService,
    SessionService,
    PermissionResolverService,
    OrgScopeService,
    AuthAuditEmitter,
    PrincipalContextProvider,
  ],
})
export class IdentityModule {}
