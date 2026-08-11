'use client';

import React from 'react';
import Link from 'next/link';
import { Icon } from '@opsninja/ui-kit';
import type { NavGroup as NavGroupType } from '../../lib/navigation/navConfig';
import { isActive } from '../../lib/navigation/canFor';

interface NavGroupProps {
  group: NavGroupType;
  currentPathname: string;
  collapsed: boolean;
}

export function NavGroup({ group, currentPathname, collapsed }: NavGroupProps) {
  return (
    <div role="group" aria-label={group.label}>
      {!collapsed && (
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-muted, #9ca3af)',
            padding: '12px 16px 4px',
          }}
          aria-hidden="true"
        >
          {group.label}
        </div>
      )}
      <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {group.items.map((item) => {
          const active = isActive(currentPathname, item.href);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                aria-label={collapsed ? item.label : undefined}
                title={collapsed ? item.label : undefined}
                data-nav-item={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: collapsed ? '10px 0' : '8px 16px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  borderRadius: 6,
                  margin: '1px 8px',
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  background: active
                    ? 'var(--color-nav-active-bg, #eff6ff)'
                    : 'none',
                  color: active
                    ? 'var(--color-nav-active-fg, #1d4ed8)'
                    : 'var(--color-nav-fg, #374151)',
                  transition: 'background 0.1s, color 0.1s',
                }}
                onMouseEnter={(e) => {
                  if (!active)
                    (e.currentTarget as HTMLAnchorElement).style.background =
                      'var(--color-nav-hover-bg, #f3f4f6)';
                }}
                onMouseLeave={(e) => {
                  if (!active)
                    (e.currentTarget as HTMLAnchorElement).style.background = 'none';
                }}
              >
                <span aria-hidden="true" style={{ flexShrink: 0 }}>
                  <Icon name={item.iconName as Parameters<typeof Icon>[0]['name']} size={16} />
                </span>
                {!collapsed && <span>{item.label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
