import { Module } from '@nestjs/common';
import { SavedViewService } from './saved-view.service';
import { ViewsService } from './views.service';
import { ViewsController } from './views.controller';
import { ViewsRepository } from './views.repository';
import { SystemViewsSeeder } from './system-views.seed';

@Module({
  controllers: [ViewsController],
  providers: [SavedViewService, ViewsService, ViewsRepository, SystemViewsSeeder],
  exports: [SavedViewService, ViewsService, ViewsRepository, SystemViewsSeeder],
})
export class ViewsModule {}
