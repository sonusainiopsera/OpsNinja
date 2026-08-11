'use client';

/**
 * AttachmentUploader — WO-042.
 *
 * Per-file upload state machine:
 *   idle → presigning → uploading (with progress) → finalizing → done
 *                                                              → failed(reason)
 *
 * Each file is independently retryable.  Upload errors are surfaced per-file
 * with a specific, non-technical reason (oversized, wrong type, server error).
 * No file failure blocks other files.
 */

import React, { useCallback, useReducer, useRef } from 'react';

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type UploadPhase =
  | 'idle'
  | 'presigning'
  | 'uploading'
  | 'finalizing'
  | 'done'
  | 'failed';

export interface FileUploadState {
  id: string;          // local temp id
  file: File;
  phase: UploadPhase;
  progress: number;    // 0–100
  error: string | null;
  attachmentId: string | null;  // set when done
  downloadUrl: string | null;
}

type UploadAction =
  | { type: 'ADD_FILES'; files: File[] }
  | { type: 'PRESIGNING'; id: string }
  | { type: 'UPLOADING'; id: string }
  | { type: 'PROGRESS'; id: string; progress: number }
  | { type: 'FINALIZING'; id: string }
  | { type: 'DONE'; id: string; attachmentId: string; downloadUrl: string }
  | { type: 'FAILED'; id: string; error: string }
  | { type: 'RETRY'; id: string }
  | { type: 'REMOVE'; id: string };

function uploadReducer(state: FileUploadState[], action: UploadAction): FileUploadState[] {
  switch (action.type) {
    case 'ADD_FILES':
      return [
        ...state,
        ...action.files.map((file, i) => ({
          id: `upload-${Date.now()}-${i}`,
          file,
          phase: 'idle' as UploadPhase,
          progress: 0,
          error: null,
          attachmentId: null,
          downloadUrl: null,
        })),
      ];

    case 'PRESIGNING':
      return state.map((f) => f.id === action.id ? { ...f, phase: 'presigning', error: null } : f);

    case 'UPLOADING':
      return state.map((f) => f.id === action.id ? { ...f, phase: 'uploading', progress: 0 } : f);

    case 'PROGRESS':
      return state.map((f) => f.id === action.id ? { ...f, progress: action.progress } : f);

    case 'FINALIZING':
      return state.map((f) => f.id === action.id ? { ...f, phase: 'finalizing', progress: 100 } : f);

    case 'DONE':
      return state.map((f) =>
        f.id === action.id
          ? { ...f, phase: 'done', attachmentId: action.attachmentId, downloadUrl: action.downloadUrl, progress: 100 }
          : f,
      );

    case 'FAILED':
      return state.map((f) => f.id === action.id ? { ...f, phase: 'failed', error: action.error } : f);

    case 'RETRY':
      return state.map((f) => f.id === action.id ? { ...f, phase: 'idle', error: null, progress: 0 } : f);

    case 'REMOVE':
      return state.filter((f) => f.id !== action.id);

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf',
  'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
  'application/json',
  'video/mp4', 'video/webm',
]);

function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clientValidate(file: File): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File is too large (${humanFileSize(file.size)}). Maximum allowed size is ${humanFileSize(MAX_FILE_SIZE_BYTES)}.`;
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return `File type "${file.type || 'unknown'}" is not allowed. Accepted: images, PDF, Office documents, CSV, ZIP.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Upload execution
// ---------------------------------------------------------------------------

interface UploadHandlers {
  onPresign: (filename: string, contentType: string, sizeBytes: number) => Promise<{
    uploadId: string;
    uploadUrl: string;
    fields: Record<string, string>;
  }>;
  onFinalize: (uploadId: string, filename: string, contentType: string, sizeBytes: number) => Promise<{
    attachmentId: string;
    downloadUrl: string;
  }>;
}

