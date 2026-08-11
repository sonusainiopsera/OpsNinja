/**
 * Allow-listed field registry.
 *
 * Every filterable field is declared here with:
 *   - column: the SQL column expression (double-quoted for safety)
 *   - sqlType: runtime type for value coercion
 *   - allowedOperators: only these operators compile for this field
 *   - valueSchema: Zod schema validating the condition value
 *   - existsTable/existsJoinColumn: when set, the field compiles to an EXISTS subquery
 *     rather than a direct column predicate (prevents row multiplication for M:N relations)
 *
 * Unknown fields are rejected at validation time and can never reach compile().
 */

import { z } from 'zod';

import {
  RELATIVE_DATE_TOKENS,
  type RelativeDateToken,
  isRelativeDateToken,
} from './clock';
import { type Operator } from './operators';

// ---------------------------------------------------------------------------
// SQL types
// ---------------------------------------------------------------------------

export type SqlType =
  | 'text'
  | 'text_enum'
  | 'uuid'
  | 'timestamp'
  | 'boolean';

// ---------------------------------------------------------------------------
// Value schemas
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid({ message: 'Must be a valid UUID' });
const uuidArraySchema = z.array(uuidSchema).min(1, { message: 'Array must not be empty' });

const iso8601Schema = z.string().refine(
  (v) => {
    if (isRelativeDateToken(v)) return true;
    const d = new Date(v);
    return !isNaN(d.getTime());
  },
  { message: `Must be an ISO-8601 date string or a relative date token: ${RELATIVE_DATE_TOKENS.join(', ')}` },
);

const iso8601RangeSchema = z
  .array(iso8601Schema)
  .length(2, { message: 'between requires exactly two date values [from, to]' });

const textEnumMaker = <T extends [string, ...string[]]>(values: T) =>
  z.enum(values);

// ---------------------------------------------------------------------------
// Status / Priority / SlaState enums
// ---------------------------------------------------------------------------

const STATUS_VALUES = ['open', 'in_progress', 'pending', 'resolved', 'closed'] as const;
const PRIORITY_VALUES = ['P1', 'P2', 'P3', 'P4'] as const;
const SLA_STATE_VALUES = ['ok', 'warning', 'breached', 'paused'] as const;

const statusEnum = textEnumMaker([...STATUS_VALUES]);
const priorityEnum = textEnumMaker([...PRIORITY_VALUES]);
const slaStateEnum = textEnumMaker([...SLA_STATE_VALUES]);

// ---------------------------------------------------------------------------
// FieldEntry definition
// ---------------------------------------------------------------------------

export interface FieldEntry {
  /** SQL column expression — never constructed from user input. */
  column: string;
  sqlType: SqlType;
  allowedOperators: ReadonlyArray<Operator>;
  /** Zod schema for the condition value. For array operators (in/not_in), schema should accept array. */
  scalarValueSchema: z.ZodTypeAny;
  /** Schema for array values (in / not_in). Defaults to scalarValueSchema array if not provided. */
  arrayValueSchema?: z.ZodTypeAny;
  /** Schema for between range: [lower, upper] */
  rangeValueSchema?: z.ZodTypeAny;
  /**
   * When set, the field compiles to:
   *   EXISTS (SELECT 1 FROM <existsTable> WHERE ticket_id = tickets.id AND <existsColumn> = $n)
   * This prevents row multiplication for M:N relationships.
   */
  existsTable?: string;
  existsJoinColumn?: string;
  existsValueColumn?: string;
}

// ---------------------------------------------------------------------------
// Field registry
// ---------------------------------------------------------------------------

export type FieldRegistry = Record<string, FieldEntry>;

