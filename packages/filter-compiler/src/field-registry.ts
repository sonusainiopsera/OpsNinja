import { z } from 'zod';
import type { Operator } from './operators';

// ── Value schemas ─────────────────────────────────────────────────────────────

const uuidSchema = z
  .string()
  .uuid('must be a valid UUID');

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/, 'must be an ISO 8601 date string');

// A date value may be an ISO string or a relative token (resolved at compile time)
const relativeDateTokens = [
  'today', 'yesterday', 'last_7_days', 'last_30_days', 'last_90_days',
  'this_week', 'this_month', 'this_quarter', 'this_year',
] as const;

const dateValueSchema = z.union([isoDateSchema, z.enum(relativeDateTokens)]);
const dateRangeSchema = z.union([
  z.tuple([dateValueSchema, dateValueSchema]),
  z.enum(relativeDateTokens), // token resolves to a range for 'between'
]);

const ticketStatusValues = ['open', 'in_progress', 'pending', 'resolved', 'closed'] as const;
const ticketPriorityValues = ['p1', 'p2', 'p3', 'p4'] as const;
const slaStateValues = ['running', 'warning', 'paused', 'breached'] as const;

// ── Field definition ──────────────────────────────────────────────────────────

export type SqlFieldType = 'enum' | 'uuid' | 'text' | 'timestamp' | 'boolean' | 'exists';

export interface FieldDef {
  /** Column expression used in WHERE clause, e.g. "tickets.status" */
  columnExpr: string;
  /** SQL type category for compile-time behaviour decisions */
  sqlType: SqlFieldType;
  /** Exhaustive list of operators valid for this field */
  allowedOps: readonly Operator[];
  /** Zod schema for the value; is_null/is_not_null bypass this */
  valueSchema: z.ZodTypeAny;
  /**
   * For EXISTS-based fields (tags, affected_areas), the full subquery template.
   * Use `{placeholder}` where the parameterized value should appear.
   */
  existsSubquery?: string;
}

// ── Field registry ────────────────────────────────────────────────────────────

export const FIELD_REGISTRY: Readonly<Record<string, FieldDef>> = {
  status: {
    columnExpr: 'tickets.status',
    sqlType: 'enum',
    allowedOps: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    valueSchema: z.union([
      z.enum(ticketStatusValues),
      z.array(z.enum(ticketStatusValues)).min(1),
    ]),
  },

  priority: {
    columnExpr: 'tickets.priority',
    sqlType: 'enum',
    allowedOps: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    valueSchema: z.union([
      z.enum(ticketPriorityValues),
      z.array(z.enum(ticketPriorityValues)).min(1),
    ]),
  },

  category_id: {
    columnExpr: 'tickets.category_id',
    sqlType: 'uuid',
    allowedOps: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    valueSchema: z.union([uuidSchema, z.array(uuidSchema).min(1)]),
  },

  category_path: {
    columnExpr: 'tickets.category_path',
    sqlType: 'text',
    allowedOps: ['eq', 'neq', 'in', 'not_in', 'contains', 'is_null', 'is_not_null'],
    valueSchema: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  },

  tag_id: {
    columnExpr: '', // resolved via EXISTS subquery
    sqlType: 'exists',
    allowedOps: ['eq', 'in'],
    valueSchema: z.union([uuidSchema, z.array(uuidSchema).min(1)]),
    existsSubquery:
      'EXISTS (SELECT 1 FROM ticket_tags WHERE ticket_tags.ticket_id = tickets.id AND ticket_tags.tag_id = ANY({placeholder}))',
  },

  assignment_group_id: {
    columnExpr: 'tickets.assignment_group_id',
    sqlType: 'uuid',
    allowedOps: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    valueSchema: z.union([uuidSchema, z.array(uuidSchema).min(1)]),
  },

  assignee_user_id: {
    columnExpr: 'tickets.assignee_id',
    sqlType: 'uuid',
    allowedOps: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    valueSchema: z.union([uuidSchema, z.array(uuidSchema).min(1)]),
  },

  organization_id: {
    columnExpr: 'tickets.organization_id',
    sqlType: 'uuid',
    allowedOps: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    valueSchema: z.union([uuidSchema, z.array(uuidSchema).min(1)]),
  },

  sla_state: {
    columnExpr: 'tickets.sla_state',
    sqlType: 'enum',
    allowedOps: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    valueSchema: z.union([
      z.enum(slaStateValues),
      z.array(z.enum(slaStateValues)).min(1),
    ]),
  },

  created_at: {
    columnExpr: 'tickets.created_at',
    sqlType: 'timestamp',
    allowedOps: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
    valueSchema: z.union([dateValueSchema, dateRangeSchema]),
  },

  updated_at: {
    columnExpr: 'tickets.updated_at',
    sqlType: 'timestamp',
    allowedOps: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
    valueSchema: z.union([dateValueSchema, dateRangeSchema]),
  },

  resolved_at: {
    columnExpr: 'tickets.resolved_at',
    sqlType: 'timestamp',
    allowedOps: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
    valueSchema: z.union([dateValueSchema, dateRangeSchema]),
  },

  has_jira_link: {
    columnExpr: 'tickets.jira_ticket_key',
    sqlType: 'boolean',
    allowedOps: ['eq', 'is_null', 'is_not_null'],
    valueSchema: z.boolean(),
  },

  affected_area: {
    columnExpr: '', // resolved via EXISTS subquery
    sqlType: 'exists',
    allowedOps: ['eq', 'in'],
    valueSchema: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    existsSubquery:
      'EXISTS (SELECT 1 FROM ticket_affected_areas WHERE ticket_affected_areas.ticket_id = tickets.id AND ticket_affected_areas.area = ANY({placeholder}))',
  },
} as const;

export function getFieldDef(fieldName: string): FieldDef | undefined {
  return FIELD_REGISTRY[fieldName];
}

export function isKnownField(fieldName: string): boolean {
  return fieldName in FIELD_REGISTRY;
}
