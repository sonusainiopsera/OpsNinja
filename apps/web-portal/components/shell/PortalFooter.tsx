import React from 'react';

const FOOTER_LINKS = [
  { label: 'Privacy Policy', href: '/legal/privacy' },
  { label: 'Terms of Service', href: '/legal/terms' },
  { label: 'Contact Support', href: '/support/contact' },
  { label: 'Accessibility', href: '/legal/accessibility' },
] as const;

export function PortalFooter() {
  return (
    <footer
      role="contentinfo"
      data-testid="portal-footer"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.5rem',
        padding: '1rem 1.5rem',
        borderTop: '1px solid var(--color-border, #e5e7eb)',
        background: 'var(--color-surface, #fff)',
        fontSize: '0.8125rem',
        color: 'var(--color-muted, #6b7280)',
      }}
    >
      <span>
        &copy; {new Date().getFullYear()} OpsNinja. All rights reserved.
      </span>
      <nav aria-label="Footer links">
        <ul
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1rem',
            listStyle: 'none',
            margin: 0,
            padding: 0,
          }}
        >
          {FOOTER_LINKS.map(link => (
            <li key={link.href}>
              <a
                href={link.href}
                data-testid={`footer-link-${link.href.split('/').pop()}`}
                style={{
                  color: 'var(--color-muted, #6b7280)',
                  textDecoration: 'none',
                }}
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
