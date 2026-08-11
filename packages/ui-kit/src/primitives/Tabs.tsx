'use client';

import React, { createContext, useContext, useId, useState, KeyboardEvent } from 'react';

interface TabsContextValue {
  value: string;
  onChange: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsCtx() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs subcomponents must be used inside <Tabs>');
  return ctx;
}

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({ value: controlled, defaultValue = '', onValueChange, children, className }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const baseId = useId();

  const current = controlled ?? internal;
  const onChange = (v: string) => {
    setInternal(v);
    onValueChange?.(v);
  };

  return (
    <TabsContext.Provider value={{ value: current, onChange, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps {
  children: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function TabsList({ children, className, 'aria-label': ariaLabel }: TabsListProps) {
  const { baseId } = useTabsCtx();

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const list = e.currentTarget;
    const triggers = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
    const idx = triggers.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;

    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % triggers.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + triggers.length) % triggers.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = triggers.length - 1;
    else return;

    e.preventDefault();
    triggers[next]?.focus();
    triggers[next]?.click();
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-owns={baseId}
      className={className}
      onKeyDown={handleKeyDown}
      style={{
        display: 'flex',
        borderBottom: '1px solid var(--color-border, #e5e7eb)',
        gap: 0,
      }}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps {
  value: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function TabsTrigger({ value, children, className, disabled }: TabsTriggerProps) {
  const { value: current, onChange, baseId } = useTabsCtx();
  const isSelected = current === value;
  const tabId = `${baseId}-tab-${value}`;
  const panelId = `${baseId}-panel-${value}`;

  return (
    <button
      id={tabId}
      role="tab"
      type="button"
      aria-selected={isSelected}
      aria-controls={panelId}
      tabIndex={isSelected ? 0 : -1}
      disabled={disabled}
      className={className}
      onClick={() => !disabled && onChange(value)}
      style={{
        padding: '10px 16px',
        border: 'none',
        borderBottom: isSelected
          ? '2px solid var(--color-primary, #4f46e5)'
          : '2px solid transparent',
        background: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: isSelected ? 600 : 400,
        fontSize: 14,
        color: isSelected
          ? 'var(--color-primary, #4f46e5)'
          : 'var(--color-fg-secondary, #6b7280)',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  const { value: current, baseId } = useTabsCtx();
  const tabId = `${baseId}-tab-${value}`;
  const panelId = `${baseId}-panel-${value}`;

  if (current !== value) return null;

  return (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={tabId}
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  );
}
