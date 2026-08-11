import { Module } from '@nestjs/common';
import { SavedViewService } from './saved-view.service';

@Module({
  providers: [SavedViewService],
  exports: [SavedViewService],
})
export class ViewsModule {}
