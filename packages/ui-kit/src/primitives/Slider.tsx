import React from 'react';

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  id?: string;
  className?: string;
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  id,
  className,
}: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <div className={className} style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 24 }}>
      {/* Track */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: 4,
          borderRadius: 2,
          background: 'var(--color-border, #e5e7eb)',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 2,
            background: disabled
              ? 'var(--color-fg-disabled, #9ca3af)'
              : 'var(--color-primary, #4f46e5)',
          }}
        />
      </div>
      {/* Native input (accessible + functional) */}
      <input
        id={id}
        type="range"
        role="slider"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          width: '100%',
          opacity: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
          height: 24,
          margin: 0,
        }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {/* Thumb */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: `calc(${pct}% - 8px)`,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: disabled
            ? 'var(--color-fg-disabled, #9ca3af)'
            : 'var(--color-primary, #4f46e5)',
          border: '2px solid var(--color-bg-page, #fff)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
