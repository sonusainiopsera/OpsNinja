import { Module } from '@nestjs/common';

/**
 * Views module — domain seam for saved view management, filter compilation,
 * and query caching.
 *
 * Currently empty; domain logic will be added in subsequent work orders.
 *
 * Boundary rule: Must NOT import repository or schema files from any other
 * domain module (enforced by eslint-plugin-boundaries).
 */
@Module({})
export class ViewsModule {}
