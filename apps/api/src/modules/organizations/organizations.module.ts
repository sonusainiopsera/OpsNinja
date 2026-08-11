import { Module } from '@nestjs/common';

/**
 * Organizations module — domain seam for tenant organisations, custom fields,
 * org-scoped configuration and verified domain management.
 *
 * Currently empty; domain logic will be added in subsequent work orders.
 *
 * Boundary rule: Must NOT import repository or schema files from any other
 * domain module (enforced by eslint-plugin-boundaries).
 */
@Module({})
export class OrganizationsModule {}
