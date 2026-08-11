import { Module } from '@nestjs/common';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { AuthController } from './auth.controller';
import { RefreshSessionRepository } from './repositories/refresh-session.repository';
import { PermissionResolverService } from './services/permission-resolver.service';
import { PrincipalContextProvider } from '../../common/auth/principal-context.provider';

@Module({
  controllers: [AuthController],
  providers: [
    TokenService,
    SessionService,
    RefreshSessionRepository,
    PermissionResolverService,
    PrincipalContextProvider,
  ],
  exports: [TokenService, SessionService, PermissionResolverService, PrincipalContextProvider],
})
export class IdentityModule {}