async function executeUpload(
  item: FileUploadState,
  dispatch: React.Dispatch<UploadAction>,
  handlers: UploadHandlers,
): Promise<void> {
  const { id, file } = item;

  // Client-side validation first
  const clientError = clientValidate(file);
  if (clientError) {
    dispatch({ type: 'FAILED', id, error: clientError });
    return;
  }

  try {
    // 1. Presign
    dispatch({ type: 'PRESIGNING', id });
    const { uploadId, uploadUrl, fields } = await handlers.onPresign(
      file.name, file.type, file.size,
    );

    // 2. Direct upload with progress
    dispatch({ type: 'UPLOADING', id });
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          dispatch({ type: 'PROGRESS', id, progress: Math.round((e.loaded / e.total) * 90) });
        }
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed with status ${xhr.status}`));
      });
      xhr.addEventListener('error', () => reject(new Error('Network error during upload')));

      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);
      xhr.open('POST', uploadUrl);
      xhr.send(formData);
    });

    // 3. Finalize
    dispatch({ type: 'FINALIZING', id });
    const { attachmentId, downloadUrl } = await handlers.onFinalize(
      uploadId, file.name, file.type, file.size,
    );

    dispatch({ type: 'DONE', id, attachmentId, downloadUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.';
    dispatch({ type: 'FAILED', id, error: msg });
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AttachmentUploaderProps {
  onPresign: UploadHandlers['onPresign'];
  onFinalize: UploadHandlers['onFinalize'];
  /** Called with the array of ready attachment IDs for composer inclusion. */
  onAttachmentsReady?: (ids: string[]) => void;
}

export function AttachmentUploader({
  onPresign,
  onFinalize,
  onAttachmentsReady,
}: AttachmentUploaderProps) {
  const [files, dispatch] = useReducer(uploadReducer, []);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (selected: FileList | null) => {
      if (!selected || selected.length === 0) return;
      const newFiles = Array.from(selected);
      dispatch({ type: 'ADD_FILES', files: newFiles });

      // Kick off uploads for each new file
      newFiles.forEach((file, i) => {
        const tempId = `upload-${Date.now()}-${i}`;
        const fakeItem: FileUploadState = {
          id: tempId,
          file,
          phase: 'idle',
          progress: 0,
          error: null,
          attachmentId: null,
          downloadUrl: null,
        };
        void executeUpload(fakeItem, dispatch, { onPresign, onFinalize });
      });
    },
    [onPresign, onFinalize],
  );

  // Notify parent when new attachments complete
  React.useEffect(() => {
    const doneIds = files
      .filter((f) => f.phase === 'done' && f.attachmentId)
      .map((f) => f.attachmentId!);
    onAttachmentsReady?.(doneIds);
  }, [files, onAttachmentsReady]);

  const doneCount = files.filter((f) => f.phase === 'done').length;

  return (
    <section aria-label="Attachments">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#374151', margin: 0 }}>
          Attachments {doneCount > 0 ? `(${doneCount})` : ''}
        </h3>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          style={{
            fontSize: 12,
            padding: '4px 10px',
            borderRadius: 4,
            border: '1px solid #d1d5db',
            background: '#f9fafb',
            cursor: 'pointer',
          }}
        >
          + Add file
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={Array.from(ALLOWED_TYPES).join(',')}
          style={{ display: 'none' }}
          aria-hidden="true"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {files.length === 0 && (
        <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>No attachments yet.</p>
      )}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {files.map((f) => (
          <li
            key={f.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 0',
              borderBottom: '1px solid #f3f4f6',
              fontSize: 13,
            }}
          >
            {/* Status icon */}
            <span aria-hidden="true">
              {f.phase === 'done' && '✅'}
              {f.phase === 'failed' && '❌'}
              {(f.phase === 'presigning' || f.phase === 'uploading' || f.phase === 'finalizing') && '⏳'}
              {f.phase === 'idle' && '📄'}
            </span>

            {/* Filename */}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f.phase === 'done' && f.downloadUrl
                ? <a href={f.downloadUrl} style={{ color: '#2563eb' }}>{f.file.name}</a>
                : f.file.name}
            </span>

            {/* Size */}
            <span style={{ color: '#9ca3af', flexShrink: 0 }}>{humanFileSize(f.file.size)}</span>

            {/* Progress bar */}
            {(f.phase === 'uploading' || f.phase === 'finalizing') && (
              <div
                style={{ width: 60, height: 4, background: '#e5e7eb', borderRadius: 2, flexShrink: 0 }}
                role="progressbar"
                aria-valuenow={f.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Uploading ${f.file.name}`}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${f.progress}%`,
                    background: '#2563eb',
                    borderRadius: 2,
                    transition: 'width 0.2s',
                  }}
                />
              </div>
            )}

            {/* Error message */}
            {f.phase === 'failed' && f.error && (
              <span style={{ color: '#dc2626', fontSize: 12, flex: 2 }} role="alert">
                {f.error}
              </span>
            )}

            {/* Retry */}
            {f.phase === 'failed' && (
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: 'RETRY', id: f.id });
                  void executeUpload({ ...f, phase: 'idle', error: null }, dispatch, { onPresign, onFinalize });
                }}
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid #d1d5db',
                  cursor: 'pointer',
                  background: '#fff',
                  flexShrink: 0,
                }}
              >
                Retry
              </button>
            )}

            {/* Remove */}
            <button
              type="button"
              onClick={() => dispatch({ type: 'REMOVE', id: f.id })}
              aria-label={`Remove ${f.file.name}`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#9ca3af',
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Export state type for tests
export type { FileUploadState, UploadAction };
export { uploadReducer };
