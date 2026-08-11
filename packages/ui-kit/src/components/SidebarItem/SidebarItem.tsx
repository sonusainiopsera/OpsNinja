'use client';

import * as React from 'react';
import { cn } from '../../lib/cn.js';

export interface SidebarItemProps extends React.HTMLAttributes<HTMLElement> {
  icon?: React.ReactNode;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  href?: string;
  as?: React.ElementType;
}

export function SidebarItem({
  icon,
  label,
  active = false,
  collapsed = false,
  href,
  as: Comp = href ? 'a' : 'button',
  className,
  ...props
}: SidebarItemProps) {
  return (
    <Comp
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
        active
          ? 'bg-accent/10 text-accent'
          : 'text-secondary hover:bg-surface-raised hover:text-primary',
        collapsed && 'justify-center px-2',
        className,
      )}
      title={collapsed ? label : undefined}
      {...props}
    >
      {icon && <span className="shrink-0 size-5 flex items-center justify-center">{icon}</span>}
      {!collapsed && <span className="truncate">{label}</span>}
      {collapsed && <span className="sr-only">{label}</span>}
    </Comp>
  );
}
