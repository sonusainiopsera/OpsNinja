'use client';

/**
 * NewRequestForm — portal SPA ticket submission form (WO-089, AC-11).
 *
 * Renders:
 *   - Effective-request guidance checklist (AC-11)
 *   - Subject, description, category and priority fields
 *   - Drag-and-drop / click-to-add attachment uploader with per-file progress,
 *     retry and rejection messages (AC-11)
 *
 * Upload flow (AC-11):
 *   1. Client calls presign endpoint → gets presigned POST fields + URL.
 *   2. Client posts FormData to S3 with presigned fields first, file last.
 *      Content-Type is NEVER set manually; the browser supplies the boundary.
 *   3. Client calls confirm endpoint; server verifies magic bytes.
 *   4. Confirmed attachment IDs are included in the ticket creation request.
 *
 * Client-side size/type limits are UX hints only; the server is authoritative.
 *
 * On success the component calls onSuccess with the created ticket ID and
 * the caller can redirect to the ticket detail page.
 */

import React, { useCallback, useState } from 'react';
import { useDirectUpload, type UploadFile } from './useDirectUpload';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewRequestFormProps {
  onSuccess?: (ticketId: string, reference: string) => void;
}

interface Category {
  id:    string;
  label: string;
}

// Static category list — replace with API-fetched categories when available.
const CATEGORIES: Category[] = [
  { id: '', label: '— Select a category —' },
  { id: 'pipeline',      label: 'Pipeline / CI–CD' },
  { id: 'infrastructure', label: 'Infrastructure' },
  { id: 'monitoring',    label: 'Monitoring / Alerting' },
  { id: 'access',        label: 'Access / Permissions' },
  { id: 'deployment',    label: 'Deployment' },
  { id: 'other',         label: 'Other' },
];

const PRIORITIES = [
  { value: 'P1', label: 'P1 — Critical (system down)' },
  { value: 'P2', label: 'P2 — High (major feature broken)' },
  { value: 'P3', label: 'P3 — Medium (degraded service)' },
  { value: 'P4', label: 'P4 — Low (minor issue / question)' },
];

