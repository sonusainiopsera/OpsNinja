import React from 'react';

interface HelpLinkProps {
  href?: string;
  label?: string;
}

export function HelpLink({ href = '/help', label = 'Help' }: HelpLinkProps) {
  return (
    <a
      href={href}
      data-testid="help-link"
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        color: 'var(--color-muted, #6b7280)',
        textDecoration: 'none',
        fontSize: '0.875rem',
        fontWeight: 500,
        padding: '0.25rem 0.5rem',
        borderRadius: '0.375rem',
      }}
    >
      <span aria-hidden="true">?</span>
      <span>{label}</span>
    </a>
  );
}
