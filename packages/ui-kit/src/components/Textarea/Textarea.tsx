'use client';

import * as React from 'react';
import { cn } from '../../lib/cn.js';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, 'aria-invalid': ariaInvalid, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-primary',
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
Textarea.displayName = 'Textarea';
