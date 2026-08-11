import { Controller, Get } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { EVENT_CATALOGUE } from './event-catalogue';

@Controller('webhooks/event-types')
export class EventCatalogueController {
  @Get()
  @RequirePermission('webhook:read', 'webhook:manage')
  list() {
    return { data: EVENT_CATALOGUE };
  }
}
