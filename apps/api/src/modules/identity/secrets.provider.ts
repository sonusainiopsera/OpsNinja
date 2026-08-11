/**
 * SecretsProvider port — resolves secret material at runtime from a secrets
 * manager (e.g. AWS Secrets Manager). The concrete implementation is injected;
 * tests use InMemorySecretsProvider.
 *
 * Security invariants:
 *   - getSecret() returns the raw secret string; callers must not log it.
 *   - Secrets must never appear in error messages or response bodies.
 */

export class SecretsError extends Error {
  constructor(
    message: string,
    public readonly ref?: string,
  ) {
    super(message);
    this.name = 'SecretsError';
  }
}

export interface SecretsProvider {
  /**
   * Resolves a secret by its reference path (e.g. 'opsninja/tenant-a/oidc-secret').
   * Throws SecretsError when the reference cannot be resolved.
   */
  getSecret(ref: string): Promise<string>;
}

/**
 * In-memory implementation for tests and local development.
 * Populated at construction time with a static map of ref → value.
 */
export class InMemorySecretsProvider implements SecretsProvider {
  private readonly map: Map<string, string>;

  constructor(secrets: Record<string, string> = {}) {
    this.map = new Map(Object.entries(secrets));
  }

  async getSecret(ref: string): Promise<string> {
    const val = this.map.get(ref);
    if (val === undefined) {
      throw new SecretsError(`Secret not found: ${ref}`, ref);
    }
    return val;
  }

  /** Adds or updates a secret (for test setup). */
  set(ref: string, value: string): void {
    this.map.set(ref, value);
  }
}
