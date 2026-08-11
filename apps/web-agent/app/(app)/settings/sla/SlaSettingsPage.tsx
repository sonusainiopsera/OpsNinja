'use client';

/**
 * SlaSettingsPage — WO-049.
 *
 * Layout:
 *   PageHeader (title, NewPolicyButton, SchedulerHealthPill)
 *   Two-column:
 *     Left  → PolicyList
 *     Right → PolicyEditor (or empty state)
 *
 * Read-only gating: derived from identity role context.
 * Managers / admins get write access; agents see disabled inputs and no save.
 */

import React, { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCurrentPrincipal } from '@/lib/api/identity';
import { useSlaPolicies } from '@/lib/api/sla/hooks';
import type { SlaPolicy } from '@/lib/api/sla/types';
import { PolicyList } from './components/PolicyList';
import { PolicyEditor } from './components/PolicyEditor';
import { SchedulerHealthPill } from './components/SchedulerHealthPill';

const WRITE_ROLES = new Set(['admin', 'manager']);

export function SlaSettingsPage() {
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // Identity — determines read/write mode
  const principalQuery = useQuery({
    queryKey: ['currentPrincipal'],
    queryFn: fetchCurrentPrincipal,
    staleTime: 5 * 60_000,
  });
  const isReadOnly = !principalQuery.data?.roles.some((r) => WRITE_ROLES.has(r));

  // Policies list
  const { data: policies = [], isLoading, error } = useSlaPolicies();

  const selectedPolicy: SlaPolicy | null =
    isCreatingNew
      ? null
      : policies.find((p) => p.id === selectedPolicyId) ?? null;

  const showEditor = isCreatingNew || selectedPolicyId !== null;

  const handleSelectPolicy = useCallback((id: string) => {
    setSelectedPolicyId(id);
    setIsCreatingNew(false);
  }, []);

  const handleNewPolicy = useCallback(() => {
    setSelectedPolicyId(null);
    setIsCreatingNew(true);
  }, []);

  const handleSaved = useCallback((saved: SlaPolicy) => {
    setSelectedPolicyId(saved.id);
    setIsCreatingNew(false);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Page header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: '1px solid var(--color-border, #e5e7eb)',
          background: 'var(--color-bg-card, #fff)',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--color-fg-primary, #111827)' }}>
            SLA Policies
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-fg-secondary, #6b7280)', margin: '2px 0 0' }}>
            Configure priority targets, calendars, reminder thresholds and escalation channels.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SchedulerHealthPill />
          {!isReadOnly && (
            <button
              type="button"
              onClick={handleNewPolicy}
              aria-label="Create new SLA policy"
              style={{
                padding: '7px 16px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--color-primary, #4f46e5)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + New Policy
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      <main
        id="main-sla-content"
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: showEditor ? '300px 1fr' : '1fr',
          gap: 0,
          overflow: 'hidden',
        }}
      >
        {/* Policy list */}
        <div
          style={{
            borderRight: showEditor ? '1px solid var(--color-border, #e5e7eb)' : undefined,
            overflowY: 'auto',
            padding: 16,
            background: 'var(--color-bg-page, #f9fafb)',
          }}
        >
          {isLoading && (
            <div aria-label="Loading policies" style={{ padding: 16, color: 'var(--color-fg-secondary, #6b7280)', fontSize: 13 }}>
              Loading…
            </div>
          )}
          {error && (
            <div role="alert" style={{ padding: 16, color: 'var(--color-error, #ef4444)', fontSize: 13 }}>
              Failed to load policies. Please refresh.
            </div>
          )}
          {!isLoading && !error && (
            <PolicyList
              policies={policies}
              selectedId={isCreatingNew ? null : selectedPolicyId}
              onSelect={handleSelectPolicy}
              onNew={handleNewPolicy}
            />
          )}
        </div>

        {/* Policy editor */}
        {showEditor && (
          <div style={{ overflowY: 'auto', padding: 16 }}>
            <PolicyEditor
              policy={selectedPolicy}
              isReadOnly={isReadOnly}
              onSaved={handleSaved}
            />
          </div>
        )}
      </main>
    </div>
  );
}
