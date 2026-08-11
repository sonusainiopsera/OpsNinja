/**
 * ObjectStorePort — abstract interface for object storage operations.
 *
 * Injected into AttachmentsService; unit tests use InMemoryObjectStore,
 * production uses S3ObjectStore. No implementation detail leaks into callers.
 *
 * All methods are tenant-agnostic at this layer; tenant scoping is enforced
 * by the key naming convention enforced in AttachmentsService (keys always
 * begin with `tenants/{tenantId}/`).
 */

export const OBJECT_STORE_PORT = 'OBJECT_STORE_PORT';

export interface PresignPostResult {
  /** The S3 endpoint URL to POST the upload to. */
  url: string;
  /** Form fields that must be included as multipart/form-data fields. */
  fields: Record<string, string>;
  /** The exact key the client must upload to (matches the `key` field). */
  key: string;
}

export interface HeadObjectResult {
  /** True when the object exists in storage. */
  exists: boolean;
  /** Content-length reported by storage, or null when object absent. */
  contentLength: number | null;
}

export interface ObjectStorePort {
  /**
   * Generate a pre-signed POST policy allowing a client to upload an object
   * directly to S3 (or compatible storage).
   *
   * @param key         Server-generated storage key.
   * @param maxBytes    Maximum allowed object size in bytes.
   * @param expiresIn   Policy TTL in seconds (default 300 / 5 minutes).
   * @param kmsKeyId    KMS key alias/ARN for server-side encryption.
   */
  presignPost(
    key: string,
    maxBytes: number,
    expiresIn: number,
    kmsKeyId?: string,
  ): Promise<PresignPostResult>;

  /**
   * Generate a short-lived pre-signed GET URL for an existing object.
   *
   * @param key       Storage key.
   * @param expiresIn URL TTL in seconds.
   */
  presignGet(key: string, expiresIn: number): Promise<string>;

  /**
   * Check whether an object exists and return its size.
   * Never throws on missing object — returns { exists: false, contentLength: null }.
   */
  headObject(key: string): Promise<HeadObjectResult>;

  /**
   * Read a byte range from an object.
   * Used to read magic bytes during finalization.
   *
   * @param key   Storage key.
   * @param start Start byte offset (inclusive).
   * @param end   End byte offset (inclusive).
   * @returns     Buffer of the requested range, or null if the object is absent.
   */
  getRange(key: string, start: number, end: number): Promise<Buffer | null>;

  /**
   * Permanently delete an object.
   * Used to clean up after failed finalization or when an attachment is deleted.
   */
  deleteObject(key: string): Promise<void>;
}
