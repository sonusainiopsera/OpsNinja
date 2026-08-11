'use client';

import React from 'react';
import Link from 'next/link';
import type { NavGroup as NavGroupConfig, NavItem } from '@/lib/navigation/navConfig';

interface NavGroupProps {
  group: NavGroupConfig;
  activePathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}

function NavIcon({ iconName }: { iconName: string }) {
  // Icon fallback text symbols — replaced by host icon system
  const symbols: Record<string, string> = {
    'layout-dashboard': '⊞',
    inbox:              '📥',
    'building-2':       '🏢',
    clock:              '⏱',
    plug:               '🔌',
  };
  return (
    <span aria-hidden="true" data-icon={iconName} style={{ flexShrink: 0 }}>
      {symbols[iconName] ?? '•'}
    </span>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(href + '/');
}

export function NavGroupComponent({ group, activePathname, collapsed, onNavigate }: NavGroupProps) {
  return (
    <li>
      {!collapsed && (
        <span
          style={{
            display: 'block',
            padding: '0.5rem 0.75rem 0.25rem',
            fontSize: '0.6875rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-nav-group-label, #9ca3af)',
          }}
        >
          {group.label}
        </span>
      )}
      <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {group.items.map(item => (
          <NavItemComponent
            key={item.key}
            item={item}
            active={isActive(activePathname, item.href)}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </li>
  );
}

interface NavItemProps {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}

export function NavItemComponent({ item, active, collapsed, onNavigate }: NavItemProps) {
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? item.label : undefined}
        data-testid={`nav-item-${item.key}`}
        onClick={onNavigate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          padding: collapsed ? '0.625rem 0.75rem' : '0.5rem 0.75rem',
          borderRadius: '0.375rem',
          textDecoration: 'none',
          fontWeight: active ? 600 : 400,
          fontSize: '0.875rem',
          color: active
            ? 'var(--color-nav-active-text, #4f46e5)'
            : 'var(--color-nav-text, #374151)',
          background: active
            ? 'var(--color-nav-active-bg, #eef2ff)'
            : 'transparent',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        <NavIcon iconName={item.iconName} />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    </li>
  );
}
