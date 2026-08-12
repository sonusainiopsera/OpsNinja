'use client';

/**
 * OrganizationsPage — admin console page for the customer/organization registry.
 *
 * Layout:
 *   PageHeader (title, NewOrgButton, ImportButton)
 *   OrgFilters (tier, region, status, search) — synced to URL query string
 *   OrgTable — cursor-paginated, keyboard navigable
 *   OrgDetailDrawer — slide-over for the selected org
 *   DeactivateModal — confirmation-gated deactivation
 *   NewOrgModal — inline create form
 *
 * URL sync: filter state is serialised to the URL query string so views are
 * shareable and reload-safe (no history push on every keystroke — debounced).
 *
 * Permission gating: write controls disabled for non-admin roles.
 * The page reads permissions from the session principal and never relies
 * on client-side role checks alone (server enforces all writes).
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Organization, OrgListFilters, OrgTier, OrgStatus } from '../../lib/api/organizations/types';
import { OrgTable } from '../../app/(app)/organizations/components/OrgTable';
import { OrgDetailDrawer } from './OrgDetailDrawer';
import { DeactivateModal } from './DeactivateModal';
import { useCreateOrganization } from '../../lib/api/organizations/hooks';
import type { CreateOrgFormValues } from '../../lib/api/organizations/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFiltersFromUrl(): Omit<OrgListFilters, 'cursor'> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const filters: Omit<OrgListFilters, 'cursor'> = {};
  const tier = params.get('tier');
  const region = params.get('region');
  const status = params.get('status');
  const q = params.get('q');
  if (tier) filters.tier = tier as OrgTier;
  if (region) filters.region = region;
  if (status) filters.status = status as OrgStatus;
  if (q) filters.q = q;
  return filters;
}

function writeFiltersToUrl(filters: Omit<OrgListFilters, 'cursor'>) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  if (filters.tier) params.set('tier', filters.tier);
  if (filters.region) params.set('region', filters.region);
  if (filters.status) params.set('status', filters.status);
  if (filters.q) params.set('q', filters.q);
  const search = params.toString();
  const newUrl = search
    ? `${window.location.pathname}?${search}`
    : window.location.pathname;
  window.history.replaceState(null, '', newUrl);
}

// ---------------------------------------------------------------------------
// NewOrgModal — lightweight inline create form
// ---------------------------------------------------------------------------

interface NewOrgModalProps {
  onClose: () => void;
}

function NewOrgModal({ onClose }: NewOrgModalProps) {
  const createMutation = useCreateOrganization();
  const [form, setForm] = useState<CreateOrgFormValues>({
    name: '',
    tier: 'starter',
    region: undefined,
    domain: undefined,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    try {
      await createMutation.mutateAsync(form);
      onClose();
    } catch (err: unknown) {
      const e = err as { status?: number; details?: Array<{ fieldKey?: string; message?: string }> };
      if (e.status === 400 && Array.isArray(e.details)) {
        const errs: Record<string, string> = {};
        e.details.forEach((d) => { if (d.fieldKey) errs[d.fieldKey] = d.message ?? 'Invalid'; });
        setFieldErrors(errs);
      }
    }
  }, [form, createMutation, onClose]);

  const inputStyle = (field: string): React.CSSProperties => ({
    width: '100%',
    padding: '7px 10px',
    borderRadius: 6,
    border: `1px solid ${fieldErrors[field] ? '#f87171' : 'var(--color-border, #d1d5db)'}`,
    fontSize: 13,
    boxSizing: 'border-box',
    outline: 'none',
    background: 'var(--color-bg-card, #fff)',
  });

  return (
    <>
      <div aria-hidden="true" onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-org-title"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'var(--color-bg-card, #fff)',
          borderRadius: 10,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          zIndex: 201,
          width: 'min(460px, 95vw)',
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 id="new-org-title" style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Create organization
          </h2>
          <button type="button" aria-label="Close" onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--color-muted, #6b7280)' }}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label htmlFor="new-org-name" style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Name *
              </label>
              <input
                ref={inputRef}
                id="new-org-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                required
                aria-invalid={Boolean(fieldErrors['name'])}
                style={inputStyle('name')}
              />
              {fieldErrors['name'] && (
                <p role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>{fieldErrors['name']}</p>
              )}
            </div>

            <div>
              <label htmlFor="new-org-tier" style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Tier
              </label>
              <select
                id="new-org-tier"
                value={form.tier}
                onChange={(e) => setForm((p) => ({ ...p, tier: e.target.value as OrgTier }))}
                style={{ ...inputStyle('tier'), cursor: 'pointer' }}
              >
                <option value="free">Free</option>
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>

            <div>
              <label htmlFor="new-org-region" style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Region
              </label>
              <input
                id="new-org-region"
                type="text"
                value={form.region ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, region: e.target.value || undefined }))}
                placeholder="e.g. us-east, eu-west"
                style={inputStyle('region')}
              />
            </div>

            <div>
              <label htmlFor="new-org-domain" style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Primary domain
              </label>
              <input
                id="new-org-domain"
                type="text"
                value={form.domain ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, domain: e.target.value || undefined }))}
                placeholder="e.g. acme.example.com"
                style={inputStyle('domain')}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <button
              type="submit"
              disabled={createMutation.isPending}
              style={{
                flex: 1,
                padding: '9px 0',
                borderRadius: 6,
                border: 'none',
                background: 'var(--color-primary, #4f46e5)',
                color: '#fff',
                cursor: createMutation.isPending ? 'wait' : 'pointer',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              {createMutation.isPending ? 'Creating…' : 'Create organization'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '9px 20px',
                borderRadius: 6,
                border: '1px solid var(--color-border, #d1d5db)',
                background: 'var(--color-bg-card, #fff)',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// OrgFilters
// ---------------------------------------------------------------------------

interface OrgFiltersProps {
  filters: Omit<OrgListFilters, 'cursor'>;
  onChange: (filters: Omit<OrgListFilters, 'cursor'>) => void;
}

function OrgFilters({ filters, onChange }: OrgFiltersProps) {
  const [searchInput, setSearchInput] = useState(filters.q ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync search input debounced to avoid stale requests on each keystroke
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange({ ...filters, q: searchInput || undefined });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const hasActiveFilters = Boolean(filters.tier || filters.region || filters.status || filters.q);

  const selectStyle: React.CSSProperties = {
    padding: '7px 10px',
    borderRadius: 6,
    border: '1px solid var(--color-border, #d1d5db)',
    fontSize: 13,
    background: 'var(--color-bg-card, #fff)',
    color: 'var(--color-fg-secondary, #374151)',
    cursor: 'pointer',
    outline: 'none',
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
      role="search"
      aria-label="Filter organizations"
    >
      {/* Search */}
      <input
        type="search"
        placeholder="Search organizations…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        aria-label="Search organizations"
        style={{
          padding: '7px 12px',
          borderRadius: 6,
          border: '1px solid var(--color-border, #d1d5db)',
          fontSize: 13,
          width: 220,
          background: 'var(--color-bg-card, #fff)',
          outline: 'none',
        }}
      />

      {/* Tier filter */}
      <select
        aria-label="Filter by tier"
        value={filters.tier ?? ''}
        onChange={(e) => onChange({ ...filters, tier: (e.target.value as OrgTier) || undefined })}
        style={selectStyle}
      >
        <option value="">All tiers</option>
        <option value="free">Free</option>
        <option value="starter">Starter</option>
        <option value="growth">Growth</option>
        <option value="enterprise">Enterprise</option>
      </select>

      {/* Status filter */}
      <select
        aria-label="Filter by status"
        value={filters.status ?? ''}
        onChange={(e) => onChange({ ...filters, status: (e.target.value as OrgStatus) || undefined })}
        style={selectStyle}
      >
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="suspended">Suspended</option>
      </select>

      {/* Region filter */}
      <input
        type="text"
        placeholder="Region…"
        value={filters.region ?? ''}
        onChange={(e) => onChange({ ...filters, region: e.target.value || undefined })}
        aria-label="Filter by region"
        style={{
          padding: '7px 12px',
          borderRadius: 6,
          border: '1px solid var(--color-border, #d1d5db)',
          fontSize: 13,
          width: 120,
          background: 'var(--color-bg-card, #fff)',
          outline: 'none',
        }}
      />

      {/* Clear */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => {
            setSearchInput('');
            onChange({});
          }}
          style={{
            padding: '7px 12px',
            borderRadius: 6,
            border: '1px solid var(--color-border, #d1d5db)',
            background: 'var(--color-bg-card, #fff)',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--color-muted, #6b7280)',
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OrganizationsPage
// ---------------------------------------------------------------------------

interface OrganizationsPageProps {
  /** Whether the current user has admin write permissions. */
  canWrite?: boolean;
}

export function OrganizationsPage({ canWrite = false }: OrganizationsPageProps) {
  const [filters, setFilters] = useState<Omit<OrgListFilters, 'cursor'>>(
    () => readFiltersFromUrl(),
  );
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [deactivatingOrg, setDeactivatingOrg] = useState<Organization | null>(null);
  const [showNewOrgModal, setShowNewOrgModal] = useState(false);

  // Sync filters to URL
  useEffect(() => {
    writeFiltersToUrl(filters);
  }, [filters]);

  const handleFiltersChange = useCallback((next: Omit<OrgListFilters, 'cursor'>) => {
    setFilters(next);
  }, []);

  const handleSelectOrg = useCallback((org: Organization) => {
    setSelectedOrgId(org.id);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setSelectedOrgId(null);
  }, []);

  const handleDeactivate = useCallback((org: Organization) => {
    setDeactivatingOrg(org);
  }, []);

  const handleDeactivateSuccess = useCallback((_updated: Organization) => {
    setDeactivatingOrg(null);
  }, []);

  // Row-level reactivate: calls the API directly via fetch and invalidates
  // the list query. Avoids needing to thread a hook for an ad-hoc orgId.
  const qc = useQueryClient();
  const handleReactivate = useCallback(async (orgId: string) => {
    try {
      const res = await fetch(`/api/v1/organizations/${orgId}/reactivate`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        await qc.invalidateQueries({ queryKey: ['organizations'] });
      }
    } catch {
      // Non-blocking — table will refetch on next interaction
    }
  }, [qc]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-bg, #f9fafb)',
      }}
    >
      {/* Page header */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--color-border, #e5e7eb)',
          background: 'var(--color-bg-card, #fff)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--color-fg-primary, #111827)' }}>
            Organizations
          </h1>

          {canWrite && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setShowNewOrgModal(true)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--color-primary, #4f46e5)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                + New organization
              </button>
              <button
                type="button"
                disabled
                title="CSV import coming soon"
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px solid var(--color-border, #d1d5db)',
                  background: 'var(--color-bg-card, #fff)',
                  color: 'var(--color-muted, #9ca3af)',
                  cursor: 'not-allowed',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                Import
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div
        style={{
          padding: '12px 24px',
          borderBottom: '1px solid var(--color-border, #e5e7eb)',
          background: 'var(--color-bg-card, #fff)',
          flexShrink: 0,
        }}
      >
        <OrgFilters filters={filters} onChange={handleFiltersChange} />
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 0 0' }}>
        <OrgTable
          filters={filters}
          canWrite={canWrite}
          selectedOrgId={selectedOrgId}
          onSelectOrg={handleSelectOrg}
          onNewOrg={() => setShowNewOrgModal(true)}
          onDeactivate={handleDeactivate}
          onReactivate={handleReactivate}
        />
      </div>

      {/* Detail drawer */}
      <OrgDetailDrawer
        orgId={selectedOrgId}
        canWrite={canWrite}
        onClose={handleCloseDrawer}
        onDeactivate={handleDeactivate}
      />

      {/* Deactivation confirmation modal */}
      {deactivatingOrg && (
        <DeactivateModal
          org={deactivatingOrg}
          onClose={() => setDeactivatingOrg(null)}
          onSuccess={handleDeactivateSuccess}
        />
      )}

      {/* New organization modal */}
      {showNewOrgModal && (
        <NewOrgModal onClose={() => setShowNewOrgModal(false)} />
      )}
    </div>
  );
}
