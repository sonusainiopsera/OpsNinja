/**
 * Re-export the CredentialVaultPort interface and adapters from the api app's
 * credential-vault module so the receiver can share the same abstractions
 * without depending on NestJS modules from apps/api.
 *
 * The adapters are plain classes (no NestJS decorators) so re-exporting here is safe.
 */

// Inline minimal port so we have no cross-app path dependency.
export const CREDENTIAL_VAULT = Symbol('CREDENTIAL_VAULT');

export interface CredentialVaultPort {
  retrieve(secretRef: string, tenantId: string): Promise<string>;
  store(secretName: string, plaintext: string, tenantId: string): Promise<string>;
  delete(secretRef: string): Promise<void>;
}

// ── Minimal in-memory adapter for tests ──────────────────────────────────────

export class InMemoryVaultAdapter implements CredentialVaultPort {
  private readonly _store = new Map<string, string>();

  async store(secretName: string, plaintext: string): Promise<string> {
    this._store.set(secretName, plaintext);
    return secretName;
  }

  async retrieve(secretRef: string): Promise<string> {
    const val = this._store.get(secretRef);
    if (val === undefined) throw new Error(`Secret not found: ${secretRef}`);
    return val;
  }

  async delete(secretRef: string): Promise<void> {
    this._store.delete(secretRef);
  }

  /** Test helper: seed a secret directly. */
  seed(ref: string, value: string): void {
    this._store.set(ref, value);
  }
}
