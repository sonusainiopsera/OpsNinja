'use client';

import React, { useRef, useState } from 'react';

interface OrgScopePillProps {
  orgName: string;
}

/**
 * OrgScopePill — read-only org name chip.
 *
 * The portal user belongs to exactly one organization; there is deliberately
 * no switcher component. Long names are truncated with an accessible tooltip.
 */
export function OrgScopePill({ orgName }: OrgScopePillProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const pillRef = useRef<HTMLSpanElement>(null);

  const isOverflowing =
    pillRef.current
      ? pillRef.current.scrollWidth > pillRef.current.offsetWidth
      : false;

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
    >
      <span
        ref={pillRef}
        role="status"
        aria-label={`Organization: ${orgName}`}
        data-testid="org-scope-pill"
        title={orgName}
        tabIndex={0}
        onFocus={() => setTooltipVisible(true)}
        onBlur={() => setTooltipVisible(false)}
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
        style={{
          display: 'inline-block',
          maxWidth: '12rem',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          padding: '0.125rem 0.625rem',
          background: 'var(--color-surface-alt, #f3f4f6)',
          color: 'var(--color-text, #111827)',
          borderRadius: '9999px',
          fontSize: '0.8125rem',
          fontWeight: 500,
          border: '1px solid var(--color-border, #e5e7eb)',
          cursor: 'default',
        }}
      >
        {orgName}
      </span>
      {(tooltipVisible && isOverflowing) && (
        <span
          role="tooltip"
          data-testid="org-scope-tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.25rem)',
            left: 0,
            zIndex: 100,
            background: 'var(--color-text, #111827)',
            color: 'var(--color-surface, #fff)',
            padding: '0.25rem 0.5rem',
            borderRadius: '0.25rem',
            fontSize: '0.75rem',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {orgName}
        </span>
      )}
    </span>
  );
}
