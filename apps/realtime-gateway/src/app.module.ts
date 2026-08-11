/**
 * Root NestJS module for the Realtime Gateway.
 *
 * Imports:
 * - ConfigModule: environment variable loading
 * - DashboardGateway, ConnectionRegistry, WsJwtVerifier: WebSocket management
 * - PubSubSubscriber: Redis pub/sub fan-out
 * - BackfillService: reconnect backfill and snapshot_required (WO-069)
 * - HealthController: liveness and readiness probes
 *
 * Does NOT import:
 * - Any @opsninja/db or Postgres modules (gateway never queries Postgres)
 * - TicketsModule, SlaModule, JiraModule (out of scope)
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import Redis from 'ioredis';

import { DashboardGateway } from './gateway/dashboard.gateway';
import { ConnectionRegistry } from './gateway/connection-registry';
import { BackfillService } from './gateway/backfill.service';
import { WsJwtVerifier } from './auth/ws-jwt.verifier';
import { OrgScopeResolver } from './auth/org-scope.resolver';
import { PubSubSubscriber } from './redis/pubsub.subscriber';
import { SlaPubSubSubscriber } from './redis/sla-pubsub.subscriber';
import { HealthController } from './health/health.controller';

const REDIS_COMMAND_CLIENT = 'REDIS_COMMAND_CLIENT';

function createRedisCommandClient(): Redis {
  const url = process.env['REDIS_URL'];
  return url
    ? new Redis(url, { lazyConnect: true, enableReadyCheck: true, maxRetriesPerRequest: 3 })
    : new Redis({ lazyConnect: true, enableReadyCheck: true, maxRetriesPerRequest: 3 });
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
  ],
  controllers: [HealthController],
  providers: [
    // Redis command client (separate from pub/sub subscriber connection)
    {
      provide: REDIS_COMMAND_CLIENT,
      useFactory: createRedisCommandClient,
    },

    ConnectionRegistry,
    WsJwtVerifier,
    OrgScopeResolver,

    // WO-069: backfill service needs a Redis command client (LRANGE)
    {
      provide: BackfillService,
      useFactory: (redis: Redis) => new BackfillService(redis),
      inject: [REDIS_COMMAND_CLIENT],
    },

    // Gateway depends on BackfillService now
    {
      provide: DashboardGateway,
      useFactory: (
        verifier: WsJwtVerifier,
        registry: ConnectionRegistry,
        scopeResolver: OrgScopeResolver,
        backfillService: BackfillService,
      ) => new DashboardGateway(verifier, registry, scopeResolver, backfillService),
      inject: [WsJwtVerifier, ConnectionRegistry, OrgScopeResolver, BackfillService],
    },

    // PubSubSubscriber now depends on BackfillService for live-frame routing
    {
      provide: PubSubSubscriber,
      useFactory: (registry: ConnectionRegistry, backfill: BackfillService) =>
        new PubSubSubscriber(registry, backfill),
      inject: [ConnectionRegistry, BackfillService],
    },

    // WO-050: SLA countdown delta frames
    SlaPubSubSubscriber,
  ],
})
export class AppModule {}
