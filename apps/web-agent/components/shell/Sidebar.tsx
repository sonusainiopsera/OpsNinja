'use client';

/**
 * Sidebar — collapsible nav rail with SSR-safe localStorage persistence.
 *
 * Wide: full nav rail with group labels and item text.
 * Collapsed: icon-only rail; tooltips on each item.
 * Mobile: off-canvas drawer with focus trap.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { NavGroup } from './NavGroup';
import { TenantSwitcher } from './TenantSwitcher';
import { TenantSwitcherSkeleton } from './ShellSkeletons';
import { readSidebarCollapsed, writeSidebarCollapsed } from '../../lib/store/sidebarCollapse';
import { filterNavConfig } from '../../lib/navigation/canFor';
import { NAV_CONFIG } from '../../lib/navigation/navConfig';
import type { Principal, OrgScopeResult } from '../../lib/api/identity';

const SIDEBAR_WIDTH = 240;
const COLLAPSED_WIDTH = 56;

interface SidebarProps {
  principal: Principal | null;
  orgScope: OrgScopeResult | null;
  /** Mobile drawer: when true, overlays and traps focus */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ principal, orgScope, mobileOpen = false, onMobileClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  // SSR-safe: read from localStorage after hydration
  useEffect(() => {
    setCollapsed(readSidebarCollapsed());
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      writeSidebarCollapsed(next);
      return next;
    });
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    if (mobileOpen) onMobileClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const filteredGroups =
    principal != null
      ? filterNavConfig(NAV_CONFIG, { roles: principal.roles })
      : NAV_CONFIG;

  const sidebarContent = (
    <nav
      aria-label="Primary navigation"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Tenant switcher */}
      <div style={{ padding: '12px 8px 8px', borderBottom: '1px solid var(--color-border,#e5e7eb)' }}>
        {orgScope ? (
          <TenantSwitcher
            current={orgScope.current}
            available={orgScope.available}
          />
        ) : (
          <TenantSwitcherSkeleton />
        )}
      </div>

      {/* Navigation groups */}
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 8 }}>
        {filteredGroups.map((group) => (
          <NavGroup
            key={group.id}
            group={group}
            currentPathname={pathname}
            collapsed={collapsed && !mobileOpen}
          />
        ))}
      </div>

      {/* Collapse toggle */}
      <div style={{ borderTop: '1px solid var(--color-border,#e5e7eb)', padding: 8 }}>
        <button
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          onClick={toggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 8,
            width: '100%',
            padding: '8px 8px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--color-muted, #6b7280)',
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = 'var(--color-nav-hover-bg,#f3f4f6)')
          }
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >
          <span aria-hidden="true">{collapsed ? '→' : '←'}</span>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </nav>
  );

  // Mobile overlay drawer
  if (mobileOpen) {
    return (
      <>
        {/* Backdrop */}
        <div
          aria-hidden="true"
          onClick={onMobileClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 299,
          }}
        />
        {/* Drawer */}
        <div
          role="dialog"
          aria-label="Navigation menu"
          aria-modal="true"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            width: SIDEBAR_WIDTH,
            background: 'var(--color-bg-sidebar,#fff)',
            borderRight: '1px solid var(--color-border,#e5e7eb)',
            zIndex: 300,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 8 }}>
            <button
              aria-label="Close navigation menu"
              onClick={onMobileClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 18,
                padding: 4,
              }}
            >
              ✕
            </button>
          </div>
          {sidebarContent}
        </div>
      </>
    );
  }

  return (
    <aside
      style={{
        width: collapsed ? COLLAPSED_WIDTH : SIDEBAR_WIDTH,
        flexShrink: 0,
        background: 'var(--color-bg-sidebar, #fff)',
        borderRight: '1px solid var(--color-border, #e5e7eb)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
      }}
    >
      {sidebarContent}
    </aside>
  );
}
