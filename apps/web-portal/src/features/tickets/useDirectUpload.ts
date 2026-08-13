'use client';

/**
 * useDirectUpload — React hook for direct-to-storage attachment upload flow.
 *
 * Implements the three-phase pre-ticket attachment pipeline (WO-089):
 *   1. presign  — POST /api/v1/portal/attachments/presign
 *                 → { attachmentId, upload: { url, fields }, expiresAt, maxBytes }
 *   2. upload   — POST to S3 presigned URL using FormData
 *                 (fields appended first, file last, Content-Type NOT set manually)
 *   3. confirm  — POST /api/v1/portal/attachments/{id}/confirm
 *                 → { attachmentId, displayName, detectedContentType, sizeBytes }
 *
 * Security notes:
 *   - Content-Type is never set manually — the browser supplies the multipart boundary.
 *   - Client-side size/type checks are UX hints only; the server is authoritative.
 *   - Pre-signed fields are appended before the file as required by S3.
 *
 * Usage:
 *   const { files, addFiles, removeFile, uploadAll, isUploading } = useDirectUpload();
 */

import { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadStatus =
  | 'idle'
  | 'presigning'
  | 'uploading'
  | 'confirming'
  | 'confirmed'
  | 'rejected'
  | 'error';

export interface UploadFile {
  /** Browser File object */
  file:          File;
  /** Unique local key for UI rendering */
  localKey:      string;
  status:        UploadStatus;
  /** Progress 0–100 during upload phase */
  progress:      number;
  /** Filled after confirm phase succeeds */
  attachmentId?: string;
  /** Human-readable rejection or error message */
  errorMessage?: string;
  /** Retry counter (max 2 automatic retries on transient failures) */
  retries:       number;
}

export interface PresignResponse {
  data: {
    attachmentId: string;
    upload: {
      url:    string;
      fields: Record<string, string>;
    };
    expiresAt: string;
    maxBytes:  number;
  };
  traceId: string;
}

export interface ConfirmResponse {
  data: {
    attachmentId:         string;
    displayName:          string;
    detectedContentType:  string;
    sizeBytes:            number;
    status:               'confirmed';
  };
  traceId: string;
}

// Client-side UX hints only — server enforces these authoratively.
const CLIENT_MAX_BYTES       = 25 * 1024 * 1024; // 25 MB
const CLIENT_ALLOWED_TYPES   = new Set([
  'image/png', 'image/jpeg', 'application/pdf',
  'text/plain', 'application/zip', 'application/gzip',
  'text/csv', 'application/json',
]);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDirectUpload() {
  const [files, setFiles] = useState<UploadFile[]>([]);

  const updateFile = useCallback(
    (localKey: string, patch: Partial<UploadFile>) => {
      setFiles((prev) =>
        prev.map((f) => (f.localKey === localKey ? { ...f, ...patch } : f)),
      );
    },
    [],
  );

  /**
   * Add files to the upload queue with client-side UX hint validation.
   * Files exceeding the size limit or with an unrecognised type are marked
   * as 'rejected' immediately with a descriptive message.
   */
  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const arr = Array.from(incoming);
      const newEntries: UploadFile[] = arr.map((file) => {
        const localKey = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
        // Client-side size hint (UX only)
        if (file.size > CLIENT_MAX_BYTES) {
          return {
            file, localKey, status: 'rejected', progress: 0, retries: 0,
            errorMessage: `File exceeds the 25 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`,
          };
        }
        // Client-side type hint (UX only)
        if (file.type && !CLIENT_ALLOWED_TYPES.has(file.type)) {
          return {
            file, localKey, status: 'rejected', progress: 0, retries: 0,
            errorMessage: `File type '${file.type}' is not on the allow list.`,
          };
        }
        return { file, localKey, status: 'idle', progress: 0, retries: 0 };
      });
      setFiles((prev) => [...prev, ...newEntries]);
    },
    [],
  );

  /** Remove a file from the queue (only allowed when not in progress). */
  const removeFile = useCallback(
    (localKey: string) => {
      setFiles((prev) =>
        prev.filter(
          (f) => f.localKey !== localKey || f.status === 'uploading' || f.status === 'presigning',
        ),
      );
    },
    [],
  );

  /**
   * Upload a single file through the three-phase pipeline.
   * Returns the confirmed attachmentId on success, or null on failure.
   */
  const uploadOne = useCallback(
    async (entry: UploadFile): Promise<string | null> => {
      const { file, localKey } = entry;

      // ── Phase 1: Presign ─────────────────────────────────────────────────
      updateFile(localKey, { status: 'presigning', progress: 0 });

      let presignData: PresignResponse['data'];
      try {
        const presignRes = await fetch('/api/v1/portal/attachments/presign', {
          method:      'POST',
          credentials: 'include',
          headers:     { 'Content-Type': 'application/json' },
          body:        JSON.stringify({
            fileName:            file.name,
            declaredContentType: file.type || 'application/octet-stream',
            sizeBytes:           file.size,
          }),
        });
        if (!presignRes.ok) {
          const body = await presignRes.json().catch(() => null) as { error?: { message?: string } } | null;
          updateFile(localKey, {
            status:       'error',
            errorMessage: body?.error?.message ?? 'Failed to prepare upload. Please retry.',
          });
          return null;
        }
        const json = await presignRes.json() as PresignResponse;
        presignData = json.data;
      } catch {
        updateFile(localKey, {
          status:       'error',
          errorMessage: 'Network error during presign. Please retry.',
        });
        return null;
      }

      // ── Phase 2: Direct upload to S3 via presigned POST ──────────────────
      updateFile(localKey, { status: 'uploading', progress: 5 });

      try {
        // Build FormData: presigned fields FIRST, file LAST.
        // Content-Type is NOT set manually — browser provides the multipart boundary.
        const formData = new FormData();
        for (const [key, value] of Object.entries(presignData.upload.fields)) {
          formData.append(key, value);
        }
        // File must be last
        formData.append('file', file);

        await uploadWithProgress(presignData.upload.url, formData, (pct) => {
          updateFile(localKey, { progress: Math.min(5 + Math.floor(pct * 0.9), 95) });
        });
      } catch (err) {
        const msg = (err as Error).message ?? 'Upload to storage failed. Please retry.';
        updateFile(localKey, { status: 'error', errorMessage: msg });
        return null;
      }

      updateFile(localKey, { progress: 97 });

      // ── Phase 3: Confirm — magic-byte verification ───────────────────────
      updateFile(localKey, { status: 'confirming', progress: 97 });

      try {
        const confirmRes = await fetch(
          `/api/v1/portal/attachments/${presignData.attachmentId}/confirm`,
          { method: 'POST', credentials: 'include' },
        );
        const confirmBody = await confirmRes.json() as ConfirmResponse | { error?: { code?: string; message?: string } };

        if (!confirmRes.ok) {
          const errBody = confirmBody as { error?: { code?: string; message?: string } };
          updateFile(localKey, {
            status:       'rejected',
            errorMessage: errBody.error?.message ?? 'File type was rejected by the server.',
          });
          return null;
        }

        const confirmed = confirmBody as ConfirmResponse;
        updateFile(localKey, {
          status:       'confirmed',
          progress:     100,
          attachmentId: confirmed.data.attachmentId,
        });
        return confirmed.data.attachmentId;
      } catch {
        updateFile(localKey, {
          status:       'error',
          errorMessage: 'Storage service temporarily unavailable. Please retry.',
        });
        return null;
      }
    },
    [updateFile],
  );

  /**
   * Upload all idle files in parallel.
   * Returns the list of confirmed attachment IDs (in submission order).
   */
  const uploadAll = useCallback(async (): Promise<string[]> => {
    const idle = files.filter((f) => f.status === 'idle');
    const results = await Promise.all(idle.map((f) => uploadOne(f)));
    return results.filter((id): id is string => id !== null);
  }, [files, uploadOne]);

  /**
   * Retry a single failed/rejected upload (resets to idle).
   */
  const retryFile = useCallback(
    async (localKey: string): Promise<string | null> => {
      const entry = files.find((f) => f.localKey === localKey);
      if (!entry || entry.retries >= 2) return null;

      updateFile(localKey, {
        status:       'idle',
        progress:     0,
        errorMessage: undefined,
        retries:      entry.retries + 1,
      });

      // Re-fetch current entry after state update — use a closure snapshot
      const fresh: UploadFile = { ...entry, status: 'idle', progress: 0, retries: entry.retries + 1 };
      return uploadOne(fresh);
    },
    [files, updateFile, uploadOne],
  );

  const isUploading = files.some(
    (f) => f.status === 'presigning' || f.status === 'uploading' || f.status === 'confirming',
  );

  const confirmedIds = files
    .filter((f) => f.status === 'confirmed' && f.attachmentId)
    .map((f) => f.attachmentId as string);

  return {
    files,
    addFiles,
    removeFile,
    uploadAll,
    retryFile,
    isUploading,
    confirmedIds,
  };
}

// ---------------------------------------------------------------------------
// XHR upload with progress reporting
// ---------------------------------------------------------------------------

function uploadWithProgress(
  url:        string,
  body:       FormData,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        // S3 returns XML errors — surface a generic message
        reject(new Error(
          xhr.status === 400
            ? 'Upload rejected: file may be oversize or the presigned policy has expired.'
            : `Storage returned HTTP ${xhr.status}. Please retry.`,
        ));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload to storage.'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload was cancelled.'));
    });

    xhr.send(body);
  });
}
