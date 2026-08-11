import { Module } from '@nestjs/common';

/**
 * SLA module — domain seam for SLA policy management, timer creation,
 * breach calculation, and calendar-aware target computation.
 *
 * Currently empty; domain logic will be added in subsequent work orders.
 *
 * Boundary rule: Must NOT import repository or schema files from any other
 * domain module (enforced by eslint-plugin-boundaries).
 */
@Module({})
export class SlaModule {}
