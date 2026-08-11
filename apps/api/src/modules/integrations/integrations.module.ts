import { Module } from '@nestjs/common';

/**
 * Integrations module — domain seam for Jira configuration, webhook receiver,
 * OAuth 2.0 token management, and integration administration.
 *
 * Currently empty; domain logic will be added in subsequent work orders.
 *
 * Boundary rule: Must NOT import repository or schema files from any other
 * domain module (enforced by eslint-plugin-boundaries).
 */
@Module({})
export class IntegrationsModule {}
