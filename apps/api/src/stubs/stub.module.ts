/**
 * StubModule – contains test-only controllers that expose raw RLS behaviour
 * without application-level tenant predicates.
 *
 * NEVER import this module in AppModule.  It is wired in only via the test
 * application factory:
 *
 * ```typescript
 * const moduleRef = await Test.createTestingModule({
 *   imports: [AppModule, StubModule],
 * }).compile();
 * ```
 */

import { Module } from '@nestjs/common';
import { StubTicketsController } from './stub-tickets.controller';

@Module({
  controllers: [StubTicketsController],
})
export class StubModule {}
