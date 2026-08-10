import { Module } from '@nestjs/common';

/**
 * Reporting module — domain seam for report builder, analytics queries,
 * CSV/PDF export pipeline, and AI summary aggregations.
 *
 * Currently empty; domain logic will be added in subsequent work orders.
 *
 * Boundary rule: Must NOT import repository or schema files from any other
 * domain module (enforced by eslint-plugin-boundaries).
 */
@Module({})
export class ReportingModule {}
