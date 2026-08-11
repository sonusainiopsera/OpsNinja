import React, { useRef, useState } from 'react';

export interface OrgChipProps {
  name: string;
  /** Optional logo URL. Falls back to initials avatar. */
  logoUrl?: string;
  className?: string;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function OrgChip({ name, logoUrl, className }: OrgChipProps) {
  const [imgError, setImgError] = useState(false);
  const showLogo = Boolean(logoUrl) && !imgError;
  const initials = getInitials(name);
  const [showTooltip, setShowTooltip] = useState(false);
  const labelRef = useRef<HTMLSpanElement>(null);

  const isOverflowing = () => {
    const el = labelRef.current;
    return el ? el.scrollWidth > el.offsetWidth : false;
  };

  return (
    <span
      data-testid="org-chip"
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.375rem',
        maxWidth: '12rem',
        position: 'relative',
      }}
      onMouseEnter={() => { if (isOverflowing()) setShowTooltip(true); }}
      onMouseLeave={() => setShowTooltip(false)}
      onFocus={() => { if (isOverflowing()) setShowTooltip(true); }}
      onBlur={() => setShowTooltip(false)}
    >
      {/* Avatar */}
      {showLogo ? (
        <img
          src={logoUrl}
          alt=""
          aria-hidden="true"
          onError={() => setImgError(true)}
          style={{ width: '1.25rem', height: '1.25rem', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '1.25rem',
            height: '1.25rem',
            borderRadius: '50%',
            background: 'var(--color-org-avatar-bg, #e0e7ff)',
            color: 'var(--color-org-avatar-text, #3730a3)',
            fontSize: '0.6rem',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initials}
        </span>
      )}

      {/* Truncated label */}
      <span
        ref={labelRef}
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: '0.875rem',
        }}
        title={name}
      >
        {name}
      </span>

      {/* Tooltip on overflow */}
      {showTooltip && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            background: 'var(--color-tooltip-bg, #111827)',
            color: 'var(--color-tooltip-text, #fff)',
            padding: '0.25rem 0.5rem',
            borderRadius: '0.25rem',
            fontSize: '0.75rem',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 50,
          }}
        >
          {name}
        </span>
      )}
    </span>
  );
}
