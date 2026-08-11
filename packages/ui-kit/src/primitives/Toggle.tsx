import React from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  id?: string;
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  id,
}: ToggleProps) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        userSelect: 'none',
      }}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        aria-label={!label ? (ariaLabel ?? undefined) : undefined}
        aria-describedby={ariaDescribedBy}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          position: 'absolute',
          opacity: 0,
          width: 0,
          height: 0,
          margin: 0,
        }}
      />
      {/* Visual track */}
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 40,
          height: 22,
          borderRadius: 11,
          background: checked
            ? 'var(--color-primary, #4f46e5)'
            : 'var(--color-border, #d1d5db)',
          position: 'relative',
          transition: 'background 0.2s',
          opacity: disabled ? 0.5 : 1,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'block',
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: 'white',
            position: 'absolute',
            top: 4,
            left: checked ? 22 : 4,
            transition: 'left 0.15s',
          }}
        />
      </span>
      {label && (
        <span style={{ fontSize: 14, color: disabled ? 'var(--color-fg-disabled, #9ca3af)' : 'var(--color-fg-primary, #111827)' }}>
          {label}
        </span>
      )}
    </label>
  );
}
