'use client';

/**
 * PortalTabs — route-driven navigation tabs for the portal.
 *
 * Active destination derived from URL (usePathname), not client state,
 * so the active tab persists across reloads.
 * aria-current="page" on the active tab link.
 * Horizontally scrollable at narrow viewports.
 */

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface PortalTab {
  id: string;
  label: string;
  href: string;
}

const PORTAL_TABS: PortalTab[] = [
  { id: 'my-tickets', label: 'My Tickets', href: '/tickets' },
  { id: 'submit-request', label: 'Submit Request', href: '/submit' },
  { id: 'knowledge', label: 'Knowledge', href: '/knowledge' },
];

function isTabActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

export function PortalTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Portal navigation"
      style={{
        borderBottom: '1px solid var(--portal-border, #e5e7eb)',
        background: 'var(--portal-bg-header, #fff)',
        overflowX: 'auto',
        // Prevent page overflow on narrow viewports
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
      }}
    >
      <ul
        role="list"
        style={{
          display: 'flex',
          listStyle: 'none',
          margin: 0,
          padding: '0 20px',
          gap: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {PORTAL_TABS.map((tab) => {
          const active = isTabActive(pathname, tab.href);
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                data-portal-tab={tab.id}
                style={{
                  display: 'inline-block',
                  padding: '12px 20px',
                  fontSize: 14,
                  fontWeight: active ? 600 : 400,
                  color: active
                    ? 'var(--portal-accent, #0ea5e9)'
                    : 'var(--portal-fg-muted, #6b7280)',
                  textDecoration: 'none',
                  borderBottom: active
                    ? '2px solid var(--portal-accent, #0ea5e9)'
                    : '2px solid transparent',
                  transition: 'color 0.1s, border-color 0.1s',
                }}
                onMouseEnter={(e) => {
                  if (!active)
                    (e.currentTarget as HTMLAnchorElement).style.color =
                      'var(--portal-fg-primary, #111827)';
                }}
                onMouseLeave={(e) => {
                  if (!active)
                    (e.currentTarget as HTMLAnchorElement).style.color =
                      'var(--portal-fg-muted, #6b7280)';
                }}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
