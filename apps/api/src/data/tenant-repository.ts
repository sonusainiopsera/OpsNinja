/**
 * TenantRepository – abstract base class for all repository implementations.
 *
 * Concrete repositories extend this class and use `this.db` to access the
 * request-scoped Drizzle transaction handle.  The handle is resolved lazily
 * from AsyncLocalStorage on every access, so it always reflects the active
 * transaction for the current async chain.
 *
 * A runtime assertion in the `db` getter throws TENANT_CONTEXT_MISSING when
 * a repository method is called outside a bound tenant transaction.  This
 * makes the error surface loudly during development rather than silently
 * returning zero rows.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class TicketRepository extends TenantRepository {
 *   async findAll() {
 *     return this.db.select().from(schema.tickets);
 *   }
 * }
 * ```
 */

import { Logger } from '@nestjs/common';
import { DrizzleHandle } from '@opsninja/db';
import { RequestContextStore, TenantContextMissingError } from '../observability/request-context';

export abstract class TenantRepository {
  protected readonly logger = new Logger(this.constructor.name);

  /**
   * Returns the Drizzle transaction handle for the current request.
   *
   * @throws {TenantContextMissingError} when invoked outside a bound transaction.
   */
  protected get db(): DrizzleHandle {
    try {
      return RequestContextStore.getTx();
    } catch (err) {
      if (err instanceof TenantContextMissingError) {
        this.logger.error(
          `Repository ${this.constructor.name} was called outside a tenant transaction. ` +
            'This is a programming defect.',
          { code: err.code },
        );
      }
      throw err;
    }
  }
}
