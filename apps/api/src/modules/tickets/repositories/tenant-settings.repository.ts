import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { tenantSettings, type TenantSettings } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';

@Injectable()
export class TenantSettingsRepository extends TenantRepository {
  async findByTenantId(tenantId: string): Promise<TenantSettings | null> {
    const rows = await this.tx
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1);
    return rows[0] ?? null;
  }
}
