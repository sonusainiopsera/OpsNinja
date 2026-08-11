/**
 * HeartbeatService – manages ping/pong liveness and scope-version revalidation.
 *
 * Two independent intervals:
 *   1. Ping every HEARTBEAT_INTERVAL_MS (default 30s); close socket if no
 *      pong received within 10s.  Uses Date.now() (monotonic enough for this
 *      purpose; clock jumps > 10s are extremely unlikely on container hosts).
 *   2. Scope revalidation every SCOPE_REVALIDATE_MS (default 60s); compares
 *      the token's org_scope_version against the Redis counter
 *      scope:version:{tenantId}:{principalId} and closes with 4440 on mismatch.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ConnectionRegistry } from './connection-registry';

const PONG_DEADLINE_MS = 10_000;

@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private readonly heartbeatIntervalMs: number;
  private readonly scopeRevalidateMs: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private revalidateTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ConnectionRegistry,
    private readonly redis: Redis,
  ) {
    this.heartbeatIntervalMs = this.config.get<number>('HEARTBEAT_INTERVAL_MS', 30_000);
    this.scopeRevalidateMs   = this.config.get<number>('SCOPE_REVALIDATE_MS', 60_000);
  }

  onModuleInit(): void {
    this.heartbeatTimer  = setInterval(() => this.runPingReaper(),  this.heartbeatIntervalMs);
    this.revalidateTimer = setInterval(() => void this.runScopeCheck(), this.scopeRevalidateMs);
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer)  clearInterval(this.heartbeatTimer);
    if (this.revalidateTimer) clearInterval(this.revalidateTimer);
  }

  recordPong(socketId: string, tenantId: string): void {
    for (const wrapper of this.registry.getByTenant(tenantId)) {
      if (wrapper.id === socketId) {
        wrapper.lastPongAt = Date.now();
        return;
      }
    }
  }

  private runPingReaper(): void {
    const now = Date.now();
    const deadline = now - (this.heartbeatIntervalMs + PONG_DEADLINE_MS);

    for (const wrapper of this.registry.allWrappers()) {
      if (wrapper.socket.readyState !== 1 /* OPEN */) continue;

      if (wrapper.lastPongAt < deadline) {
        this.logger.warn({
          event: 'heartbeat.pong_timeout',
          socketId: wrapper.id,
          tenantId: wrapper.principal.tenantId,
          principalId: wrapper.principal.principalId,
        });
        wrapper.socket.close(1001, 'pong_timeout');
        continue;
      }

      try {
        wrapper.socket.ping();
      } catch {
        // Socket closed between readyState check and ping — harmless
      }
    }
  }

  private async runScopeCheck(): Promise<void> {
    const wrappers = this.registry.allWrappers();
    for (const wrapper of wrappers) {
      if (wrapper.socket.readyState !== 1 /* OPEN */) continue;

      const { tenantId, principalId, orgScopeVersion } = wrapper.principal;
      try {
        const raw = await this.redis.get(`scope:version:${tenantId}:${principalId}`);
        const serverVersion = raw ? parseInt(raw, 10) : 0;

        if (serverVersion > orgScopeVersion) {
          this.logger.log({
            event: 'heartbeat.scope_stale',
            socketId: wrapper.id,
            tenantId,
            principalId,
            tokenVersion: orgScopeVersion,
            serverVersion,
          });
          wrapper.socket.close(4440, 'scope_version_invalidated');
        }
      } catch (err) {
        this.logger.warn({
          event: 'heartbeat.scope_check_failed',
          socketId: wrapper.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
