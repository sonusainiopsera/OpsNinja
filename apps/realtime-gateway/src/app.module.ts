import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { JwtVerifier } from './auth/jwt-verifier';
import { ConnectionRegistry } from './gateway/connection-registry';
import { DashboardGateway } from './gateway/dashboard.gateway';
import { HeartbeatService } from './gateway/heartbeat.service';
import { PubSubSubscriber } from './redis/pubsub.subscriber';
import { HealthController } from './health/health.controller';

export const COMMAND_REDIS = 'COMMAND_REDIS';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  controllers: [HealthController],
  providers: [
    JwtVerifier,
    ConnectionRegistry,
    DashboardGateway,
    PubSubSubscriber,
    // Separate command Redis client (pub/sub client is in PubSubSubscriber)
    {
      provide: COMMAND_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        return new Redis(config.get<string>('REDIS_URL', 'redis://localhost:6379'), {
          lazyConnect: true,
          maxRetriesPerRequest: 3,
          enableReadyCheck: false,
          retryStrategy: (times: number) => Math.min(times * 200, 10_000),
        });
      },
    },
    // HeartbeatService needs the command Redis (not pub/sub)
    {
      provide: HeartbeatService,
      inject: [ConfigService, ConnectionRegistry, COMMAND_REDIS],
      useFactory: (config: ConfigService, registry: ConnectionRegistry, redis: Redis) =>
        new HeartbeatService(config, registry, redis),
    },
    // DashboardGateway needs the command Redis for scope-version checks
    {
      provide: DashboardGateway,
      inject: [ConfigService, JwtVerifier, ConnectionRegistry, HeartbeatService, COMMAND_REDIS],
      useFactory: (
        config: ConfigService,
        jwtVerifier: JwtVerifier,
        registry: ConnectionRegistry,
        heartbeat: HeartbeatService,
        redis: Redis,
      ) => new DashboardGateway(config, jwtVerifier, registry, heartbeat, redis),
    },
  ],
  exports: [DashboardGateway, ConnectionRegistry],
})
export class AppModule {}
