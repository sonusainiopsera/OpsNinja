'use client';

/**
 * ViewsRail — left-side views sidebar listing system views and pinned custom views.
 *
 * Features:
 *  - System views (All Open, My Open, Unassigned, Breached SLA) always shown at top
 *  - Pinned custom views below, with live count badges
 *  - Pin/unpin toggle per custom view
 *  - Active view highlighted
 *  - Keyboard accessible: arrow-key navigation within the rail
 */

import React, { useCallback, useRef } from 'react';
import { useViews, usePinView } from '../../lib/api/views/hooks';
import type { SavedView } from '../../lib/api/views/types';
import { SYSTEM_VIEW_IDS } from '../../lib/api/views/types';

// ---------------------------------------------------------------------------
// Static system view definitions
// ---------------------------------------------------------------------------

const SYSTEM_VIEWS: Array<{ id: string; label: string; icon: string }> = [
  { id: SYSTEM_VIEW_IDS.ALL_OPEN, label: 'All Open', icon: '📋' },
  { id: SYSTEM_VIEW_IDS.MY_OPEN, label: 'My Open', icon: '👤' },
  { id: SYSTEM_VIEW_IDS.UNASSIGNED, label: 'Unassigned', icon: '⬜' },
  { id: SYSTEM_VIEW_IDS.BREACHED_SLA, label: 'Breached SLA', icon: '🔴' },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ViewItemProps {
  id: string;
  label: string;
  icon: string;
  count?: number | null;
  active: boolean;
  pinned?: boolean;
  canPin?: boolean;
  onSelect: () => void;
  onTogglePin?: () => void;
}

function ViewItem({
  id,
  label,
  icon,
  count,
  active,
  pinned,
  canPin,
  onSelect,
  onTogglePin,
}: ViewItemProps) {
  return (
    <li role="none">
      <button
        role="menuitem"
        aria-current={active ? 'page' : undefined}
        data-view-id={id}
        onClick={onSelect}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '7px 12px',
          background: active ? 'var(--color-primary-soft, #eef2ff)' : 'transparent',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: active ? 600 : 400,
          color: active
            ? 'var(--color-primary, #4f46e5)'
            : 'var(--color-fg-primary, #111827)',
          textAlign: 'left',
        }}
        onFocus={(e) => (e.currentTarget.style.outline = '2px solid var(--color-primary, #4f46e5)')}
        onBlur={(e) => (e.currentTarget.style.outline = 'none')}
      >
        <span aria-hidden="true" style={{ flexShrink: 0, width: 18 }}>{icon}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {count !== null && count !== undefined && (
          <span
            aria-label={`${count} tickets`}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: 99,
              background: active ? 'var(--color-primary, #4f46e5)' : 'var(--color-bg-alt, #f3f4f6)',
              color: active ? '#fff' : 'var(--color-muted, #6b7280)',
              minWidth: 18,
              textAlign: 'center',
            }}
          >
            {count > 999 ? '999+' : count}
          </span>
        )}
        {canPin && (
          <button
            type="button"
            aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
            onClick={(e) => { e.stopPropagation(); onTogglePin?.(); }}
            title={pinned ? 'Unpin' : 'Pin to rail'}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '1px 3px',
              borderRadius: 3,
              fontSize: 12,
              opacity: pinned ? 1 : 0.4,
              flexShrink: 0,
            }}
          >
            📌
          </button>
        )}
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// ViewsRail
// ---------------------------------------------------------------------------

interface ViewsRailProps {
  activeViewId: string;
  onSelectView: (viewId: string) => void;
}

export function ViewsRail({ activeViewId, onSelectView }: ViewsRailProps) {
  const { data: views, isLoading, isError } = useViews();
  const pinMutation = usePinView();
  const railRef = useRef<HTMLElement>(null);

  const pinnedCustomViews = views?.filter((v) => !v.isSystem && v.pinned) ?? [];

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const items = railRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!items) return;
    const arr = Array.from(items);
    const focused = document.activeElement;
    const idx = arr.indexOf(focused as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      arr[idx + 1]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      arr[idx - 1]?.focus();
    }
  }, []);

  const handlePin = useCallback(
    (view: SavedView) => {
      pinMutation.mutate({ viewId: view.id, pinned: !view.pinned, version: view.version });
    },
    [pinMutation],
  );

  return (
    <nav
      ref={railRef}
      aria-label="Ticket views"
      onKeyDown={handleKeyDown}
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid var(--color-border, #e5e7eb)',
        overflowY: 'auto',
        paddingTop: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
    >
      {/* System views */}
      <div style={{ padding: '0 8px' }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--color-muted, #9ca3af)',
            padding: '4px 4px 4px 12px',
          }}
        >
          System
        </div>
        <ul role="menu" aria-label="System views" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {SYSTEM_VIEWS.map((sv) => {
            const serverView = views?.find((v) => v.id === sv.id);
            return (
              <ViewItem
                key={sv.id}
                id={sv.id}
                label={sv.label}
                icon={sv.icon}
                count={serverView?.ticketCount}
                active={activeViewId === sv.id}
                onSelect={() => onSelectView(sv.id)}
              />
            );
          })}
        </ul>
      </div>

      {/* Pinned custom views */}
      {(isLoading || pinnedCustomViews.length > 0) && (
        <div style={{ padding: '8px 8px 0' }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--color-muted, #9ca3af)',
              padding: '4px 4px 4px 12px',
            }}
          >
            Pinned Views
          </div>
          {isLoading ? (
            <ul role="menu" aria-label="Pinned views loading" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {[1, 2].map((i) => (
                <li key={i} aria-hidden="true" style={{ height: 32, margin: '4px 0' }}>
                  <div
                    style={{
                      height: '100%',
                      borderRadius: 4,
                      background: 'var(--color-bg-alt, #f3f4f6)',
                      animation: 'pulse 1.5s infinite',
                    }}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ul role="menu" aria-label="Pinned views" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {pinnedCustomViews.map((view) => (
                <ViewItem
                  key={view.id}
                  id={view.id}
                  label={view.name}
                  icon="🔖"
                  count={view.ticketCount}
                  active={activeViewId === view.id}
                  pinned={view.pinned}
                  canPin
                  onSelect={() => onSelectView(view.id)}
                  onTogglePin={() => handlePin(view)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {isError && (
        <p role="alert" style={{ padding: '4px 12px', fontSize: 12, color: '#dc2626' }}>
          Failed to load views
        </p>
      )}
    </nav>
  );
}
