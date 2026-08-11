'use client';

import * as React from 'react';
import { cn } from '../../lib/cn.js';
import { Label } from '../Label/Label.js';

export interface FormFieldContextValue {
  id: string;
  hintId: string;
  errorId: string;
  invalid: boolean;
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

export function useFormField(): FormFieldContextValue {
  const ctx = React.useContext(FormFieldContext);
  if (!ctx) throw new Error('useFormField must be used within FormField');
  return ctx;
}

export interface FormFieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function FormField({ label, hint, error, required, className, children }: FormFieldProps) {
  const id = React.useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = Boolean(error);

  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <FormFieldContext.Provider value={{ id, hintId, errorId, invalid }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        {label && (
          <Label htmlFor={id}>
            {label}
            {required && (
              <span className="text-danger ml-0.5" aria-hidden="true">*</span>
            )}
          </Label>
        )}
        {React.Children.map(children, (child) => {
          if (!React.isValidElement(child)) return child;
          return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
            id,
            'aria-describedby': describedBy || undefined,
            'aria-invalid': invalid ? true : undefined,
            invalid: invalid || undefined,
          });
        })}
        {hint && !error && (
          <p id={hintId} className="text-xs text-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="flex items-center gap-1 text-xs text-danger">
            <span aria-hidden="true">✕</span>
            {error}
          </p>
        )}
      </div>
    </FormFieldContext.Provider>
  );
}
