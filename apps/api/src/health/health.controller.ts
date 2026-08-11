/**
 * Health-check controller — exempt from tenant context.
 *
 * Load balancers and uptime monitors call GET /health repeatedly.
 * This endpoint must not open a database transaction on every probe.
 */

import { Controller, Get } from '@nestjs/common';
import { NoTenantContext } from '../common/tenant/no-tenant-context.decorator';

@NoTenantContext()
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
