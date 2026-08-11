/**
 * DbModule – provides the Drizzle DB instance and UnitOfWork.
 *
 * Only this module (and files inside apps/api/src/data/**) may interact with
 * the raw pool.  Every other module receives a DrizzleHandle through
 * UnitOfWork.withTenantTransaction() or TenantRepository.
 */

import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDrizzle, createPool, DB } from '@opsninja/db';
import { UnitOfWork } from './unit-of-work';

export const DB_TOKEN = 'DRIZZLE_DB';

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService): DB => {
        const pool = createPool({
          host: config.get<string>('DB_HOST', 'localhost'),
          port: config.get<number>('DB_PORT', 5432),
          database: config.get<string>('DB_NAME', 'opsninja'),
          user: config.get<string>('DB_USER', 'opsninja'),
          password: config.get<string>('DB_PASSWORD', ''),
          max: config.get<number>('DB_POOL_MAX', 20),
        });
        return createDrizzle(pool);
      },
    },
    {
      provide: UnitOfWork,
      inject: [DB_TOKEN, ConfigService],
      useFactory: (db: DB, config: ConfigService) => new UnitOfWork(db, config),
    },
  ],
  exports: [DB_TOKEN, UnitOfWork],
})
export class DbModule {}
