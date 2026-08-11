/**
 * ContactsController — WO-027.
 *
 * Sub-resource of organizations.  All routes are scoped under
 * /api/v1/organizations/:orgId/contacts.
 *
 * Endpoint map:
 *   GET    /                    List contacts (cursor-paginated, filterable)
 *   POST   /                    Create contact
 *   PATCH  /:id                 Update contact (optimistic-concurrency)
 *   POST   /:id/suspend         Suspend contact
 *   POST   /:id/reactivate      Reactivate contact
 *   POST   /:id/primary         Designate primary contact
 *   POST   /import              Bulk CSV import (multipart/form-data)
 *
 * RBAC:
 *   org:read            → GET list
 *   org:manage_contacts → POST, PATCH, POST /:id/*, POST /import
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  Req,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { randomUUID } from 'crypto';

import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { getPrincipalContext } from '../../../observability/request-context';
import { ContactsService } from './contacts.service';
import { ContactImportService } from './contact-import.service';
import {
  CreateContactSchema,
  UpdateContactSchema,
  ListContactsQuerySchema,
  type CreateContactDto,
  type UpdateContactDto,
  type ListContactsQuery,
} from './dto/contact.dto';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB

@Controller('organizations/:orgId/contacts')
export class ContactsController {
  constructor(
    private readonly service: ContactsService,
    private readonly importService: ContactImportService,
  ) {}

  // --------------------------------------------------------------------------
  // GET /api/v1/organizations/:orgId/contacts
  // --------------------------------------------------------------------------

  @Get()
  @RequirePermission('org:read')
  async list(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(ListContactsQuerySchema)) query: ListContactsQuery,
    @Req() req: Request,
  ) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const page = await this.service.list(tenantId, orgId, query);
    return { data: page.data, nextCursor: page.nextCursor, traceId };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/organizations/:orgId/contacts
  // --------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('org:manage_contacts')
  async create(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(CreateContactSchema)) dto: CreateContactDto,
    @Req() req: Request,
  ) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const contact = await this.service.create(tenantId, orgId, dto, traceId);
    return { data: contact, traceId };
  }

  // --------------------------------------------------------------------------
  // PATCH /api/v1/organizations/:orgId/contacts/:id
  // --------------------------------------------------------------------------

  @Patch(':id')
  @RequirePermission('org:manage_contacts')
  async update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateContactSchema)) dto: UpdateContactDto,
    @Req() req: Request,
  ) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const contact = await this.service.update(tenantId, orgId, id, dto, traceId);
    return { data: contact, traceId };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/organizations/:orgId/contacts/:id/suspend
  // --------------------------------------------------------------------------

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org:manage_contacts')
  async suspend(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const contact = await this.service.suspend(tenantId, orgId, id, traceId);
    return { data: contact, traceId };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/organizations/:orgId/contacts/:id/reactivate
  // --------------------------------------------------------------------------

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org:manage_contacts')
  async reactivate(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const contact = await this.service.reactivate(tenantId, orgId, id, traceId);
    return { data: contact, traceId };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/organizations/:orgId/contacts/:id/primary
  // --------------------------------------------------------------------------

  @Post(':id/primary')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org:manage_contacts')
  async designatePrimary(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const result = await this.service.designatePrimary(tenantId, orgId, id, traceId);
    return { data: result, traceId };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/organizations/:orgId/contacts/import
  // --------------------------------------------------------------------------

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org:manage_contacts')
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(
    @Param('orgId') orgId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    if (!file) {
      return {
        imported: 0,
        failed:   0,
        rows:     [],
        traceId,
        error: { code: 'IMPORT_FILE_MISSING', message: 'No file uploaded.' },
      };
    }

    if (file.size > MAX_IMPORT_BYTES) {
      throw new PayloadTooLargeException({
        error: {
          code:    'IMPORT_FILE_TOO_LARGE',
          message: `File exceeds the maximum size of ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`,
        },
      });
    }

    const result = await this.importService.importFromCsv(
      tenantId,
      orgId,
      file.buffer,
      traceId,
    );

    return { ...result, traceId };
  }
}
