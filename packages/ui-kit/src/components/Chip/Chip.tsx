import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

const chipVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'bg-surface-raised text-primary border border-border-default',
        primary: 'bg-accent/10 text-accent',
        success: 'bg-success/10 text-success',
        warning: 'bg-warning/10 text-warning',
        danger: 'bg-danger/10 text-danger',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface ChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof chipVariants> {
  onRemove?: () => void;
}

export function Chip({ className, variant, children, onRemove, title, ...props }: ChipProps) {
  const labelText = typeof children === 'string' ? children : undefined;
  return (
    <span
      className={cn(chipVariants({ variant }), 'max-w-[200px]', className)}
      title={title ?? labelText}
      {...props}
    >
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="shrink-0 rounded-full hover:opacity-70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
        >
          ×
        </button>
      )}
    </span>
  );
}
