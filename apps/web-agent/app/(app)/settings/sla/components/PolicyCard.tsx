'use client';

import React from 'react';
import type { SlaPolicy } from '../../../../lib/api/sla/types';

interface PolicyCardProps {
  policy: SlaPolicy;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

export function PolicyCard({ policy, isSelected, onSelect }: PolicyCardProps) {
  return (
    <article
      aria-current={isSelected ? 'true' : undefined}
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        border: isSelected
          ? '2px solid var(--color-primary, #4f46e5)'
          : '1px solid var(--color-border, #e5e7eb)',
        background: isSelected
          ? 'var(--color-primary-surface, #eef2ff)'
          : 'var(--color-bg-card, #fff)',
        cursor: 'pointer',
        marginBottom: 8,
      }}
      onClick={() => onSelect(policy.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(policy.id);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Select ${policy.name} policy`}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-fg-primary, #111827)' }}>
              {policy.name}
            </span>
            {!policy.targetsRatified && (
              <span
                aria-label="Provisional — not yet ratified"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'var(--color-warning-surface, #fef3c7)',
                  color: 'var(--color-warning, #92400e)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                provisional
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-fg-secondary, #6b7280)', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span>Scope: {policy.scopeType}</span>
            {policy.calendarName && <span>Calendar: {policy.calendarName}</span>}
            {policy.appliedOrganizationCount > 0 && (
              <span>{policy.appliedOrganizationCount} org{policy.appliedOrganizationCount !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
        {isSelected && (
          <span aria-hidden="true" style={{ color: 'var(--color-primary, #4f46e5)', fontSize: 16 }}>✓</span>
        )}
      </div>
    </article>
  );
}
