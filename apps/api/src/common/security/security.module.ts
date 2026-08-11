import { Global, Module } from '@nestjs/common';
import { ThrottleService } from './throttle.service';
import { ThrottleGuard } from './throttle.guard';

/**
 * SecurityModule – provides application-level rate limiting.
 *
 * @Global() so ThrottleService and ThrottleGuard are injectable anywhere
 * without additional imports.
 */
@Global()
@Module({
  providers: [ThrottleService, ThrottleGuard],
  exports: [ThrottleService, ThrottleGuard],
})
export class SecurityModule {}
