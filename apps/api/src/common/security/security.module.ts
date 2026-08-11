/**
 * SecurityModule — cross-cutting throttling and rate-limiting providers.
 *
 * RedisModule and ConfigModule are imported by AppModule as globals so they
 * are available here without re-importing. SecurityModule is imported by
 * IdentityModule which registers ThrottleGuard on auth endpoints.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ThrottleService } from './throttle.service';
import { ThrottleGuard } from './throttle.guard';

@Module({
  imports: [ConfigModule],
  providers: [ThrottleService, ThrottleGuard],
  exports: [ThrottleService, ThrottleGuard],
})
export class SecurityModule {}
