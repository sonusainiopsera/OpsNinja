'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { TenantSwitcher } from './TenantSwitcher';
import { NavGroupComponent } from './NavGroup';
import { navConfig } from '@/lib/navigation/navConfig';
import { filterNavGroups } from '@/lib/navigation/canFor';
import type { PrincipalSnapshot } from '@/lib/navigation/canFor';

const SIDEBAR_KEY = 'opsninja.shell.sidebar';

function readStoredCollapsed(): boolean {
  // SSR-safe: only read localStorage on client
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

interface SidebarProps {
  principal: PrincipalSnapshot | null;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ principal, mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname();

  // Sidebar collapse — defaults to false on SSR, hydrates from localStorage
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setCollapsed(readStoredCollapsed());
    setHydrated(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed(c => {
      const next = !c;
      try {
        window.localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded');
      } catch { /* localStorage unavailable — silently ignore */ }
      return next;
    });
  };

  // Close drawer on route change
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    if (pathname !== prevPathnameRef.current && mobileOpen) {
      onMobileClose?.();
    }
    prevPathnameRef.current = pathname;
  }, [pathname, mobileOpen, onMobileClose]);

  // Focus trap for mobile drawer
  useEffect(() => {
    if (!mobileOpen) return;
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onMobileClose?.();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen, onMobileClose]);

  // RBAC-filtered nav groups — excluded from DOM when principal lacks role
  const filteredGroups = principal
    ? filterNavGroups(navConfig as typeof navConfig, principal)
    : [];

  const sidebarContent = (
    <>
      {/* Collapse toggle (desktop only) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: '1rem 0.75rem 0.5rem',
          gap: '0.5rem',
        }}
      >
        {!collapsed && (
          <span
            style={{
              fontWeight: 700,
              fontSize: '1rem',
              color: 'var(--color-text, #111827)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            OpsNinja
          </span>
        )}
        <button
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={toggleCollapsed}
          data-testid="sidebar-collapse-toggle"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0.25rem',
            borderRadius: '0.25rem',
            color: 'var(--color-muted, #6b7280)',
            fontSize: '1rem',
          }}
        >
          {collapsed ? '→' : '←'}
        </button>
      </div>

      {/* Tenant switcher */}
      <div style={{ padding: '0.5rem 0.75rem' }}>
        <TenantSwitcher collapsed={collapsed} />
      </div>

      {/* Navigation */}
      <nav aria-label="Main navigation" style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0.5rem' }}>
        <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {filteredGroups.map(group => (
            <NavGroupComponent
              key={group.key}
              group={group}
              activePathname={pathname}
              collapsed={collapsed && !mobileOpen}
              onNavigate={mobileOpen ? onMobileClose : undefined}
            />
          ))}
        </ul>
      </nav>
    </>
  );

  // Mobile drawer variant
  if (mobileOpen) {
    return (
      <>
        {/* Overlay */}
        <div
          aria-hidden="true"
          onClick={onMobileClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 40,
          }}
        />
        {/* Drawer */}
        <nav
          ref={drawerRef}
          aria-label="Mobile navigation"
          data-testid="mobile-drawer"
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            width: '16rem',
            background: 'var(--color-surface, #fff)',
            borderRight: '1px solid var(--color-border, #e5e7eb)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
          }}
        >
          <button
            ref={closeButtonRef}
            aria-label="Close navigation menu"
            onClick={onMobileClose}
            data-testid="mobile-drawer-close"
            style={{
              alignSelf: 'flex-end',
              margin: '0.75rem',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1.25rem',
              color: 'var(--color-muted, #6b7280)',
            }}
          >
            ✕
          </button>
          {sidebarContent}
        </nav>
      </>
    );
  }

  // Desktop sidebar
  return (
    <aside
      data-testid="sidebar"
      aria-label="Sidebar"
      data-collapsed={hydrated ? collapsed : false}
      style={{
        width: collapsed ? '3.5rem' : '16rem',
        minHeight: '100vh',
        background: 'var(--color-surface, #fff)',
        borderRight: '1px solid var(--color-border, #e5e7eb)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 200ms ease',
        flexShrink: 0,
      }}
    >
      {sidebarContent}
    </aside>
  );
}
