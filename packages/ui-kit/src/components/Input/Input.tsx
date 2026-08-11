'use client';

import * as React from 'react';
import { cn } from '../../lib/cn.js';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, 'aria-invalid': ariaInvalid, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-border-default bg-surface px-3 py-1 text-sm text-primary',
        'placeholder:text-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        (invalid ?? ariaInvalid) && 'border-danger focus-visible:ring-danger',
        className,
      )}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
