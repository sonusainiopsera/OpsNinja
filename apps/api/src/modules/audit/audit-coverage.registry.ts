/**
 * AuditCoverageRegistry — collects @Auditable metadata from all decorated methods.
 *
 * Populated at module bootstrap. The CI guard test enumerates write-capable
 * methods and asserts each one is registered here.
 *
 * Singleton pattern: the registry instance is created once and shared across
 * the application. NestJS providers call register() in their constructor if
 * they carry @Auditable methods.
 */

import { AuditableMetadata, AUDITABLE_METADATA_KEY } from './auditable.decorator';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

class AuditCoverageRegistryClass {
  private readonly entries = new Map<string, AuditableMetadata>();

  /**
   * Scan a class prototype for @Auditable methods and register them.
   * Called automatically by @AuditableClass or manually in module init.
   */
  registerClass(prototype: object): void {
    const names = Object.getOwnPropertyNames(prototype);
    for (const name of names) {
      if (name === 'constructor') continue;
      const meta = Reflect.getMetadata(
        AUDITABLE_METADATA_KEY,
        prototype,
        name,
      ) as AuditableMetadata | undefined;
      if (meta) {
        const key = `${(prototype as { constructor: { name: string } }).constructor.name}.${name}`;
        this.entries.set(key, meta);
      }
    }
  }

  /** Register a single @Auditable method entry. */
  register(key: string, metadata: AuditableMetadata): void {
    this.entries.set(key, metadata);
  }

  /** Returns all registered entries as an array. */
  getAll(): AuditableMetadata[] {
    return Array.from(this.entries.values());
  }

  /** Returns all registered entry keys (`ClassName.methodName`). */
  getKeys(): string[] {
    return Array.from(this.entries.keys());
  }

  /** Look up a specific entry by class + method name. */
  get(className: string, methodName: string): AuditableMetadata | undefined {
    return this.entries.get(`${className}.${methodName}`);
  }

  /** Total number of registered @Auditable methods. */
  get size(): number {
    return this.entries.size;
  }
}

export const AuditCoverageRegistry = new AuditCoverageRegistryClass();
