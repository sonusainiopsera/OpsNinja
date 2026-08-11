/**
 * Shared not-found masking helper.
 *
 * Out-of-scope resources and genuinely non-existent resources both raise the
 * same NotFoundException so an agent cannot enumerate which organization or
 * ticket IDs exist outside their scope (existence-disclosure control).
 *
 * Usage in handlers:
 *   const ticket = await repo.findById(id);
 *   assertFound(ticket, 'Ticket');
 *
 * Usage in scope checks:
 *   assertFound(inScope, 'Ticket');  // throws 404 if not in scope
 */

import { NotFoundException } from '@nestjs/common';
import { ErrorCode } from './app-errors';

/**
 * Throws 404 RESOURCE_NOT_FOUND if the value is null, undefined or false.
 * The message intentionally omits the resource id to avoid leaking identifiers
 * in responses that may be logged by clients.
 */
export function assertFound<T>(
  value: T | null | undefined | false,
  resourceLabel = 'Resource',
): asserts value is T {
  if (value === null || value === undefined || value === false) {
    throw new NotFoundException({
      code: ErrorCode.RESOURCE_NOT_FOUND,
      message: `${resourceLabel} not found.`,
    });
  }
}

/**
 * Returns a NotFoundException with the standard envelope.
 * Use when you need the error object but do not want to throw immediately.
 */
export function notFoundError(resourceLabel = 'Resource'): NotFoundException {
  return new NotFoundException({
    code: ErrorCode.RESOURCE_NOT_FOUND,
    message: `${resourceLabel} not found.`,
  });
}
