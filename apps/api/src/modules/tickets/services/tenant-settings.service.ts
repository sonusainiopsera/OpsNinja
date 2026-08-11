import { Injectable } from '@nestjs/common';
import { eq, tenantSettings } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';

@Injectable()
export class TenantSettingsService extends TenantRepository {
  /**
   * Returns whether AI summaries may be shown to portal users for the given tenant.
   * Defaults to false when no settings row exists (closed by default).
   */
  async isCustomerAiSummaryEnabled(tenantId: string): Promise<boolean> {
    const rows = await this.db
      .select({ customerVisibleAiSummary: tenantSettings.customerVisibleAiSummary })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId));
    return rows[0]?.customerVisibleAiSummary ?? false;
  }
}
