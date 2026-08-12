'use client';

/**
 * ProfilePanel — editable organization profile form.
 *
 * Covers: name, tier, region, domain.
 * Sends pessimistic update with version field for optimistic-concurrency.
 * 409 responses surface a non-destructive conflict banner.
 * 400 details[] mapped to per-field messages by fieldKey.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Organization } from '../../lib/api/organizations/types';
import { useUpdateOrganization } from '../../lib/api/organizations/hooks';

interface ProfilePanelProps {
  org: Organization;
  canWrite: boolean;
}

const TIER_OPTIONS = ['free', 'starter', 'growth', 'enterprise'] as const;

export function ProfilePanel({ org, canWrite }: ProfilePanelProps) {
  const updateMutation = useUpdateOrganization(org.id);

  const [form, setForm] = useState({
    name: org.name,
    tier: org.tier,
    region: org.region ?? '',
    domain: org.domain ?? '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflictDetected, setConflictDetected] = useState(false);

  // Sync if org changes externally
  useEffect(() => {
    setForm({
      name: org.name,
      tier: org.tier,
      region: org.region ?? '',
      domain: org.domain ?? '',
    });
    setConflictDetected(false);
  }, [org.id, org.name, org.tier, org.region, org.domain]);

  const handleChange = useCallback(
    (field: string, value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      setFieldErrors((prev) => { const next = { ...prev }; delete next[field]; return next; });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setFieldErrors({});
    setConflictDetected(false);

    try {
      await updateMutation.mutateAsync({
        version: org.version,
        name: form.name || undefined,
        tier: form.tier || undefined,
        region: form.region || null,
        domain: form.domain || null,
      });
    } catch (err: unknown) {
      const e = err as { status?: number; details?: Array<{ fieldKey?: string; message?: string }> };
      if (e.status === 409) {
        setConflictDetected(true);
        return;
      }
      if (e.status === 400 && Array.isArray(e.details)) {
        const errs: Record<string, string> = {};
        e.details.forEach((d) => {
          if (d.fieldKey) errs[d.fieldKey] = d.message ?? 'Invalid value';
        });
        setFieldErrors(errs);
      }
    }
  }, [form, org.version, updateMutation]);

  const inputStyle = (field: string): React.CSSProperties => ({
    width: '100%',
    padding: '7px 10px',
    borderRadius: 6,
    border: `1px solid ${fieldErrors[field] ? '#f87171' : 'var(--color-border, #d1d5db)'}`,
    fontSize: 13,
    background: !canWrite ? 'var(--color-bg-alt, #f9fafb)' : 'var(--color-bg-card, #fff)',
    color: 'var(--color-fg-primary, #111827)',
    boxSizing: 'border-box',
    outline: 'none',
  });

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--color-fg-secondary, #374151)',
    marginBottom: 4,
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void handleSave(); }}
      aria-label="Organization profile"
      noValidate
    >
      {conflictDetected && (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 6,
            background: '#fef3c7',
            border: '1px solid #fbbf24',
            fontSize: 13,
            color: '#92400e',
          }}
        >
          <strong>Conflict detected.</strong> Another administrator updated this
          organization while you were editing.{' '}
          <button
            type="button"
            onClick={() => setConflictDetected(false)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#1d4ed8',
              textDecoration: 'underline',
              fontSize: 13,
            }}
          >
            Reload to merge
          </button>
          {' '}(your edits are preserved in this form).
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Name */}
        <div>
          <label htmlFor="profile-name" style={labelStyle}>
            Name <span aria-hidden="true" style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            id="profile-name"
            type="text"
            value={form.name}
            onChange={(e) => handleChange('name', e.target.value)}
            disabled={!canWrite}
            required
            aria-invalid={Boolean(fieldErrors['name'])}
            aria-describedby={fieldErrors['name'] ? 'profile-name-error' : undefined}
            style={inputStyle('name')}
          />
          {fieldErrors['name'] && (
            <p id="profile-name-error" role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>
              {fieldErrors['name']}
            </p>
          )}
        </div>

        {/* Tier */}
        <div>
          <label htmlFor="profile-tier" style={labelStyle}>Tier</label>
          <select
            id="profile-tier"
            value={form.tier}
            onChange={(e) => handleChange('tier', e.target.value)}
            disabled={!canWrite}
            aria-invalid={Boolean(fieldErrors['tier'])}
            style={{ ...inputStyle('tier'), cursor: !canWrite ? 'default' : 'pointer' }}
          >
            {TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
          {fieldErrors['tier'] && (
            <p role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>
              {fieldErrors['tier']}
            </p>
          )}
        </div>

        {/* Region */}
        <div>
          <label htmlFor="profile-region" style={labelStyle}>Region</label>
          <input
            id="profile-region"
            type="text"
            value={form.region}
            onChange={(e) => handleChange('region', e.target.value)}
            disabled={!canWrite}
            placeholder="e.g. us-east, eu-west"
            style={inputStyle('region')}
          />
        </div>

        {/* Domain */}
        <div>
          <label htmlFor="profile-domain" style={labelStyle}>Primary domain</label>
          <input
            id="profile-domain"
            type="text"
            value={form.domain}
            onChange={(e) => handleChange('domain', e.target.value)}
            disabled={!canWrite}
            placeholder="e.g. acme.example.com"
            style={inputStyle('domain')}
          />
          {fieldErrors['domain'] && (
            <p role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>
              {fieldErrors['domain']}
            </p>
          )}
        </div>
      </div>

      {canWrite && (
        <div style={{ marginTop: 20, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="submit"
            disabled={updateMutation.isPending}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--color-primary, #4f46e5)',
              color: '#fff',
              cursor: updateMutation.isPending ? 'wait' : 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {updateMutation.isPending ? 'Saving…' : 'Save profile'}
          </button>
          {updateMutation.isSuccess && (
            <span style={{ fontSize: 13, color: '#065f46' }}>✓ Saved</span>
          )}
        </div>
      )}

      {!canWrite && (
        <p
          role="note"
          style={{
            marginTop: 16,
            fontSize: 12,
            color: 'var(--color-muted, #6b7280)',
            padding: '8px 12px',
            background: 'var(--color-bg-alt, #f9fafb)',
            borderRadius: 6,
          }}
        >
          You need administrator permissions to edit organization profiles.
        </p>
      )}
    </form>
  );
}
