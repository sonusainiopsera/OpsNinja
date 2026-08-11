/**
 * AuthModule — RBAC guard, permission resolution, and audit service.
 *
 * Imported by AppModule which registers AuthGuard as a global APP_GUARD.
 * RedisModule is imported for the PermissionResolverService cache.
 * IdentityModule is imported for TokenService (JWT verification).
 */

import { Module } from '@nestjs/common';

import { RedisModule } from '../redis/redis.module';
import { IdentityModule } from '../../modules/identity/identity.module';
import { AuthGuard } from './auth.guard';
import { PermissionResolverService } from './permission-resolver.service';
import { AuditService } from './audit.service';

@Module({
  imports: [RedisModule, IdentityModule],
  providers: [AuthGuard, PermissionResolverService, AuditService],
  exports: [AuthGuard, PermissionResolverService, AuditService],
})
export class AuthModule {}
