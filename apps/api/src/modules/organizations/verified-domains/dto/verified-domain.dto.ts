/**
 * DTOs for the verified domain registry (WO-028).
 * All schemas are strict (unknown keys rejected).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// POST /organizations/:orgId/verified-domains
// ---------------------------------------------------------------------------

export const RegisterDomainSchema = z
  .object({
    /**
     * Domain to register. Will be normalised (lowercase, punycode, no trailing dot).
     * Free-mail providers and public suffixes are rejected.
     */
    domain: z.string().trim().min(1).max(253),
    /**
     * When true, any verified subdomain of this domain also maps to this org.
     * e.g. registering 'acme.com' with includeSubdomains=true also binds
     * 'mail.acme.com', 'corp.acme.com', etc.
     */
    includeSubdomains: z.boolean().default(false),
  })
  .strict();

export type RegisterDomainDto = z.infer<typeof RegisterDomainSchema>;

// ---------------------------------------------------------------------------
// POST /organizations/:orgId/verified-domains/:id/override
// ---------------------------------------------------------------------------

export const AdminOverrideSchema = z
  .object({
    /**
     * Mandatory justification for bypassing DNS verification.
     * Stored in the audit record.
     */
    justification: z.string().trim().min(10).max(1000),
  })
  .strict();

export type AdminOverrideDto = z.infer<typeof AdminOverrideSchema>;
