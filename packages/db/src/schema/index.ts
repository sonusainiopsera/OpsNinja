/**
 * Schema index — re-exports all schema modules so module ownership is visible
 * from import paths and tree-shaking works correctly.
 *
 * Import pattern:
 *   import { tickets, tenants } from '@opsninja/db/schema';
 */

export * from './tenants.js';
export * from './organizations.js';
export * from './identity.js';
export * from './rbac.js';
export * from './sessions.js';
export * from './categories.js';
export * from './tickets.js';
export * from './audit.js';
export * from './outbox.js';
