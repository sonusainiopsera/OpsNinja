import { Module } from '@nestjs/common';

/**
 * Tickets module — domain seam for ticket creation, management, categorisation,
 * comments, and the transactional outbox that feeds downstream workers.
 *
 * Currently empty; domain logic will be added in subsequent work orders.
 *
 * Boundary rule: Must NOT import repository or schema files from any other
 * domain module (enforced by eslint-plugin-boundaries).
 */
@Module({})
export class TicketsModule {}
