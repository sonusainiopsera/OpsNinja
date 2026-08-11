/**
 * PortalFooter — legal and support links.
 * Server component — no client interactivity needed.
 */

import React from 'react';

const FOOTER_LINKS = [
  { label: 'Privacy Policy', href: '/legal/privacy' },
  { label: 'Terms of Service', href: '/legal/terms' },
  { label: 'Contact Support', href: '/support' },
  { label: 'Status', href: '/status' },
];

export function PortalFooter() {
  return (
    <footer
      role="contentinfo"
      aria-label="Portal footer"
      style={{
        borderTop: '1px solid var(--portal-border, #e5e7eb)',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
        fontSize: 12,
        color: 'var(--portal-fg-muted, #9ca3af)',
        background: 'var(--portal-bg-footer, #fff)',
      }}
    >
      <span>© {new Date().getFullYear()} OpsNinja</span>
      <nav aria-label="Footer links">
        <ul
          style={{
            display: 'flex',
            gap: 12,
            listStyle: 'none',
            margin: 0,
            padding: 0,
            flexWrap: 'wrap',
          }}
        >
          {FOOTER_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                style={{
                  color: 'var(--portal-fg-muted, #9ca3af)',
                  textDecoration: 'none',
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLAnchorElement).style.color =
                    'var(--portal-accent, #0ea5e9)')
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLAnchorElement).style.color =
                    'var(--portal-fg-muted, #9ca3af)')
                }
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
