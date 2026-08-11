/**
 * Organizations API types — WO-029.
 *
 * Mirror server DTOs so client and server shapes cannot silently drift.
 * These cover organizations, contacts, custom field definitions, and
 * agent-scoping; all are consumed by the Organizations management page.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type OrgTier = 'free' | 'starter' | 'growth' | 'enterprise';
export type OrgStatus = 'active' | 'inactive' | 'suspended';
export type ContactStatus = 'active' | 'suspended' | 'inactive';
export type CustomFieldDataType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'multi_select';

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export interface Organization {
  id: string;
  tenantId: string;
  name: string;
  tier: OrgTier;
  region: string | null;
  status: OrgStatus;
  primaryContactId: string | null;
  slaAttainmentPct: number | null;   // 0–100
  openTicketCount: number;
  domain: string | null;
  avatarUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationsListResponse {
  data: Organization[];
  nextCursor: string | null;
}

export interface OrganizationResponse {
  data: Organization;
}

// ---------------------------------------------------------------------------
// OrgContact
// ---------------------------------------------------------------------------

export interface OrgContact {
  id: string;
  tenantId: string;
  organizationId: string;
  email: string;
  fullName: string;
  jobTitle: string | null;
  phone: string | null;
  portalAccessEnabled: boolean;
  status: ContactStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContactsListResponse {
  data: OrgContact[];
  nextCursor: string | null;
}

export interface ContactResponse {
  data: OrgContact;
}

// ---------------------------------------------------------------------------
// Custom field definitions
// ---------------------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
}

export interface CustomFieldDef {
  id: string;
  tenantId: string;
  key: string;
  label: string;
  dataType: CustomFieldDataType;
  required: boolean;
  appliesToTier: OrgTier[] | null;  // null = applies to all
  options: SelectOption[] | null;   // only for select / multi_select
  archived: boolean;
  version: number;
  createdAt: string;
}

export interface CustomFieldDefsResponse {
  data: CustomFieldDef[];
}

export interface CustomFieldValue {
  fieldKey: string;
  value: string | number | boolean | string[] | null;
}

export interface OrgMetadataResponse {
  data: CustomFieldValue[];
}

// ---------------------------------------------------------------------------
// Agent scoping
// ---------------------------------------------------------------------------

export interface AgentScope {
  agentId: string;
  agentName: string;
  agentEmail: string;
  assignedAt: string;
}

export interface AgentScopesResponse {
  data: AgentScope[];
}

// ---------------------------------------------------------------------------
// API error envelope
// ---------------------------------------------------------------------------

export interface ApiErrorDetail {
  fieldKey?: string;
  code?: string;
  message?: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
    traceId?: string;
  };
}

// ---------------------------------------------------------------------------
// Filter / query shapes
// ---------------------------------------------------------------------------

export interface OrgListFilters {
  tier?: OrgTier;
  region?: string;
  status?: OrgStatus;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface ContactListFilters {
  status?: ContactStatus;
  q?: string;
  cursor?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Form schemas (Zod) — mirrors server DTOs for identical validation
// ---------------------------------------------------------------------------

export const createOrgSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  tier: z.enum(['free', 'starter', 'growth', 'enterprise']),
  region: z.string().max(100).optional(),
  domain: z.string().max(253).optional(),
});

export type CreateOrgFormValues = z.infer<typeof createOrgSchema>;

export const updateOrgSchema = z.object({
  version: z.number().int().min(1),
  name: z.string().min(1).max(200).optional(),
  tier: z.enum(['free', 'starter', 'growth', 'enterprise']).optional(),
  region: z.string().max(100).nullable().optional(),
  domain: z.string().max(253).nullable().optional(),
});

export type UpdateOrgFormValues = z.infer<typeof updateOrgSchema>;

export const createContactSchema = z.object({
  email: z.string().email('Invalid email').max(254),
  fullName: z.string().min(1, 'Name is required').max(200),
  jobTitle: z.string().max(200).optional(),
  phone: z.string().max(50).regex(/^[+\d\s\-().]+$/, 'Invalid phone format').optional(),
  portalAccessEnabled: z.boolean().default(false),
});

export type CreateContactFormValues = z.infer<typeof createContactSchema>;

export const createCustomFieldSchema = z.object({
  key: z.string()
    .min(1, 'Key is required')
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'Key must be lowercase alphanumeric with underscores'),
  label: z.string().min(1, 'Label is required').max(100),
  dataType: z.enum(['string', 'number', 'boolean', 'date', 'select', 'multi_select']),
  required: z.boolean().default(false),
  appliesToTier: z.array(z.enum(['free', 'starter', 'growth', 'enterprise'])).nullable().default(null),
  options: z.array(z.object({
    value: z.string().min(1).max(100),
    label: z.string().min(1).max(100),
  })).nullable().optional(),
});

export type CreateCustomFieldFormValues = z.infer<typeof createCustomFieldSchema>;
