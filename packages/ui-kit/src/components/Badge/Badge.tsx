import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
  {
    variants: {
      variant: {
        default: 'bg-surface-raised text-primary ring-border-default',
        primary: 'bg-accent/10 text-accent ring-accent/20',
        success: 'bg-success/10 text-success ring-success/20',
        warning: 'bg-warning/10 text-warning ring-warning/20',
        danger: 'bg-danger/10 text-danger ring-danger/20',
        info: 'bg-info/10 text-info ring-info/20',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, children, title, ...props }: BadgeProps) {
  const labelText = typeof children === 'string' ? children : undefined;
  return (
    <span
      className={cn(badgeVariants({ variant }), 'max-w-[160px]', className)}
      title={title ?? labelText}
      {...props}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
