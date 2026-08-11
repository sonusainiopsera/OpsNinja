'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

interface TabDef {
  key: string;
  label: string;
  href: string;
}

const PORTAL_TABS: readonly TabDef[] = [
  { key: 'my-tickets', label: 'My Tickets', href: '/tickets' },
  { key: 'submit-request', label: 'Submit Request', href: '/submit' },
  { key: 'knowledge', label: 'Knowledge', href: '/knowledge' },
];

function isTabActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

export function PortalTabs() {
  const pathname = usePathname();

  return (
    <nav
      role="navigation"
      aria-label="Portal navigation"
      data-testid="portal-tabs"
      style={{
        background: 'var(--color-surface, #fff)',
        borderBottom: '1px solid var(--color-border, #e5e7eb)',
        overflowX: 'auto',
        overflowY: 'hidden',
        WebkitOverflowScrolling: 'touch',
        // Prevent horizontal page overflow on narrow viewports
        maxWidth: '100vw',
      }}
    >
      <ul
        role="tablist"
        style={{
          display: 'flex',
          listStyle: 'none',
          margin: 0,
          padding: '0 1.5rem',
          gap: 0,
          minWidth: 'max-content',
        }}
      >
        {PORTAL_TABS.map(tab => {
          const active = isTabActive(pathname, tab.href);
          return (
            <li key={tab.key} role="presentation">
              <a
                href={tab.href}
                role="tab"
                aria-selected={active}
                aria-current={active ? 'page' : undefined}
                data-testid={`portal-tab-${tab.key}`}
                style={{
                  display: 'inline-block',
                  padding: '0.875rem 1.25rem',
                  fontWeight: active ? 600 : 400,
                  fontSize: '0.9375rem',
                  color: active
                    ? 'var(--color-accent, #4f46e5)'
                    : 'var(--color-text-secondary, #4b5563)',
                  textDecoration: 'none',
                  borderBottom: active
                    ? '2px solid var(--color-accent, #4f46e5)'
                    : '2px solid transparent',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.15s, border-color 0.15s',
                }}
              >
                {tab.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
