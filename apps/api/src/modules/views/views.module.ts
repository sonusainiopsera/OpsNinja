import { Module } from '@nestjs/common';

import { ViewsController } from './views.controller';
import { ViewsService } from './views.service';
import { ViewsRepository } from './views.repository';
import { ViewCountsService } from './view-counts.service';
import { RedisCacheService } from '../../infra/cache/redis-cache';

@Module({
  controllers: [ViewsController],
  providers: [ViewsService, ViewsRepository, ViewCountsService, RedisCacheService],
  exports: [ViewsService, ViewsRepository, ViewCountsService],
})
export class ViewsModule {}
