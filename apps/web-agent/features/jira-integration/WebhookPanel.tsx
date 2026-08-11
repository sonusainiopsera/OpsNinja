'use client';

/**
 * WebhookPanel — receiver health, last event, signature failures, copyable URL,
 * and rotate-secret action with 10-minute overlap window explanation (WO-058).
 *
 * Security: the one-time secret value is shown ONLY immediately after rotation.
 * It is never stored in component state after dismissal.
 */

import React, { useState, useRef } from 'react';
import type { JiraHealthWebhookInfo } from '../../lib/api/jira/types';
import { useRotateWebhookSecret } from '../../lib/api/jira/hooks';

interface Props {
  webhook: JiraHealthWebhookInfo | undefined;
  connectionId: string | null;
  webhookUrl: string | null;
  canWrite: boolean;
  stale?: boolean;
  onAuditConfirmed?: (auditId: string) => void;
}

interface SecretReveal {
  secretOnce: string;
  webhookUrl: string;
  previousValidUntil: string;
}

export function WebhookPanel({ webhook, connectionId, webhookUrl, canWrite, stale, onAuditConfirmed }: Props) {
  const [secretReveal, setSecretReveal] = useState<SecretReveal | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const secretInputRef = useRef<HTMLInputElement>(null);

  const rotateMutation = useRotateWebhookSecret();

  async function handleRotate() {
    if (!connectionId) return;
    setConfirmRotate(false);
    try {
      const res = await rotateMutation.mutateAsync(connectionId);
      setSecretReveal({
        secretOnce: res.secretOnce,
        webhookUrl: res.webhookUrl,
        previousValidUntil: res.previousValidUntil,
      });
    } catch { /* error displayed below */ }
  }

  function handleCopySecret() {
    if (secretReveal) {
      void navigator.clipboard.writeText(secretReveal.secretOnce).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      });
    }
  }

  function handleDismissSecret() {
    setSecretReveal(null);
    setCopied(false);
  }

  function handleCopyUrl() {
    const url = webhookUrl ?? secretReveal?.webhookUrl;
    if (url) {
      void navigator.clipboard.writeText(url);
    }
  }

  const displayUrl = webhookUrl ?? secretReveal?.webhookUrl ?? null;

  return (
    <section aria-label="Webhook receiver panel" style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-fg-primary, #111827)', margin: '0 0 12px' }}>
        Webhook Receiver
      </h2>

      {/* Receiver health + last event */}
      <div style={{
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: 8,
        background: 'var(--color-bg-card, #fff)',
        padding: '14px 18px',
      }}>
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', fontSize: 13, margin: 0 }}>
          <dt style={{ color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>Status</dt>
          <dd style={{ margin: 0 }}>
            <span
              role="status"
              aria-label={`Receiver ${webhook?.receiverHealthy ? 'healthy' : 'unhealthy'}`}
              style={{
                fontWeight: 600,
                color: webhook?.receiverHealthy ? '#16a34a' : '#dc2626',
              }}
            >
              {webhook === undefined ? '…' : webhook.receiverHealthy ? '✓ Healthy' : '✗ Unhealthy'}
            </span>
            {stale && (
              <span style={{ marginLeft: 8, fontSize: 11, color: '#d97706' }}>⚠ Stale</span>
            )}
          </dd>

          <dt style={{ color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>Last event</dt>
          <dd style={{ margin: 0, color: 'var(--color-fg-primary, #111827)' }}>
            {webhook?.lastReceivedAt
              ? new Date(webhook.lastReceivedAt).toLocaleString()
              : <span style={{ color: 'var(--color-fg-muted, #6b7280)' }}>None received</span>}
          </dd>

          <dt style={{ color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>Sig. failures (24h)</dt>
          <dd style={{ margin: 0 }}>
            <span style={{ color: (webhook?.signatureFailures24h ?? 0) > 0 ? '#dc2626' : 'var(--color-fg-primary, #111827)', fontWeight: (webhook?.signatureFailures24h ?? 0) > 0 ? 600 : 400 }}>
              {webhook?.signatureFailures24h ?? '—'}
            </span>
          </dd>

          {displayUrl && (
            <>
              <dt style={{ color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>Webhook URL</dt>
              <dd style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <code
                  style={{
                    fontSize: 11,
                    background: 'var(--color-bg-page, #f9fafb)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    overflowWrap: 'anywhere',
                    color: 'var(--color-fg-primary, #111827)',
                  }}
                >
                  {displayUrl}
                </code>
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  aria-label="Copy webhook URL"
                  style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--color-border, #e5e7eb)', cursor: 'pointer', background: 'transparent' }}
                >
                  Copy
                </button>
              </dd>
            </>
          )}
        </dl>

        {/* Rotate secret */}
        {canWrite && (
          <div style={{ marginTop: 14 }}>
            {!confirmRotate ? (
              <button
                type="button"
                onClick={() => setConfirmRotate(true)}
                disabled={!connectionId || rotateMutation.isPending}
                aria-label="Rotate webhook signing secret"
                style={{
                  padding: '6px 14px',
                  borderRadius: 5,
                  border: '1px solid var(--color-border, #e5e7eb)',
                  background: 'var(--color-bg-page, #f9fafb)',
                  color: 'var(--color-fg-primary, #111827)',
                  fontSize: 13,
                  cursor: !connectionId ? 'not-allowed' : 'pointer',
                  opacity: !connectionId ? 0.5 : 1,
                }}
              >
                Rotate Signing Secret
              </button>
            ) : (
              <div role="dialog" aria-label="Confirm rotate webhook secret" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: '#d97706', fontWeight: 500 }}>
                  ⚠ This will issue a new secret. The previous secret remains valid for 10 minutes.
                </span>
                <button
                  type="button"
                  onClick={() => void handleRotate()}
                  disabled={rotateMutation.isPending}
                  style={{ padding: '5px 12px', borderRadius: 5, border: 'none', background: '#dc2626', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  {rotateMutation.isPending ? 'Rotating…' : 'Confirm Rotate'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRotate(false)}
                  style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid var(--color-border, #e5e7eb)', background: 'transparent', fontSize: 13, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            )}

            {rotateMutation.isError && (
              <div role="alert" style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>
                Rotation failed: {rotateMutation.error.message}
              </div>
            )}
          </div>
        )}

        {/* One-time secret reveal */}
        {secretReveal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="New webhook signing secret"
            style={{
              marginTop: 14,
              padding: '14px 16px',
              background: '#fffbeb',
              border: '1px solid #d97706',
              borderRadius: 8,
            }}
          >
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: '#92400e' }}>
              ⚠ Copy this secret now — it will not be shown again.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input
                ref={secretInputRef}
                type="text"
                readOnly
                value={secretReveal.secretOnce}
                aria-label="New webhook signing secret"
                onFocus={(e) => e.target.select()}
                style={{
                  flex: 1,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  padding: '6px 10px',
                  borderRadius: 5,
                  border: '1px solid #d97706',
                  background: '#fff',
                  color: '#111827',
                }}
              />
              <button
                type="button"
                onClick={handleCopySecret}
                aria-label="Copy new signing secret"
                style={{
                  padding: '6px 12px',
                  borderRadius: 5,
                  border: 'none',
                  background: copied ? '#16a34a' : '#d97706',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: '#92400e' }}>
              Previous secret valid until: {new Date(secretReveal.previousValidUntil).toLocaleTimeString()} (10-minute overlap)
            </p>
            <button
              type="button"
              onClick={handleDismissSecret}
              aria-label="Dismiss secret reveal"
              style={{ fontSize: 12, color: '#6b7280', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              I have copied it — dismiss
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
