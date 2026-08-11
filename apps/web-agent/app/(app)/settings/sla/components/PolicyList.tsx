'use client';

import React from 'react';
import type { SlaPolicy } from '@/lib/api/sla/types';
import { PolicyCard } from './PolicyCard';

interface PolicyListProps {
  policies: SlaPolicy[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function PolicyList({ policies, selectedId, onSelect, onNew }: PolicyListProps) {
  if (policies.length === 0) {
    return (
      <section
        aria-label="SLA policies"
        style={{
          padding: 24,
          textAlign: 'center',
          border: '1px dashed var(--color-border, #e5e7eb)',
          borderRadius: 8,
          background: 'var(--color-bg-card, #fff)',
        }}
      >
        <p style={{ fontSize: 14, color: 'var(--color-fg-secondary, #6b7280)', marginBottom: 12 }}>
          No SLA policies configured yet.
        </p>
        <button
          type="button"
          onClick={onNew}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: '1px solid var(--color-primary, #4f46e5)',
            background: 'none',
            color: 'var(--color-primary, #4f46e5)',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          Create your first policy
        </button>
      </section>
    );
  }

  return (
    <section aria-label="SLA policies">
      {policies.map((policy) => (
        <PolicyCard
          key={policy.id}
          policy={policy}
          isSelected={policy.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </section>
  );
}
