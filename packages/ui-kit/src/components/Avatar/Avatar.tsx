import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { User } from '../../icons/index.js';
import { cn } from '../../lib/cn.js';

const avatarVariants = cva(
  'relative inline-flex items-center justify-center rounded-full overflow-hidden bg-surface-raised text-secondary font-medium shrink-0',
  {
    variants: {
      size: {
        sm: 'size-7 text-xs',
        md: 'size-9 text-sm',
        lg: 'size-12 text-base',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') return '';
  if (parts.length === 1) return (parts[0]?.[0] ?? '').toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

export interface AvatarProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof avatarVariants> {
  src?: string;
  name?: string;
  alt?: string;
}

export function Avatar({ className, size, src, name, alt, ...props }: AvatarProps) {
  const [imgError, setImgError] = React.useState(false);
  const initials = name ? getInitials(name) : '';
  const showImg = src && !imgError;

  return (
    <span
      className={cn(avatarVariants({ size }), className)}
      aria-label={alt ?? name}
      role="img"
      {...props}
    >
      {showImg ? (
        <img
          src={src}
          alt={alt ?? name ?? ''}
          className="size-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : initials ? (
        <span aria-hidden="true">{initials}</span>
      ) : (
        <User className="size-1/2" aria-hidden="true" />
      )}
    </span>
  );
}
