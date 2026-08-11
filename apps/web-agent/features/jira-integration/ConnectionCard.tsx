'use client';

/**
 * ConnectionCard — shows site URL, cloud id, auth method, scopes, token
 * expiry with warning (<7 days), connection state pill, and Test / Reconnect
 * actions (WO-058).
 *
 * Permission gating: write actions are hidden when canWrite=false (UX only;
 * server enforces jira:manage).
 */

import React, { useState } from 'react';
import type { JiraHealthConnectionInfo } from '../../lib/api/jira/types';
import { useTestConnection, useRotateWebhookSecret } from '../../lib/api/jira/hooks';

const STATE_PILL: Record<string, { label: string; bg: string; fg: string }> = {
  active:   { label: 'Active',   bg: '#f0fdf4', fg: '#16a34a' },
  degraded: { label: 'Degraded', bg: '#fffbeb', fg: '#d97706' },
  pending:  { label: 'Pending',  bg: '#f0f9ff', fg: '#0284c7' },
  revoked:  { label: 'Revoked',  bg: '#fef2f2', fg: '#dc2626' },
};

const TOKEN_WARNING_DAYS = 7;

interface Props {
  connection: JiraHealthConnectionInfo;
  canWrite: boolean;
  onReconnect: (connectionId: string) => void;
}

export function ConnectionCard({ connection, canWrite, onReconnect }: Props) {
  const [testResult, setTestResult] = useState<{ reachable: boolean; latencyMs?: number; error?: string | null } | null>(null);
  const [testing, setTesting] = useState(false);

  const testMutation = useTestConnection();

  const tokenExpiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt) : null;
  const daysUntilExpiry = tokenExpiresAt
    ? Math.ceil((tokenExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const tokenNearExpiry = daysUntilExpiry !== null && daysUntilExpiry <= TOKEN_WARNING_DAYS;
  const tokenExpired = daysUntilExpiry !== null && daysUntilExpiry <= 0;

  const pill = STATE_PILL[connection.state] ?? STATE_PILL.pending;

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testMutation.mutateAsync(connection.id);
      setTestResult({ reachable: res.data.reachable, latencyMs: res.data.latencyMs, error: res.data.error });
    } catch (err) {
      setTestResult({ reachable: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <article
      aria-label={`Jira connection: ${connection.siteUrl}`}
      style={{
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: 8,
        background: 'var(--color-bg-card, #fff)',
        padding: '16px 20px',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <a
            href={connection.siteUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-fg-primary, #111827)', textDecoration: 'none' }}
          >
            {connection.siteUrl}
          </a>
          {connection.cloudId && (
            <div style={{ fontSize: 11, color: 'var(--color-fg-muted, #6b7280)', marginTop: 2 }}>
              Cloud ID: {connection.cloudId}
            </div>
          )}
        </div>

        {/* State pill */}
        <span
          role="status"
          aria-label={`Connection state: ${pill.label}`}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '3px 10px',
            borderRadius: 12,
            background: pill.bg,
            color: pill.fg,
          }}
        >
          {pill.label}
        </span>
      </div>

      {/* Reconnect banner for degraded/revoked */}
      {(connection.state === 'degraded' || connection.state === 'revoked') && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: '10px 14px',
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: 6,
            fontSize: 13,
            color: '#dc2626',
          }}
        >
          {connection.state === 'revoked'
            ? 'This connection was revoked. Reconnect to restore Jira sync.'
            : 'Connection is degraded — authentication may have expired. Test and reconnect if needed.'}
          {canWrite && (
            <button
              type="button"
              onClick={() => onReconnect(connection.id)}
              aria-label="Reconnect this Jira connection"
              style={{
                marginLeft: 12,
                padding: '4px 12px',
                background: '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: 5,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reconnect
            </button>
          )}
        </div>
      )}

      {/* Details */}
      <dl style={{ margin: '12px 0 0', display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', fontSize: 13 }}>
        <dt style={{ color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>Auth method</dt>
        <dd style={{ margin: 0, color: 'var(--color-fg-primary, #111827)' }}>
          {connection.authMethod === 'oauth3lo' ? 'OAuth 2.0 (3LO)' : 'API Token'}
        </dd>

        <dt style={{ color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>Scopes</dt>
        <dd style={{ margin: 0, color: 'var(--color-fg-primary, #111827)' }}>
          {connection.scopes.length > 0 ? connection.scopes.join(', ') : '—'}
        </dd>

        <dt style={{ color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>Token expires</dt>
        <dd style={{ margin: 0 }}>
          {tokenExpiresAt ? (
            <span
              aria-label={tokenExpired ? 'Token expired' : tokenNearExpiry ? `Token expires in ${daysUntilExpiry} days — renew soon` : undefined}
              style={{
                color: tokenExpired ? '#dc2626' : tokenNearExpiry ? '#d97706' : 'var(--color-fg-primary, #111827)',
                fontWeight: (tokenExpired || tokenNearExpiry) ? 600 : 400,
              }}
            >
              {tokenExpiresAt.toLocaleDateString()}
              {tokenExpired && ' ⚠ Expired'}
              {!tokenExpired && tokenNearExpiry && ` ⚠ Expires in ${daysUntilExpiry}d`}
            </span>
          ) : (
            <span style={{ color: 'var(--color-fg-muted, #6b7280)' }}>—</span>
          )}
        </dd>
      </dl>

      {/* Test result */}
      {testResult && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 10,
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 13,
            background: testResult.reachable ? '#f0fdf4' : '#fef2f2',
            color: testResult.reachable ? '#16a34a' : '#dc2626',
            border: `1px solid ${testResult.reachable ? '#86efac' : '#fca5a5'}`,
          }}
        >
          {testResult.reachable
            ? `✓ Connection OK — ${testResult.latencyMs}ms`
            : `✗ Connection failed: ${testResult.error ?? 'Unknown error'}`}
        </div>
      )}

      {/* Actions */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          aria-label="Test this Jira connection"
          style={{
            padding: '6px 14px',
            borderRadius: 5,
            border: '1px solid var(--color-border, #e5e7eb)',
            background: 'var(--color-bg-page, #f9fafb)',
            color: 'var(--color-fg-primary, #111827)',
            fontSize: 13,
            fontWeight: 500,
            cursor: testing ? 'not-allowed' : 'pointer',
            opacity: testing ? 0.6 : 1,
          }}
        >
          {testing ? 'Testing…' : 'Test Connection'}
        </button>

        {canWrite && connection.state !== 'active' && (
          <button
            type="button"
            onClick={() => onReconnect(connection.id)}
            aria-label="Reconnect this Jira connection"
            style={{
              padding: '6px 14px',
              borderRadius: 5,
              border: 'none',
              background: 'var(--color-primary, #4f46e5)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reconnect
          </button>
        )}
      </div>
    </article>
  );
}
