import { Module } from '@nestjs/common';

import { ViewsController } from './views.controller';
import { ViewsService } from './views.service';
import { ViewsRepository } from './views.repository';

@Module({
  controllers: [ViewsController],
  providers: [ViewsService, ViewsRepository],
  exports: [ViewsService],
})
export class ViewsModule {}