export const FIELD_REGISTRY: FieldRegistry = {
  // ── Status ──────────────────────────────────────────────────────────────
  status: {
    column: '"tickets"."status"',
    sqlType: 'text_enum',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    scalarValueSchema: statusEnum,
    arrayValueSchema: z.array(statusEnum).min(1),
  },

  // ── Priority ─────────────────────────────────────────────────────────────
  priority: {
    column: '"tickets"."priority"',
    sqlType: 'text_enum',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    scalarValueSchema: priorityEnum,
    arrayValueSchema: z.array(priorityEnum).min(1),
  },

  // ── Category ─────────────────────────────────────────────────────────────
  category_id: {
    column: '"tickets"."category_id"',
    sqlType: 'uuid',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    scalarValueSchema: uuidSchema,
    arrayValueSchema: uuidArraySchema,
  },

  category_path: {
    column: '"tickets"."category_path"',
    sqlType: 'text',
    allowedOperators: ['eq', 'neq', 'contains', 'is_null', 'is_not_null'],
    scalarValueSchema: z.string().min(1).max(512),
  },

  // ── Tags (EXISTS subquery — avoids row multiplication) ────────────────────
  tag_id: {
    column: '"ticket_tags"."tag_id"',
    sqlType: 'uuid',
    allowedOperators: ['eq', 'in', 'not_in'],
    scalarValueSchema: uuidSchema,
    arrayValueSchema: uuidArraySchema,
    existsTable: 'ticket_tags',
    existsJoinColumn: 'ticket_id',
    existsValueColumn: 'tag_id',
  },

  // ── Assignment group ──────────────────────────────────────────────────────
  assignment_group_id: {
    column: '"tickets"."assignment_group_id"',
    sqlType: 'uuid',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    scalarValueSchema: uuidSchema,
    arrayValueSchema: uuidArraySchema,
  },

  // ── Assignee ──────────────────────────────────────────────────────────────
  assignee_user_id: {
    column: '"tickets"."assignee_id"',
    sqlType: 'uuid',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    scalarValueSchema: uuidSchema,
    arrayValueSchema: uuidArraySchema,
  },

  // ── Organization ──────────────────────────────────────────────────────────
  organization_id: {
    column: '"tickets"."organization_id"',
    sqlType: 'uuid',
    allowedOperators: ['eq', 'neq', 'in', 'not_in'],
    scalarValueSchema: uuidSchema,
    arrayValueSchema: uuidArraySchema,
  },

  // ── SLA state ─────────────────────────────────────────────────────────────
  sla_state: {
    column: '"tickets"."sla_state"',
    sqlType: 'text_enum',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    scalarValueSchema: slaStateEnum,
    arrayValueSchema: z.array(slaStateEnum).min(1),
  },

  // ── Timestamps ───────────────────────────────────────────────────────────
  created_at: {
    column: '"tickets"."created_at"',
    sqlType: 'timestamp',
    allowedOperators: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
    scalarValueSchema: iso8601Schema,
    rangeValueSchema: iso8601RangeSchema,
  },

  updated_at: {
    column: '"tickets"."updated_at"',
    sqlType: 'timestamp',
    allowedOperators: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
    scalarValueSchema: iso8601Schema,
    rangeValueSchema: iso8601RangeSchema,
  },

  resolved_at: {
    column: '"tickets"."resolved_at"',
    sqlType: 'timestamp',
    allowedOperators: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
    scalarValueSchema: iso8601Schema,
    rangeValueSchema: iso8601RangeSchema,
  },

  // ── Boolean flags ─────────────────────────────────────────────────────────
  has_jira_link: {
    column: '"tickets"."has_jira_link"',
    sqlType: 'boolean',
    allowedOperators: ['eq', 'is_null', 'is_not_null'],
    scalarValueSchema: z.boolean(),
  },

  // ── Affected area (EXISTS subquery — avoids row multiplication) ───────────
  affected_area: {
    column: '"ticket_affected_areas"."area_id"',
    sqlType: 'uuid',
    allowedOperators: ['eq', 'in', 'not_in'],
    scalarValueSchema: uuidSchema,
    arrayValueSchema: uuidArraySchema,
    existsTable: 'ticket_affected_areas',
    existsJoinColumn: 'ticket_id',
    existsValueColumn: 'area_id',
  },
} satisfies FieldRegistry;

export type FieldName = keyof typeof FIELD_REGISTRY;

export function isKnownField(field: string): field is FieldName {
  return Object.prototype.hasOwnProperty.call(FIELD_REGISTRY, field);
}

// ---------------------------------------------------------------------------
// Value resolution helper (relative dates → absolute)
// ---------------------------------------------------------------------------

export type DateValue = string | RelativeDateToken;
