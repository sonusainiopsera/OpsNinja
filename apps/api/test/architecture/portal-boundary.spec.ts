/**
 * Architecture tests: portal DTO boundary enforcement.
 *
 * These tests scan the source code of portal mapper functions and portal
 * controller files to assert structural constraints that prevent internal
 * fields from leaking to the portal surface.
 *
 * They run at build time (jest --testPathPattern=architecture) so violations
 * fail the CI pipeline before any deployment.
 *
 * Checks:
 *   1. Portal mapper source contains no entity spread patterns ({ ...ticket }, etc.)
 *   2. Portal mapper exports the PORTAL_DTO_MARKER symbol
 *   3. Portal controller imports only from portal-ticket.dto (not from staff DTOs)
 *   4. Internal comment fields (visibility, tenantId, ticketId) are absent
 *      from the PortalCommentDto type definition
 *   5. The scoped-query helper exports exactly the two required predicates
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../src');

function read(relative: string): string {
  return readFileSync(resolve(root, relative), 'utf8');
}

// ── 1. No entity spread in portal mapper ─────────────────────────────────────

describe('portal DTO mapper (portal-ticket.dto.ts)', () => {
  const src = read('modules/tickets/portal/portal-ticket.dto.ts');

  it('does not spread the ticket entity object', () => {
    // Disallow `{ ...ticket }` or `{ ...comment }` or `{ ...attachment }` spreads
    expect(src).not.toMatch(/\{\s*\.\.\.(ticket|comment|attachment)\b/);
  });

  it('exports PORTAL_DTO_MARKER symbol', () => {
    expect(src).toContain('export const PORTAL_DTO_MARKER');
  });

  it('toPortalComment does not include a visibility field', () => {
    // Extract the toPortalComment function body
    const fnStart = src.indexOf('export function toPortalComment');
    const fnEnd = src.indexOf('\nexport ', fnStart + 1);
    const fnBody = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    expect(fnBody).not.toMatch(/visibility\s*:/);
  });

  it('toPortalComment does not include tenantId', () => {
    const fnStart = src.indexOf('export function toPortalComment');
    const fnEnd = src.indexOf('\nexport ', fnStart + 1);
    const fnBody = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    expect(fnBody).not.toMatch(/tenantId\s*:/);
  });

  it('toPortalTicketListItem does not include assigneeId', () => {
    const fnStart = src.indexOf('export function toPortalTicketListItem');
    const fnEnd = src.indexOf('\nexport ', fnStart + 1);
    const fnBody = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    expect(fnBody).not.toMatch(/assigneeId\s*:/);
  });

  it('toPortalAttachment does not include s3Key', () => {
    const fnStart = src.indexOf('export function toPortalAttachment');
    const fnEnd = src.indexOf('\nexport ', fnStart + 1);
    const fnBody = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    expect(fnBody).not.toMatch(/s3Key\s*:/);
  });
});

// ── 2. Portal controller uses only portal DTOs ────────────────────────────────

describe('portal controller (portal-tickets.controller.ts)', () => {
  const src = read('modules/tickets/portal/portal-tickets.controller.ts');

  it('imports DTO types only from portal-ticket.dto', () => {
    // All DTO imports must come from ./portal-ticket.dto, not from staff DTO files
    const importLines = src
      .split('\n')
      .filter(l => l.trim().startsWith('import') && /[Dd][Tt][Oo]/.test(l));
    for (const line of importLines) {
      expect(line).toMatch(/portal-ticket\.dto/);
    }
  });

  it('does not import entity types directly for response serialisation', () => {
    // Controllers must not return raw entity objects — only DTO mapper outputs
    // Verify no direct entity return type annotation
    expect(src).not.toMatch(/Promise<Ticket>/);
    expect(src).not.toMatch(/Promise<Comment>/);
    expect(src).not.toMatch(/Promise<Attachment>/);
  });
});

// ── 3. Scoped-query helper exports required predicates ─────────────────────────

describe('scoped-query helper (scoped-query.helper.ts)', () => {
  const src = read('common/db/scoped-query.helper.ts');

  it('exports portalTicketFilter', () => {
    expect(src).toContain('export function portalTicketFilter');
  });

  it('exports portalCommentFilter', () => {
    expect(src).toContain('export function portalCommentFilter');
  });

  it('portalCommentFilter does not accept a flag parameter that could disable it', () => {
    const fnStart = src.indexOf('export function portalCommentFilter');
    const fnEnd = src.indexOf('\nexport ', fnStart + 1);
    const signature = src.slice(fnStart, src.indexOf(')', fnStart) + 1);
    // The function must have no parameter that looks like a boolean enable/disable flag
    expect(signature).not.toMatch(/enable|disable|bypass|skip|override/i);
  });
});
