/**
 * Contact DTOs — WO-027.
 *
 * Single Zod schema used for both API validation (ContactsController) and
 * CSV row validation (ContactImportService) so validation is never duplicated.
 *
 * Email normalisation (lowercase + trim) happens in the transform, so the
 * service always receives a canonical form.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared field definitions
// ---------------------------------------------------------------------------

const emailField = z
  .string()
  .email('Invalid email address')
  .max(254)
  .transform((v) => v.toLowerCase().trim());

const fullNameField = z
  .string()
  .min(1, 'Full name is required')
  .max(200)
  .transform((v) => v.trim());

const jobTitleField = z.string().max(200).transform((v) => v.trim()).optional();

const phoneField = z
  .string()
  .max(50)
  .regex(/^[+\d\s\-().]+$/, 'Invalid phone number format')
  .transform((v) => v.trim())
  .optional();

// ---------------------------------------------------------------------------
// Create contact DTO
// ---------------------------------------------------------------------------

export const CreateContactSchema = z
  .object({
    email:               emailField,
    fullName:            fullNameField,
    jobTitle:            jobTitleField,
    phone:               phoneField,
    portalAccessEnabled: z.boolean().default(false),
  })
  .strict();

export type CreateContactDto = z.infer<typeof CreateContactSchema>;

// ---------------------------------------------------------------------------
// Update contact DTO — optimistic-concurrency version required
// ---------------------------------------------------------------------------

export const UpdateContactSchema = z
  .object({
    version:             z.number().int().min(1),
    fullName:            fullNameField.optional(),
    jobTitle:            jobTitleField,
    phone:               phoneField,
    portalAccessEnabled: z.boolean().optional(),
  })
  .strict();

export type UpdateContactDto = z.infer<typeof UpdateContactSchema>;

// ---------------------------------------------------------------------------
// List contacts query DTO
// ---------------------------------------------------------------------------

export const ListContactsQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit:  z.coerce.number().int().min(1).max(100).default(25),
    status: z.enum(['active', 'suspended', 'inactive']).optional(),
    /** Search by name or email prefix (ILIKE). */
    q:      z.string().max(200).optional(),
  })
  .strict();

export type ListContactsQuery = z.infer<typeof ListContactsQuerySchema>;
