/**
 * Root NestJS module for the Realtime Gateway.
 *
 * Imports:
 * - ConfigModule: environment variable loading
 * - DashboardGateway, ConnectionRegistry, WsJwtVerifier: WebSocket management
 * - PubSubSubscriber: Redis pub/sub fan-out
 * - HealthController: liveness and readiness probes
 *
 * Does NOT import:
 * - Any @opsninja/db or Postgres modules (gateway never queries Postgres)
 * - TicketsModule, SlaModule, JiraModule (out of scope)
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DashboardGateway } from './gateway/dashboard.gateway';
import { ConnectionRegistry } from './gateway/connection-registry';
import { WsJwtVerifier } from './auth/ws-jwt.verifier';
import { OrgScopeResolver } from './auth/org-scope.resolver';
import { PubSubSubscriber } from './redis/pubsub.subscriber';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
  ],
  controllers: [HealthController],
  providers: [
    DashboardGateway,
    ConnectionRegistry,
    WsJwtVerifier,
    OrgScopeResolver,
    PubSubSubscriber,
  ],
})
export class AppModule {}
