import { Module } from '@nestjs/common';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { AuthController } from './auth.controller';
import { RefreshSessionRepository } from './repositories/refresh-session.repository';

@Module({
  controllers: [AuthController],
  providers: [TokenService, SessionService, RefreshSessionRepository],
  exports: [TokenService, SessionService],
})
export class IdentityModule {}
