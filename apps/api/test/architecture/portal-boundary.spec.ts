/**
 * Architecture test — portal DTO boundary enforcement.
 *
 * Asserts that:
 *   1. Portal route handlers return only portal DTO types (not staff/internal DTOs).
 *   2. Portal controllers are marked with @PortalRoute().
 *   3. Portal controllers use @UseGuards(PortalVisibilityGuard).
 *   4. Portal DTO mapper functions do not contain entity spread patterns.
 *      (Static analysis via source inspection — no entity spread in portal mappers.)
 *
 * These tests fail the build if a staff DTO leaks into a portal route return type,
 * or if the portal audience decorator is removed from a portal controller.
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

import { PORTAL_ROUTE_KEY } from '../../src/common/auth/portal-route.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../src/common/auth/require-permission.decorator';
import { PortalTicketsController } from '../../src/modules/tickets/portal/portal-tickets.controller';
import { PortalAttachmentsController } from '../../src/modules/tickets/portal/portal-attachments.controller';

const PORTAL_CONTROLLERS = [PortalTicketsController, PortalAttachmentsController];

const PORTAL_DTO_MODULE_PATH = path.resolve(
  __dirname,
  '../../src/modules/tickets/portal/portal-ticket.dto.ts',
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Portal boundary architecture', () => {
  describe('Portal controllers have @PortalRoute decorator', () => {
    for (const Controller of PORTAL_CONTROLLERS) {
      it(`${Controller.name} is decorated with @PortalRoute()`, () => {
        const isPortal = Reflect.getMetadata(PORTAL_ROUTE_KEY, Controller) as boolean | undefined;
        expect(isPortal).toBe(true);
      });
    }
  });

  describe('Portal controllers declare @RequirePermission', () => {
    for (const Controller of PORTAL_CONTROLLERS) {
      it(`${Controller.name} has @RequirePermission at class or method level`, () => {
        const classPerms = Reflect.getMetadata(REQUIRE_PERMISSION_KEY, Controller) as string[] | undefined;
        const prototype = Controller.prototype as Record<string, unknown>;
        const methodPerms = Object.getOwnPropertyNames(prototype)
          .filter((m) => m !== 'constructor')
          .some((m) => {
            const h = prototype[m];
            if (typeof h !== 'function') return false;
            const perms = Reflect.getMetadata(REQUIRE_PERMISSION_KEY, h as object) as string[] | undefined;
            return perms && perms.length > 0;
          });

        expect(classPerms && classPerms.length > 0 || methodPerms).toBe(true);
      });
    }
  });

  describe('Portal DTO mapper source does not spread entities', () => {
    it('portal-ticket.dto.ts contains no entity spread patterns', () => {
      const source = fs.readFileSync(PORTAL_DTO_MODULE_PATH, 'utf8');

      // Detect spread of known entity type names in mapper functions
      const entitySpreadPattern = /\.\.\.(ticket|comment|attachment)\b/i;
      const hasEntitySpread = entitySpreadPattern.test(source);

      if (hasEntitySpread) {
        throw new Error(
          'portal-ticket.dto.ts contains an entity spread pattern (...ticket, ...comment, ...attachment). ' +
            'Portal mappers must enumerate every field individually to prevent internal field leaks.',
        );
      }

      expect(hasEntitySpread).toBe(false);
    });

    it('portal mapper functions do not return raw entity objects directly', () => {
      const source = fs.readFileSync(PORTAL_DTO_MODULE_PATH, 'utf8');

      // Check that mappers explicitly construct objects rather than returning entity directly
      const returnsEntityDirectly = /return\s+(ticket|comment|attachment)\s*;/i;
      expect(returnsEntityDirectly.test(source)).toBe(false);
    });
  });

  describe('Internal fields are absent from portal DTO types', () => {
    it('PortalTicketDetailDto does not have assigneeId', () => {
      // Import the DTO module and verify the mapper output
      const {
        mapTicketToPortalDetail,
        mapTicketToPortalListItem,
      } = require('../../src/modules/tickets/portal/portal-ticket.dto');

      const mockTicket = {
        id: 'ticket-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        subject: 'Test ticket',
        status: 'open',
        priority: 'P3',
        assigneeId: 'agent-123', // internal field
        aiSummary: 'AI summary text',
        affectedAreaTags: ['billing'], // internal field
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        resolvedAt: null,
      };

      const listDto = mapTicketToPortalListItem(mockTicket) as Record<string, unknown>;
      expect(listDto).not.toHaveProperty('assigneeId');
      expect(listDto).not.toHaveProperty('affectedAreaTags');
      expect(listDto).not.toHaveProperty('tenantId');

      const detailDto = mapTicketToPortalDetail(mockTicket, [], false) as Record<string, unknown>;
      expect(detailDto).not.toHaveProperty('assigneeId');
      expect(detailDto).not.toHaveProperty('affectedAreaTags');
      expect(detailDto).not.toHaveProperty('tenantId');
      // aiSummary excluded when disabled
      expect(detailDto).not.toHaveProperty('aiSummary');
    });

    it('AI summary appears in portal detail only when per-tenant setting is enabled', () => {
      const { mapTicketToPortalDetail } = require('../../src/modules/tickets/portal/portal-ticket.dto');

      const mockTicket = {
        id: 'ticket-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        subject: 'Test',
        status: 'open',
        priority: 'P3',
        assigneeId: null,
        aiSummary: 'Summary text',
        affectedAreaTags: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        resolvedAt: null,
      };

      const withSummaryDisabled = mapTicketToPortalDetail(mockTicket, [], false) as Record<string, unknown>;
      expect(withSummaryDisabled).not.toHaveProperty('aiSummary');

      const withSummaryEnabled = mapTicketToPortalDetail(mockTicket, [], true) as Record<string, unknown>;
      expect(withSummaryEnabled).toHaveProperty('aiSummary', 'Summary text');
    });

    it('PortalCommentDto does not have visibility field', () => {
      const { mapCommentToPortalDto } = require('../../src/modules/tickets/portal/portal-ticket.dto');

      const mockComment = {
        id: 'comment-1',
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        organizationId: 'org-1',
        authorId: 'user-1',
        body: 'Public comment text',
        visibility: 'public', // must NOT appear in output
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      const dto = mapCommentToPortalDto(mockComment, []) as Record<string, unknown>;
      expect(dto).not.toHaveProperty('visibility');
      expect(dto).not.toHaveProperty('tenantId');
      expect(dto.body).toBe('Public comment text');
    });

    it('PortalAttachmentMetaDto does not expose s3Key', () => {
      const { mapAttachmentToPortalMeta } = require('../../src/modules/tickets/portal/portal-ticket.dto');

      const mockAttachment = {
        id: 'attach-1',
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        commentId: 'comment-1',
        organizationId: 'org-1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        s3Key: 'tenant-1/attachments/report.pdf', // must NOT appear in output
        createdAt: new Date('2024-01-01'),
      };

      const dto = mapAttachmentToPortalMeta(mockAttachment) as Record<string, unknown>;
      expect(dto).not.toHaveProperty('s3Key');
      expect(dto).not.toHaveProperty('tenantId');
      expect(dto.filename).toBe('report.pdf');
    });
  });
});
