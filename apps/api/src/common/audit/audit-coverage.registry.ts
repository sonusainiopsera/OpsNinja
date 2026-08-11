/**
 * AuditCoverageRegistry – collects @Auditable declarations at module-load time.
 *
 * The CI guard test (test/audit/audit-coverage.spec.ts) reads this registry
 * and asserts that every known write-capable method has an entry.
 *
 * The registry is a singleton (module-level Map) so it persists across the
 * lifetime of the Node process.
 */

import type { AuditableOptions } from './auditable.decorator';

export interface AuditRegistryEntry {
  /** Class name of the repository or service (e.g. 'TicketRepository'). */
  className: string;
  /** Method name (e.g. 'createTicket'). */
  methodName: string;
  /** Options supplied to @Auditable. */
  options: AuditableOptions;
}

class Registry {
  private readonly _entries = new Map<string, AuditRegistryEntry>();

  /** Called by @Auditable at decoration time (module load). */
  register(entry: AuditRegistryEntry): void {
    const key = `${entry.className}.${entry.methodName}`;
    this._entries.set(key, entry);
  }

  /** Returns all registered entries. */
  all(): ReadonlyArray<AuditRegistryEntry> {
    return Array.from(this._entries.values());
  }

  /** Returns the entry for a specific class+method pair, or undefined. */
  get(className: string, methodName: string): AuditRegistryEntry | undefined {
    return this._entries.get(`${className}.${methodName}`);
  }

  /** Returns true when the class+method pair has an @Auditable declaration. */
  has(className: string, methodName: string): boolean {
    return this._entries.has(`${className}.${methodName}`);
  }

  /** Clears all entries. Only used by test harnesses. */
  _reset(): void {
    this._entries.clear();
  }
}

export const AuditCoverageRegistry = new Registry();
