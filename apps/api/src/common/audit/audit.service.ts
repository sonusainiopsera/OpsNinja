import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { auditLogs } from '@opsninja/db';
import type { DB } from '@opsninja/db';
import { DB_TOKEN } from '../../data/db.module';

export interface AuditDenialParams {
  tenantId?: string;
  actorId?: string;
  actorKind?: string;
  route: string;
  requiredPermission?: string;
  resourceId?: string;
  outcome: string;
  code: string;
  traceId: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB_TOKEN) private readonly db: DB) {}

  async recordAccessDenial(params: AuditDenialParams): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        id: randomUUID(),
        tenantId: params.tenantId ?? null,
        actorId: params.actorId ?? null,
        actorKind: params.actorKind ?? null,
        action: 'access_denied',
        resourceType: null,
        resourceId: params.resourceId ?? null,
        requiredPermission: params.requiredPermission ?? null,
        route: params.route,
        outcome: params.outcome,
        code: params.code,
        traceId: params.traceId,
        occurredAt: new Date(),
      });
    } catch (err) {
      // Audit write failure must not drop the denial — log operator alert and continue.
      this.logger.error('OPERATOR_ALERT: audit_log write failed for access denial', {
        params,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
