import * as React from 'react';
import { ChevronRight } from '../../icons/index.js';
import { cn } from '../../lib/cn.js';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[];
  separator?: React.ReactNode;
}

export function Breadcrumbs({ items, separator, className, ...props }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center', className)} {...props}>
      <ol className="flex items-center flex-wrap gap-1 text-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index} className="flex items-center gap-1">
              {isLast ? (
                <span
                  aria-current="page"
                  className="text-primary font-medium truncate max-w-[200px]"
                  title={item.label}
                >
                  {item.label}
                </span>
              ) : (
                <>
                  <a
                    href={item.href}
                    className={cn(
                      'text-secondary hover:text-primary transition-colors truncate max-w-[200px]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-sm',
                    )}
                    title={item.label}
                  >
                    {item.label}
                  </a>
                  <span aria-hidden="true" className="text-muted">
                    {separator ?? <ChevronRight className="size-3.5" />}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
