import { Module } from '@nestjs/common';
import { PortalVerificationService } from './portal-verification.service';
import { PortalVerificationController } from './portal-verification.controller';
import { TokenService } from '../token.service';
import { SessionService } from '../session.service';
import { RefreshSessionRepository } from '../repositories/refresh-session.repository';

@Module({
  controllers: [PortalVerificationController],
  providers: [
    PortalVerificationService,
    TokenService,
    SessionService,
    RefreshSessionRepository,
  ],
  exports: [PortalVerificationService],
})
export class PortalSignupModule {}
