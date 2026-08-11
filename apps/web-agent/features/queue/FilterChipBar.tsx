'use client';

/**
 * FilterChipBar — displays active filter conditions as removable chips.
 *
 * Each chip shows "field operator value" in human-readable form.
 * Clicking × removes that condition from the AST.
 * An "Add filter" button opens the AddFilterDrawer.
 */

import React from 'react';
import type { FilterAst, GroupNode, ConditionNodeType } from '@opsninja/filter-compiler';
import { FIELD_REGISTRY } from '@opsninja/filter-compiler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectConditions(
  node: FilterAst,
  path: number[] = [],
): Array<{ condition: ConditionNodeType; path: number[] }> {
  if (node.type === 'condition') {
    return [{ condition: node, path }];
  }
  return node.children.flatMap((child, i) =>
    collectConditions(child, [...path, i]),
  );
}

function removeAtPath(node: FilterAst, path: number[]): FilterAst | null {
  if (path.length === 0) return null;
  if (node.type !== 'group') return null;
  const [head, ...rest] = path;
  if (rest.length === 0) {
    const nextChildren = node.children.filter((_, i) => i !== head);
    if (nextChildren.length === 0) return null;
    if (nextChildren.length === 1 && nextChildren[0]!.type === 'condition') {
      return nextChildren[0]!;
    }
    return { ...node, children: nextChildren } as GroupNode;
  }
  const nextChildren = node.children.map((child, i) =>
    i === head ? removeAtPath(child, rest) : child,
  );
  const filtered = nextChildren.filter(Boolean) as FilterAst[];
  if (filtered.length === 0) return null;
  if (filtered.length === 1) return filtered[0]!;
  return { ...node, children: filtered } as GroupNode;
}

function humanLabel(field: string, operator: string, value: unknown): string {
  const label = field.replace(/_/g, ' ');
  const op =
    operator === 'eq' ? '='
    : operator === 'neq' ? '≠'
    : operator === 'in' ? 'in'
    : operator === 'not_in' ? 'not in'
    : operator === 'gt' ? '>'
    : operator === 'gte' ? '>='
    : operator === 'lt' ? '<'
    : operator === 'lte' ? '<='
    : operator === 'contains' ? 'contains'
    : operator === 'is_null' ? 'is empty'
    : operator === 'is_not_null' ? 'is not empty'
    : operator;
  if (operator === 'is_null' || operator === 'is_not_null') {
    return `${label} ${op}`;
  }
  const valStr = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  return `${label} ${op} ${valStr}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FilterChipBarProps {
  filter: FilterAst | null;
  onChange: (next: FilterAst | null) => void;
  onAddFilter: () => void;
}

export function FilterChipBar({ filter, onChange, onAddFilter }: FilterChipBarProps) {
  const conditions = filter ? collectConditions(filter) : [];

  return (
    <div
      role="group"
      aria-label="Active filters"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        padding: '6px 0',
      }}
    >
      {conditions.map(({ condition, path }, idx) => {
        const isAllowed = condition.field in FIELD_REGISTRY;
        return (
          <span
            key={idx}
            role="status"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              borderRadius: 99,
              fontSize: 12,
              fontWeight: 500,
              background: isAllowed
                ? 'var(--color-primary-soft, #eef2ff)'
                : 'var(--color-bg-alt, #f3f4f6)',
              color: isAllowed
                ? 'var(--color-primary, #4f46e5)'
                : 'var(--color-muted, #6b7280)',
              border: `1px solid ${isAllowed ? 'var(--color-primary-muted, #c7d2fe)' : 'var(--color-border, #e5e7eb)'}`,
              maxWidth: 280,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={humanLabel(condition.field, condition.operator, condition.value)}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {humanLabel(condition.field, condition.operator, condition.value)}
            </span>
            <button
              type="button"
              aria-label={`Remove filter: ${humanLabel(condition.field, condition.operator, condition.value)}`}
              onClick={() => {
                const next = filter ? removeAtPath(filter, path) : null;
                onChange(next);
              }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0 2px',
                fontSize: 14,
                lineHeight: 1,
                color: 'inherit',
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </span>
        );
      })}

      <button
        type="button"
        onClick={onAddFilter}
        aria-label="Add filter"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 10px',
          borderRadius: 99,
          fontSize: 12,
          fontWeight: 500,
          background: 'transparent',
          border: '1px dashed var(--color-border, #d1d5db)',
          cursor: 'pointer',
          color: 'var(--color-muted, #6b7280)',
        }}
        onFocus={(e) => (e.currentTarget.style.outline = '2px solid var(--color-primary, #4f46e5)')}
        onBlur={(e) => (e.currentTarget.style.outline = 'none')}
      >
        + Add filter
      </button>

      {conditions.length > 0 && (
        <button
          type="button"
          aria-label="Clear all filters"
          onClick={() => onChange(null)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--color-muted, #6b7280)',
            textDecoration: 'underline',
          }}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
