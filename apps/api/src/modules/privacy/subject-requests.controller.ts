/**
 * SubjectRequestsController — WO-096.
 *
 * REST surface for GDPR data-subject rights requests.
 *
 * Endpoint map (all under /api/v1/privacy/subject-requests):
 *   POST /          Raise a new subject request (access|portability|rectification|erasure)
 *   GET  /:id       Poll status, download URL, deferral reason
 *
 * RBAC:
 *   privacy:manage  → staff admin / compliance roles
 *
 * Returns 202 on creation and 404 (not 403) for out-of-tenant request IDs to
 * avoid existence disclosure.
 */

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  NotFoundException,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SubjectRequestService } from './subject-request.service';

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

const CreateSubjectRequestSchema = z
  .object({
    type:        z.enum(['access', 'portability', 'rectification', 'erasure']),
    subjectType: z.enum(['contact', 'portal_user']),
    subjectId:   z.string().uuid(),
    note:        z.string().max(1000).optional(),
  })
  .strict();

type CreateSubjectRequestDto = z.infer<typeof CreateSubjectRequestSchema>;

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('privacy/subject-requests')
export class SubjectRequestsController {
  constructor(private readonly service: SubjectRequestService) {}

  // --------------------------------------------------------------------------
  // POST /api/v1/privacy/subject-requests
  // --------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('privacy:manage')
  async create(
    @Body(new ZodValidationPipe(CreateSubjectRequestSchema)) dto: CreateSubjectRequestDto,
    @Req() req: Request,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const view = await this.service.create(dto);
    return { ...view, traceId };
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/privacy/subject-requests/:id
  // --------------------------------------------------------------------------

  @Get(':id')
  @RequirePermission('privacy:manage')
  async getById(@Param('id') id: string, @Req() req: Request) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const view = await this.service.getById(id);
    if (!view) {
      throw new NotFoundException({
        error: {
          code:    'SUBJECT_REQUEST_NOT_FOUND',
          message: 'Subject request not found.',
          traceId,
        },
      });
    }
    return { data: view, traceId };
  }
}
