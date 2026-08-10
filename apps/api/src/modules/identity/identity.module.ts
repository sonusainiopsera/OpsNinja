import { Module } from '@nestjs/common';

/**
 * Identity module — domain seam for user identity, authentication context,
 * and principal resolution.
 *
 * Currently empty; controllers, services, and repositories will be added
 * in subsequent work orders (WO-002 Auth / WO-003 Identity).
 *
 * Boundary rule: Must NOT import repository or schema files from any other
 * domain module (enforced by eslint-plugin-boundaries).
 */
@Module({})
export class IdentityModule {}
