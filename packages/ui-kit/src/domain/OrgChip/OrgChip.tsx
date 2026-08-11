/**
 * OrgChip — organization identifier chip with optional avatar/initials.
 *
 * Long names are visually truncated; the full value is in the accessible title
 * and aria-label so screen readers always announce the complete name.
 * Deactivated organizations render with a distinct muted treatment.
 */

import React from 'react';
import { Icon } from '../../Icon';

export interface OrgChipProps {
  /** Organization display name. */
  name: string;
  /** Optional avatar URL. Falls back to initials when absent. */
  avatarUrl?: string;
  /** When true, renders with a muted/strikethrough treatment. */
  deactivated?: boolean;
  className?: string;
  /** Maximum display length before truncation (default 20). */
  maxLength?: number;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function OrgChip({
  name,
  avatarUrl,
  deactivated = false,
  className,
  maxLength = 20,
}: OrgChipProps) {
  const truncated = name.length > maxLength ? name.slice(0, maxLength - 1) + '…' : name;
  const isTruncated = truncated !== name;

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 8px 2px 2px',
    borderRadius: 9999,
    background: deactivated ? 'var(--org-chip-deactivated-bg, #f9fafb)' : 'var(--org-chip-bg, #f3f4f6)',
    color: deactivated ? 'var(--org-chip-deactivated-fg, #9ca3af)' : 'var(--org-chip-fg, #374151)',
    fontSize: 12,
    maxWidth: 200,
    opacity: deactivated ? 0.7 : 1,
  };

  const avatarStyle: React.CSSProperties = {
    width: 20,
    height: 20,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 9,
    fontWeight: 700,
    background: 'var(--org-chip-avatar-bg, #d1d5db)',
    color: 'var(--org-chip-avatar-fg, #374151)',
    flexShrink: 0,
    overflow: 'hidden',
  };

  const nameLabel = deactivated ? `${name} (deactivated)` : name;

  return (
    <span
      className={className}
      aria-label={nameLabel}
      title={isTruncated ? name : undefined}
      data-org-chip
      data-deactivated={deactivated || undefined}
      style={chipStyle}
    >
      <span style={avatarStyle} aria-hidden="true">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          initials(name) || <Icon name="building" size={10} />
        )}
      </span>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textDecoration: deactivated ? 'line-through' : undefined,
        }}
        aria-hidden="true"
      >
        {truncated}
      </span>
    </span>
  );
}
