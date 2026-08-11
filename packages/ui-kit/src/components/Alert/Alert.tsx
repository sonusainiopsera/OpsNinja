import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from '../../icons/index.js';
import { cn } from '../../lib/cn.js';

const alertVariants = cva(
  'relative w-full rounded-lg border p-4 flex items-start gap-3 text-sm',
  {
    variants: {
      variant: {
        info: 'border-info/30 bg-info/10 text-primary [&>svg]:text-info',
        success: 'border-success/30 bg-success/10 text-primary [&>svg]:text-success',
        warning: 'border-warning/30 bg-warning/10 text-primary [&>svg]:text-warning',
        error: 'border-danger/30 bg-danger/10 text-primary [&>svg]:text-danger',
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
} as const;

const LABELS = {
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
} as const;

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  title?: string;
}

export function Alert({
  className,
  variant = 'info',
  title,
  children,
  role: roleProp,
  ...props
}: AlertProps) {
  const v = variant ?? 'info';
  const Icon = ICONS[v];
  const defaultRole = v === 'error' ? 'alert' : 'status';

  return (
    <div
      role={roleProp ?? defaultRole}
      className={cn(alertVariants({ variant: v }), className)}
      {...props}
    >
      <Icon className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1">
        {title && (
          <p className="font-medium mb-1">
            <span className="sr-only">{LABELS[v]}: </span>
            {title}
          </p>
        )}
        {children && <div className="text-secondary">{children}</div>}
      </div>
    </div>
  );
}
