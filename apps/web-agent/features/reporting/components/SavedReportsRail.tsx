'use client';

/**
 * SavedReportsRail — sidebar listing saved report definitions (WO-078 AC-2).
 *
 * Lists private, team and tenant-wide definitions grouped by scope.
 * Each item shows name, scope badge, and rename/delete actions.
 * NewReportButton clears the builder to start fresh.
 */

import React, { useState } from 'react';
import type { ReportDefinition, ReportScope } from '../../../lib/api/reporting/types';

const SCOPE_LABEL: Record<ReportScope, string> = {
  private: 'Private',
  team:    'Team',
  tenant:  'Shared',
};

const SCOPE_COLOR: Record<ReportScope, string> = {
  private: 'var(--color-text-secondary)',
  team:    'var(--color-primary)',
  tenant:  'var(--color-success, #16a34a)',
};

interface SavedReportsRailProps {
  reports:       ReportDefinition[];
  activeId:      string | null;
  onSelect:      (report: ReportDefinition) => void;
  onNew:         () => void;
  onRename:      (id: string, name: string) => void;
  onDelete:      (id: string) => void;
  isLoading?:    boolean;
}

export function SavedReportsRail({
  reports,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  isLoading = false,
}: SavedReportsRailProps) {
  const [renamingId,    setRenamingId]    = useState<string | null>(null);
  const [renameValue,   setRenameValue]   = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function startRename(report: ReportDefinition) {
    setRenamingId(report.id);
    setRenameValue(report.name);
  }

  function commitRename() {
    if (renamingId && renameValue.trim()) {
      onRename(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  }

  const grouped: Record<ReportScope, ReportDefinition[]> = {
    private: reports.filter((r) => r.scope === 'private'),
    team:    reports.filter((r) => r.scope === 'team'),
    tenant:  reports.filter((r) => r.scope === 'tenant'),
  };

  const ORDER: ReportScope[] = ['private', 'team', 'tenant'];

  return (
    <nav
      aria-label="Saved reports"
      style={{
        width:        220,
        flexShrink:   0,
        borderRight:  '1px solid var(--color-border)',
        display:      'flex',
        flexDirection:'column',
        gap:          0,
        height:       '100%',
        overflowY:    'auto',
      }}
    >
      {/* New report button */}
      <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--color-border)' }}>
        <button
          type="button"
          onClick={onNew}
          aria-label="New report"
          style={{
            width:        '100%',
            padding:      '0.5rem',
            borderRadius: 'var(--radius-md, 6px)',
            border:       '1px dashed var(--color-primary)',
            background:   'var(--color-primary-subtle)',
            color:        'var(--color-primary)',
            fontWeight:   600,
            cursor:       'pointer',
            fontSize:     '0.875rem',
            display:      'flex',
            gap:          '0.375rem',
            justifyContent: 'center',
          }}
        >
          <span aria-hidden="true">+</span> New report
        </button>
      </div>

      {/* Report list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0' }}>
        {isLoading && (
          <p style={{ padding: '0.75rem', color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
            Loading…
          </p>
        )}
        {!isLoading && reports.length === 0 && (
          <p style={{ padding: '0.75rem', color: 'var(--color-text-secondary)', fontSize: '0.8125rem', fontStyle: 'italic' }}>
            No saved reports yet.
          </p>
        )}
        {ORDER.map((scope) => {
          const items = grouped[scope];
          if (items.length === 0) return null;
          return (
            <section key={scope} aria-label={`${SCOPE_LABEL[scope]} reports`}>
              <h3
                style={{
                  padding:      '0.375rem 0.75rem',
                  fontSize:     '0.7rem',
                  fontWeight:   700,
                  textTransform:'uppercase',
                  letterSpacing:'0.06em',
                  color:        'var(--color-text-secondary)',
                  margin:       0,
                }}
              >
                {SCOPE_LABEL[scope]}
              </h3>
              <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {items.map((report) => (
                  <li key={report.id}>
                    {renamingId === report.id ? (
                      <div style={{ padding: '0.375rem 0.5rem', display: 'flex', gap: '0.25rem' }}>
                        <input
                          type="text"
                          value={renameValue}
                          autoFocus
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                          aria-label="Rename report"
                          style={{
                            flex:         1,
                            padding:      '0.25rem 0.4rem',
                            border:       '1px solid var(--color-primary)',
                            borderRadius: 'var(--radius-sm, 4px)',
                            fontSize:     '0.8125rem',
                            background:   'var(--color-surface)',
                            color:        'var(--color-text-primary)',
                          }}
                        />
                        <button type="button" onClick={commitRename} aria-label="Save rename" style={{ cursor: 'pointer', fontSize: '0.875rem' }}>✓</button>
                        <button type="button" onClick={() => setRenamingId(null)} aria-label="Cancel rename" style={{ cursor: 'pointer', fontSize: '0.875rem' }}>✕</button>
                      </div>
                    ) : (
                      <div
                        style={{
                          display:       'flex',
                          alignItems:    'center',
                          gap:           '0.25rem',
                          padding:       '0.375rem 0.75rem',
                          background:    activeId === report.id ? 'var(--color-primary-subtle)' : 'transparent',
                          borderLeft:    activeId === report.id ? '2px solid var(--color-primary)' : '2px solid transparent',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => onSelect(report)}
                          aria-current={activeId === report.id ? 'page' : undefined}
                          aria-label={`Open ${report.name} (${SCOPE_LABEL[scope]})`}
                          style={{
                            flex:       1,
                            textAlign:  'left',
                            background: 'none',
                            border:     'none',
                            cursor:     'pointer',
                            fontSize:   '0.8125rem',
                            fontWeight: activeId === report.id ? 600 : 400,
                            color:      'var(--color-text-primary)',
                            overflow:   'hidden',
                            textOverflow:'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {report.name}
                        </button>
                        <span
                          aria-label={`${SCOPE_LABEL[scope]} scope`}
                          title={`${SCOPE_LABEL[scope]} scope`}
                          style={{ fontSize: '0.65rem', fontWeight: 700, color: SCOPE_COLOR[scope] }}
                        >
                          {scope === 'private' ? '🔒' : scope === 'team' ? '👥' : '🌐'}
                        </span>
                        {/* Actions */}
                        <button
                          type="button"
                          onClick={() => startRename(report)}
                          aria-label={`Rename ${report.name}`}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--color-text-secondary)', padding: '0 0.125rem' }}
                        >
                          ✏
                        </button>
                        {confirmDelete === report.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => { onDelete(report.id); setConfirmDelete(null); }}
                              aria-label={`Confirm delete ${report.name}`}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--color-error, #dc2626)' }}
                            >
                              ✓
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(null)}
                              aria-label="Cancel delete"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem' }}
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(report.id)}
                            aria-label={`Delete ${report.name}`}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--color-text-secondary)', padding: '0 0.125rem' }}
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </nav>
  );
}
