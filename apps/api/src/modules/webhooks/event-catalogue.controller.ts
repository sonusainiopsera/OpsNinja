import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/auth/require-permission.decorator';
import { EVENT_CATALOGUE } from './event-catalogue';

@Controller('api/v1/webhooks')
export class EventCatalogueController {
  @Get('event-types')
  @Public()
  getEventTypes() {
    return {
      data: EVENT_CATALOGUE.map((entry) => ({
        eventType: entry.eventType,
        description: entry.description,
        examplePayload: entry.examplePayload,
        dataClassification: entry.dataClassification,
      })),
    };
  }
}
