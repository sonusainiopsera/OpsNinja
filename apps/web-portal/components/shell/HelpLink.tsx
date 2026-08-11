'use client';

import React from 'react';
import { Icon } from '@opsninja/ui-kit/portal';

export function HelpLink() {
  return (
    <a
      href="/help"
      aria-label="Help and support"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        color: 'var(--portal-fg-muted, #6b7280)',
        textDecoration: 'none',
        fontSize: 13,
        fontWeight: 500,
        padding: '4px 8px',
        borderRadius: 6,
      }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLAnchorElement).style.color =
          'var(--portal-accent, #0ea5e9)')
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLAnchorElement).style.color =
          'var(--portal-fg-muted, #6b7280)')
      }
    >
      <Icon name="alert-circle" size={15} />
      <span>Help</span>
    </a>
  );
}
