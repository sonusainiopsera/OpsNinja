'use client';

import React from 'react';

const pulse: React.CSSProperties = {
  background: 'linear-gradient(90deg, var(--color-bg-alt,#f3f4f6) 25%, var(--color-bg-muted,#e5e7eb) 50%, var(--color-bg-alt,#f3f4f6) 75%)',
  backgroundSize: '200% 100%',
  animation: 'skeleton-pulse 1.4s ease-in-out infinite',
  borderRadius: 4,
};

export function SidebarSkeleton() {
  return (
    <aside aria-label="Loading navigation" style={{ width: 240, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{ ...pulse, height: 32, borderRadius: 6 }} />
      ))}
    </aside>
  );
}

export function TopBarSkeleton() {
  return (
    <div aria-label="Loading header" style={{ height: 56, display: 'flex', alignItems: 'center', gap: 16, padding: '0 16px' }}>
      <div style={{ ...pulse, width: 200, height: 28, borderRadius: 6 }} />
      <div style={{ flex: 1 }} />
      <div style={{ ...pulse, width: 80, height: 28, borderRadius: 6 }} />
    </div>
  );
}

export function UserMenuSkeleton() {
  return (
    <div aria-label="Loading user" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
      <div style={{ ...pulse, width: 28, height: 28, borderRadius: '50%' }} />
      <div style={{ ...pulse, width: 80, height: 16, borderRadius: 4 }} />
    </div>
  );
}

export function TenantSwitcherSkeleton() {
  return <div aria-label="Loading organization" style={{ ...pulse, width: 180, height: 32, borderRadius: 6 }} />;
}
