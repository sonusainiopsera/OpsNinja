import { Controller, Get } from '@nestjs/common';
import { NoTenantContext } from '../common/tenant';

@NoTenantContext()
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  ready(): { status: string } {
    return { status: 'ready' };
  }
}
