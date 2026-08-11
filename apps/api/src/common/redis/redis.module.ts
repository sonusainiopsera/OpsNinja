import { Global, Module } from '@nestjs/common';
import { redisProvider, REDIS_CLIENT } from './redis.provider';

/**
 * Global Redis module — imported once in AppModule.
 * Exports REDIS_CLIENT so any feature module can inject it.
 */
@Global()
@Module({
  providers: [redisProvider],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
