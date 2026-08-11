/**
 * StubTicketsController – test-only stub endpoint used exclusively by the
 * tenant-isolation e2e suite.
 *
 * This controller intentionally queries the tickets table WITHOUT any
 * application-level tenant predicate.  It relies entirely on PostgreSQL RLS
 * policies (set via the app.current_tenant session variable) to enforce
 * tenant isolation.  This proves RLS is effective rather than testing
 * application-level WHERE clauses.
 *
 * This controller is registered in StubModule, which is imported only in the
 * test application factory (never in AppModule / production).
 */

import { Controller, Get } from '@nestjs/common';
import { RequestContextStore } from '../observability/request-context';
import { tickets } from '@opsninja/db';

@Controller('_stub/tickets')
export class StubTicketsController {
  @Get()
  async listAll(): Promise<{ rows: unknown[]; tenantId: string }> {
    const tx = RequestContextStore.getTx();
    const rows = await tx.select().from(tickets);

    return {
      rows,
      tenantId: RequestContextStore.getPrincipal().tenantId,
    };
  }
}