// Effective-request guidance checklist items.
const GUIDANCE_ITEMS = [
  'Describe the expected versus actual behaviour.',
  'Include the exact error message (copy–paste, not paraphrase).',
  'State when the issue first appeared and whether it is reproducible.',
  'Attach relevant logs, screenshots or pipeline output.',
  'List any recent changes that may be related.',
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function GuidanceChecklist() {
  const [checked, setChecked] = useState<Record<number, boolean>>({});

  const toggle = (i: number) =>
    setChecked((prev) => ({ ...prev, [i]: !prev[i] }));

  return (
    <fieldset
      style={{
        border: '1px solid var(--portal-border, #d1d5db)',
        borderRadius: 6,
        padding: '12px 16px',
        marginBottom: 20,
      }}
    >
      <legend
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--portal-fg-muted, #6b7280)',
          padding: '0 4px',
        }}
      >
        Before you submit — tick what you have included
      </legend>
      {GUIDANCE_ITEMS.map((item, i) => (
        <label
          key={i}
          style={{
            display:    'flex',
            alignItems: 'flex-start',
            gap:        8,
            marginTop:  8,
            cursor:     'pointer',
            fontSize:   14,
          }}
        >
          <input
            type="checkbox"
            checked={!!checked[i]}
            onChange={() => toggle(i)}
            style={{ marginTop: 2, flexShrink: 0 }}
          />
          <span style={{ color: checked[i] ? 'var(--portal-fg, #111827)' : 'var(--portal-fg-muted, #6b7280)' }}>
            {item}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function FileStatusBadge({ status }: { status: UploadFile['status'] }) {
  const MAP: Record<UploadFile['status'], { label: string; color: string }> = {
    idle:       { label: 'Queued',     color: '#6b7280' },
    presigning: { label: 'Preparing…', color: '#2563eb' },
    uploading:  { label: 'Uploading…', color: '#2563eb' },
    confirming: { label: 'Verifying…', color: '#2563eb' },
    confirmed:  { label: 'Ready',      color: '#16a34a' },
    rejected:   { label: 'Rejected',   color: '#dc2626' },
    error:      { label: 'Error',      color: '#dc2626' },
  };
  const { label, color } = MAP[status];
  return (
    <span
      style={{
        fontSize:     11,
        fontWeight:   600,
        color,
        background:   `${color}18`,
        borderRadius: 4,
        padding:      '1px 6px',
      }}
    >
      {label}
    </span>
  );
}

function AttachmentRow({
  entry,
  onRemove,
  onRetry,
}: {
  entry:    UploadFile;
  onRemove: () => void;
  onRetry:  () => void;
}) {
  const canRemove = entry.status !== 'uploading' && entry.status !== 'presigning';
  const canRetry  = (entry.status === 'error' || entry.status === 'rejected') && entry.retries < 2;

  return (
    <li
      style={{
        display:        'flex',
        alignItems:     'center',
        gap:            10,
        padding:        '8px 0',
        borderBottom:   '1px solid var(--portal-border-muted, #e5e7eb)',
        listStyle:      'none',
      }}
    >
      <span style={{ flex: 1, fontSize: 13, wordBreak: 'break-all' }}>
        {entry.file.name}
        <span style={{ marginLeft: 6, color: 'var(--portal-fg-muted, #6b7280)', fontSize: 12 }}>
          ({(entry.file.size / 1024).toFixed(0)} KB)
        </span>
      </span>

      <FileStatusBadge status={entry.status} />

      {(entry.status === 'uploading' || entry.status === 'presigning' || entry.status === 'confirming') && (
        <div
          role="progressbar"
          aria-valuenow={entry.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            width:        80,
            height:       6,
            background:   '#e5e7eb',
            borderRadius: 3,
            overflow:     'hidden',
            flexShrink:   0,
          }}
        >
          <div
            style={{
              height:     '100%',
              width:      `${entry.progress}%`,
              background: '#2563eb',
              transition: 'width 0.2s',
            }}
          />
        </div>
      )}

      {entry.errorMessage && (
        <span
          role="alert"
          style={{ fontSize: 11, color: '#dc2626', maxWidth: 200, wordBreak: 'break-word' }}
        >
          {entry.errorMessage}
        </span>
      )}

      {canRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            fontSize:    12,
            color:       '#2563eb',
            background:  'none',
            border:      'none',
            cursor:      'pointer',
            padding:     '2px 6px',
            flexShrink:  0,
          }}
        >
          Retry
        </button>
      )}

      {canRemove && (
        <button
          type="button"
          aria-label={`Remove ${entry.file.name}`}
          onClick={onRemove}
          style={{
            fontSize:    16,
            color:       'var(--portal-fg-muted, #9ca3af)',
            background:  'none',
            border:      'none',
            cursor:      'pointer',
            lineHeight:  1,
            flexShrink:  0,
          }}
        >
          ×
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------

export default function NewRequestForm({ onSuccess }: NewRequestFormProps) {
  const [subject,     setSubject]     = useState('');
  const [description, setDescription] = useState('');
  const [categoryId,  setCategoryId]  = useState('');
  const [priority,    setPriority]    = useState<'P1' | 'P2' | 'P3' | 'P4'>('P3');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError]   = useState<string | null>(null);
  const [isDragOver, setIsDragOver]     = useState(false);

  const { files, addFiles, removeFile, uploadAll, retryFile, isUploading, confirmedIds } =
    useDirectUpload();

  // ── Drag-and-drop handlers ───────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        // Reset so the same file can be re-added after removal
        e.target.value = '';
      }
    },
    [addFiles],
  );

  // ── Form submission ──────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitError(null);

      if (!subject.trim()) {
        setSubmitError('Subject is required.');
        return;
      }
      if (!description.trim()) {
        setSubmitError('Description is required.');
        return;
      }

      setIsSubmitting(true);

      try {
        // Upload any queued idle files first
        const freshIds = await uploadAll();
        const allConfirmedIds = [
          ...confirmedIds.filter((id) => !freshIds.includes(id)),
          ...freshIds,
        ];

        const res = await fetch('/api/v1/portal/tickets', {
          method:      'POST',
          credentials: 'include',
          headers:     { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject:           subject.trim(),
            description:       description.trim(),
            categoryId:        categoryId || undefined,
            requestedPriority: priority,
            attachmentIds:     allConfirmedIds,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null) as {
            error?: { code?: string; message?: string };
          } | null;
          const msg = body?.error?.message ?? `Submission failed (HTTP ${res.status}). Please retry.`;
          setSubmitError(msg);
          return;
        }

        const json = await res.json() as { data: { id: string; reference: string } };
        onSuccess?.(json.data.id, json.data.reference);
      } catch {
        setSubmitError('Network error. Please check your connection and retry.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [subject, description, categoryId, priority, uploadAll, confirmedIds, onSuccess],
  );

  const hasIdleFiles = files.some((f) => f.status === 'idle');
  const isBusy       = isSubmitting || isUploading;

  return (
    <form
      onSubmit={handleSubmit}
      style={{ maxWidth: 720 }}
      aria-label="New support request"
      noValidate
    >
      {/* Effective-request guidance checklist */}
      <GuidanceChecklist />

      {/* Subject */}
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="nr-subject" style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 14 }}>
          Subject <span aria-hidden="true" style={{ color: '#dc2626' }}>*</span>
        </label>
        <input
          id="nr-subject"
          type="text"
          required
          maxLength={200}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={isBusy}
          placeholder="e.g. Jenkins pipeline failing on merge to main"
          aria-describedby="nr-subject-hint"
          style={{
            width:        '100%',
            padding:      '8px 10px',
            fontSize:     14,
            border:       '1px solid var(--portal-border, #d1d5db)',
            borderRadius: 6,
            boxSizing:    'border-box',
          }}
        />
        <span id="nr-subject-hint" style={{ fontSize: 12, color: 'var(--portal-fg-muted, #6b7280)' }}>
          {subject.length}/200
        </span>
      </div>

      {/* Description */}
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="nr-description" style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 14 }}>
          Description <span aria-hidden="true" style={{ color: '#dc2626' }}>*</span>
        </label>
        <textarea
          id="nr-description"
          required
          rows={6}
          maxLength={20_000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isBusy}
          placeholder="Include the expected vs actual behaviour, error messages, and reproduction steps…"
          style={{
            width:        '100%',
            padding:      '8px 10px',
            fontSize:     14,
            border:       '1px solid var(--portal-border, #d1d5db)',
            borderRadius: 6,
            resize:       'vertical',
            boxSizing:    'border-box',
          }}
        />
        <span style={{ fontSize: 12, color: 'var(--portal-fg-muted, #6b7280)' }}>
          {description.length}/20 000
        </span>
      </div>

      {/* Category */}
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="nr-category" style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 14 }}>
          Category
        </label>
        <select
          id="nr-category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          disabled={isBusy}
          style={{
            width:        '100%',
            padding:      '8px 10px',
            fontSize:     14,
            border:       '1px solid var(--portal-border, #d1d5db)',
            borderRadius: 6,
            background:   'white',
          }}
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* Requested Priority */}
      <div style={{ marginBottom: 20 }}>
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
            Requested Priority
          </legend>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {PRIORITIES.map((p) => (
              <label
                key={p.value}
                style={{
                  display:      'flex',
                  alignItems:   'center',
                  gap:          6,
                  fontSize:     14,
                  cursor:       isBusy ? 'not-allowed' : 'pointer',
                  opacity:      isBusy ? 0.6 : 1,
                }}
              >
                <input
                  type="radio"
                  name="requestedPriority"
                  value={p.value}
                  checked={priority === p.value}
                  onChange={() => setPriority(p.value as typeof priority)}
                  disabled={isBusy}
                />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {/* Attachment uploader */}
      <div style={{ marginBottom: 20 }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
          Attachments
          <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--portal-fg-muted, #6b7280)', marginLeft: 8 }}>
            Max 25 MB per file · PNG, JPEG, PDF, text, log, ZIP
          </span>
        </span>

        {/* Drop zone */}
        <div
          role="region"
          aria-label="File drop zone"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            border:       `2px dashed ${isDragOver ? '#2563eb' : 'var(--portal-border, #d1d5db)'}`,
            borderRadius: 8,
            padding:      '24px 16px',
            textAlign:    'center',
            background:   isDragOver ? '#eff6ff' : 'transparent',
            cursor:       'pointer',
            transition:   'background 0.15s, border-color 0.15s',
          }}
        >
          <p style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--portal-fg-muted, #6b7280)' }}>
            Drag files here or{' '}
            <label
              htmlFor="nr-file-input"
              style={{ color: '#2563eb', cursor: 'pointer', textDecoration: 'underline' }}
            >
              browse to upload
            </label>
          </p>
          <input
            id="nr-file-input"
            type="file"
            multiple
            onChange={handleFileInput}
            disabled={isBusy}
            aria-label="Add attachments"
            style={{ display: 'none' }}
            accept=".png,.jpg,.jpeg,.pdf,.txt,.log,.csv,.zip,.gz,.json,.yaml"
          />
          <p style={{ margin: 0, fontSize: 12, color: 'var(--portal-fg-muted, #9ca3af)' }}>
            Max 10 files · 25 MB each
          </p>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <ul
            aria-label="Attachment list"
            style={{ margin: '12px 0 0', padding: 0 }}
          >
            {files.map((entry) => (
              <AttachmentRow
                key={entry.localKey}
                entry={entry}
                onRemove={() => removeFile(entry.localKey)}
                onRetry={() => retryFile(entry.localKey)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Submit error */}
      {submitError && (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding:      '10px 14px',
            background:   '#fef2f2',
            border:       '1px solid #fca5a5',
            borderRadius: 6,
            fontSize:     14,
            color:        '#b91c1c',
          }}
        >
          {submitError}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          type="submit"
          disabled={isBusy}
          style={{
            padding:      '10px 24px',
            fontSize:     14,
            fontWeight:   600,
            color:        'white',
            background:   isBusy ? '#93c5fd' : '#2563eb',
            border:       'none',
            borderRadius: 6,
            cursor:       isBusy ? 'not-allowed' : 'pointer',
          }}
        >
          {isUploading
            ? 'Uploading…'
            : isSubmitting
              ? 'Submitting…'
              : hasIdleFiles
                ? 'Upload & Submit'
                : 'Submit Request'}
        </button>

        {isBusy && (
          <span style={{ fontSize: 13, color: 'var(--portal-fg-muted, #6b7280)' }}>
            {isUploading ? 'Uploading attachments…' : 'Creating your ticket…'}
          </span>
        )}
      </div>
    </form>
  );
}
