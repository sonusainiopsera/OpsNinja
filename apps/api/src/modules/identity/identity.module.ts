import { Module } from '@nestjs/common';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { AuthController } from './auth.controller';
import { UserScopeController } from './users.controller';
import { RefreshSessionRepository } from './repositories/refresh-session.repository';
import { PermissionResolverService } from './services/permission-resolver.service';
import { OrgScopeService } from './services/org-scope.service';
import { PrincipalContextProvider } from '../../common/auth/principal-context.provider';
import { OrganizationsRepository } from '../organizations/organizations.repository';

@Module({
  controllers: [AuthController, UserScopeController],
  providers: [
    TokenService,
    SessionService,
    RefreshSessionRepository,
    PermissionResolverService,
    OrgScopeService,
    PrincipalContextProvider,
    OrganizationsRepository,
  ],
  exports: [
    TokenService,
    SessionService,
    PermissionResolverService,
    OrgScopeService,
    PrincipalContextProvider,
  ],
})
export class IdentityModule {}
