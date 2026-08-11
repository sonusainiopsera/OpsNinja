/**
 * Not-found masking helper.
 *
 * Out-of-scope resources and genuinely missing resources must produce identical
 * 404 responses so an agent cannot enumerate the existence of organizations or
 * tickets outside their scope (existence-disclosure control).
 *
 * Usage:
 *   const ticket = await ticketRepo.findById(id);
 *   maskNotFound(ticket, 'ticket');
 *   // ticket is narrowed to non-null beyond this point
 */

import { NotFoundException } from '@nestjs/common';

/**
 * Throws a 404 NotFoundException with a stable envelope when value is null or
 * undefined. The message deliberately does not distinguish "not found" from
 * "out of scope" so responses are identical for both cases.
 *
 * @param value       The value to check — returned as-is if non-null.
 * @param resourceType  Human-readable resource label for the error message.
 * @throws NotFoundException  404 RESOURCE_NOT_FOUND with standard envelope.
 */
export function maskNotFound<T>(
  value: T | null | undefined,
  resourceType: string,
): asserts value is T {
  if (value == null) {
    throw new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: `The requested ${resourceType} does not exist`,
    });
  }
}
