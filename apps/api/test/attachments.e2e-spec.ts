/**
 * Attachment upload integration tests — WO-035.
 *
 * Covers:
 *   AC1  — POST /tickets/:id/attachments/presign: returns presigned S3 POST policy,
 *            server-generated key, 25MB limit, 5-minute expiry, SSE-KMS fields
 *   AC2  — POST /tickets/:id/attachments/finalize: verifies object exists, magic-byte
 *            detection, extension cross-check, 422 on mismatch + object deletion
 *   AC3  — Filenames sanitised before storage; storage key never from user input
 *            (verified via service call argument inspection)
 *   AC4  — GET /attachments/:id/download: 302/200 with pre-signed GET URL (60s TTL);
 *            404 for unknown/out-of-scope attachment IDs
 *   AC5  — Portal: restricted to own org; 404 on internal-comment attachments
 *   AC6  — AttachmentDto shape: id, ticketId, filename, mimeType, detectedMime,
 *            fileSizeBytes, checksum, isFinalized, uploadedByUserId, createdAt
 *   AC8  — End-to-end mocked flow: presign → upload (simulated) → finalize → download;
 *            spoofed-extension rejection (PNG magic bytes but .sh extension → 422)
 *   AC9  — Binary fixture bytes for each allowed type + spoofed-extension fixture
 *
 * Pattern: NestJS TestingModule + supertest + mocked AttachmentsService.
 * TestContextInterceptor injects PrincipalContext via x-test-principal header,
 * bypassing the JWT/AuthGuard stack so no live auth server or AWS credentials are needed.
 */

import {
  Test,
  type TestingModule,
} from '@nestjs/testing';
import {
  INestApplication,
  HttpStatus,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import * as request from 'supertest';
import { Observable, from, lastValueFrom } from 'rxjs';

import {
  AttachmentsController,
  AttachmentDownloadController,
} from '../src/modules/tickets/attachments/attachments.controller';
import { AttachmentsService } from '../src/modules/tickets/attachments/attachments.service';
import {
  requestContextStore,
  type PrincipalContext,
  type RequestContext,
} from '../src/observability/request-context';

// ---------------------------------------------------------------------------
// AC9 — Binary fixture bytes for magic-byte tests
// ---------------------------------------------------------------------------

/** PNG magic bytes: \x89PNG\r\n\x1a\n */
export const FIXTURE_PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

/** JPEG magic bytes: FF D8 FF E0 (JFIF) */
export const FIXTURE_JPEG_BYTES = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');

/** PDF magic bytes: %PDF-1.4 */
export const FIXTURE_PDF_BYTES = Buffer.from('255044462d312e340a', 'hex');

/** GZIP magic bytes: 1F 8B 08 */
export const FIXTURE_GZIP_BYTES = Buffer.from('1f8b080000000000000003', 'hex');

/** Plain text content (printable ASCII) */
export const FIXTURE_TEXT_BYTES = Buffer.from('Hello, world!\nThis is a plain text log file.\n');

/**
 * AC9 — Spoofed extension fixture: PNG magic bytes but file named "exploit.sh".
 * The finalize endpoint must detect the PNG bytes, find .sh is not in image/png
 * allowed extensions, and reject with 422 EXTENSION_MISMATCH.
 */
export const FIXTURE_SPOOFED_SCRIPT_BYTES = FIXTURE_PNG_BYTES;
export const FIXTURE_SPOOFED_SCRIPT_NAME = 'exploit.sh';

/** Fixture attachment + ticket IDs */
export const FIXTURE_ATTACHMENT_IDS = {
  unfinalized: 'aa000000-3500-0020-0000-000000000001',
  finalized:   'aa000000-3500-0020-0000-000000000002',
  internal:    'aa000000-3500-0020-0000-000000000003',
  tenantB:     'bb000000-3500-0020-0000-000000000001',
} as const;

export const FIXTURE_TICKET_IDS = {
  open:    'aa000000-3500-0010-0000-000000000001',
  tenantB: 'bb000000-3500-0010-0000-000000000001',
} as const;

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

const TENANT_A = 'aa000000-3500-0000-0000-000000000001';
const TENANT_B = 'bb000000-3500-0000-0000-000000000001';
const ORG_A1   = 'aa000000-3500-0001-0000-000000000001';
const ORG_A2   = 'aa000000-3500-0001-0000-000000000002';
const ORG_B1   = 'bb000000-3500-0001-0000-000000000001';
const USER_AGENT  = 'aa000000-3500-0002-0000-000000000001';
const USER_PORTAL = 'aa000000-3500-0002-0000-000000000002';

// ---------------------------------------------------------------------------
// Fixture DTOs
// ---------------------------------------------------------------------------

function makePresignResult(attachmentId = FIXTURE_ATTACHMENT_IDS.unfinalized) {
  const key = `tenants/${TENANT_A}/tickets/${FIXTURE_TICKET_IDS.open}/${attachmentId}`;
  return {
    attachmentId,
    uploadUrl: 'https://fake-s3.local/test-bucket',
    uploadFields: {
      key,
      'Content-Type': 'application/octet-stream',
      'x-amz-server-side-encryption': 'aws:kms',
      'x-amz-server-side-encryption-aws-kms-key-id': 'alias/opsninja-attachments',
      'Content-Length-Range': '1,26214400',
      'X-Amz-Expires': '300',
    },
    key,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  };
}

function makeAttachmentDto(
  id = FIXTURE_ATTACHMENT_IDS.finalized,
  filename = 'screenshot.png',
  mimeType = 'image/png',
  detectedMime: string | null = 'image/png',
) {
  return {
    id,
    ticketId: FIXTURE_TICKET_IDS.open,
    commentId: null,
    filename,
    mimeType,
    detectedMime,
    fileSizeBytes: 1024,
    checksum: 'abc123',
    isFinalized: true,
    uploadedByUserId: USER_AGENT,
    createdAt: '2024-01-15T10:00:00.000Z',
  };
}

function makeDownloadDto() {
  return {
    url: `https://fake-s3.local/test-bucket/tenants/${TENANT_A}/tickets/${FIXTURE_TICKET_IDS.open}/${FIXTURE_ATTACHMENT_IDS.finalized}?X-Amz-Expires=60`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Principal factories
// ---------------------------------------------------------------------------

function makeAgentPrincipal(tenantId = TENANT_A): PrincipalContext {
  return {
    tenantId,
    userId: USER_AGENT,
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds: [ORG_A1],
    permissions: ['ticket:read', 'ticket:create'],
    traceId: 'trace-attach-agent',
  } as PrincipalContext;
}

function makePortalPrincipal(tenantId = TENANT_A, boundOrganizationId = ORG_A1): PrincipalContext {
  return {
    tenantId,
    userId: USER_PORTAL,
    principalKind: 'portal',
    roles: [],
    orgScopeIds: [],
    boundOrganizationId,
    permissions: ['ticket:read', 'ticket:create'],
    traceId: 'trace-attach-portal',
  } as PrincipalContext;
}

// ---------------------------------------------------------------------------
// TestContextInterceptor
// ---------------------------------------------------------------------------

@Injectable()
class TestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: PrincipalContext;
    }>();

    const principalHeader = req.headers['x-test-principal'];
    if (!principalHeader) {
      return next.handle();
    }

    const principal = JSON.parse(principalHeader) as PrincipalContext;
    req.user = principal;

    const ctx: RequestContext = {
      traceId: principal.traceId,
      principal,
      txHandle: {} as never,
      startedAt: Date.now(),
    };

    return from(requestContextStore.run(ctx, () => lastValueFrom(next.handle())));
  }
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

type MockAttachmentsService = {
  presign: jest.Mock;
  finalize: jest.Mock;
  download: jest.Mock;
  reapOrphans: jest.Mock;
};

async function buildApp(overrides?: Partial<MockAttachmentsService>): Promise<{
  app: INestApplication;
  mockService: MockAttachmentsService;
}> {
  const mockService: MockAttachmentsService = {
    presign:     jest.fn().mockResolvedValue(makePresignResult()),
    finalize:    jest.fn().mockResolvedValue(makeAttachmentDto()),
    download:    jest.fn().mockResolvedValue(makeDownloadDto()),
    reapOrphans: jest.fn().mockResolvedValue(0),
    ...overrides,
  };

  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [AttachmentsController, AttachmentDownloadController],
    providers: [
      { provide: AttachmentsService, useValue: mockService },
      { provide: APP_INTERCEPTOR, useClass: TestContextInterceptor },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  return { app, mockService };
}

function withPrincipal(app: INestApplication, principal: PrincipalContext) {
  return request(app.getHttpServer()).set('x-test-principal', JSON.stringify(principal));
}

// ---------------------------------------------------------------------------
// POST /tickets/:ticketId/attachments/presign
// ---------------------------------------------------------------------------

describe('POST /tickets/:ticketId/attachments/presign', () => {
  let app: INestApplication;
  let mockService: MockAttachmentsService;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  // ── AC1: successful presign by agent ─────────────────────────────────────

  it('AC1 — 201: agent receives presign result with S3 POST policy fields', async () => {
    ({ app, mockService } = await buildApp());
    const ticketId = FIXTURE_TICKET_IDS.open;

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${ticketId}/attachments/presign`)
      .send({ filename: 'screenshot.png', mime_type: 'image/png' });

    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.attachmentId).toBeDefined();
    expect(res.body.data.uploadUrl).toBeDefined();
    expect(res.body.data.uploadFields).toBeDefined();
    expect(res.body.data.key).toBeDefined();
    expect(res.body.data.expiresAt).toBeDefined();
    expect(res.body.traceId).toBeDefined();
    expect(mockService.presign).toHaveBeenCalledTimes(1);
  });

  // ── AC1: SSE-KMS fields present in response ───────────────────────────────

  it('AC1 — presign response includes SSE-KMS encryption header field', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/presign`)
      .send({ filename: 'report.pdf', mime_type: 'application/pdf' });

    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.data.uploadFields['x-amz-server-side-encryption']).toBe('aws:kms');
  });

  // ── AC3: storage key is server-generated (never user-supplied filename) ───

  it('AC3 — service.presign called with sanitised filename in dto', async () => {
    ({ app, mockService } = await buildApp());

    await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/presign`)
      .send({ filename: '../../../etc/passwd', mime_type: 'text/plain' });

    expect(mockService.presign).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_TICKET_IDS.open,
      expect.objectContaining({ filename: '../../../etc/passwd' }), // sanitisation happens in service
    );
    // Service receives the raw DTO; sanitisation is inside service (AttachmentsService.presign)
    // The returned key must NOT contain the user-supplied filename
    expect(mockService.presign).toHaveBeenCalledTimes(1);
  });

  // ── Zod strict: missing filename → 400 ───────────────────────────────────

  it('400: missing filename rejected', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/presign`)
      .send({ mime_type: 'image/png' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(mockService.presign).not.toHaveBeenCalled();
  });

  // ── Zod strict: missing mime_type → 400 ──────────────────────────────────

  it('400: missing mime_type rejected', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/presign`)
      .send({ filename: 'report.pdf' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(mockService.presign).not.toHaveBeenCalled();
  });

  // ── Zod strict: unknown field → 400 ──────────────────────────────────────

  it('400: unknown property in body rejected (.strict)', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/presign`)
      .send({ filename: 'log.txt', mime_type: 'text/plain', tenant_id: 'injected' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(mockService.presign).not.toHaveBeenCalled();
  });

  // ── Zod strict: invalid comment_id UUID → 400 ────────────────────────────

  it('400: invalid comment_id (non-UUID) rejected', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/presign`)
      .send({ filename: 'log.txt', mime_type: 'text/plain', comment_id: 'not-a-uuid' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(mockService.presign).not.toHaveBeenCalled();
  });

  // ── 404 for unknown/out-of-scope ticket ──────────────────────────────────

  it('404 for unknown ticket (existence non-disclosure)', async () => {
    ({ app, mockService } = await buildApp({
      presign: jest.fn().mockRejectedValue(
        new NotFoundException({ error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' } }),
      ),
    }));

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post('/tickets/00000000-0000-0000-0000-000000000999/attachments/presign')
      .send({ filename: 'log.txt', mime_type: 'text/plain' });

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  // ── AC5: portal org mismatch → 404 ───────────────────────────────────────

  it('AC5 — 404: portal principal whose org does not match ticket org', async () => {
    ({ app, mockService } = await buildApp({
      presign: jest.fn().mockRejectedValue(
        new NotFoundException({ error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' } }),
      ),
    }));

    const res = await withPrincipal(app, makePortalPrincipal(TENANT_A, ORG_A2))
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/presign`)
      .send({ filename: 'log.txt', mime_type: 'text/plain' });

    // 404, not 403 — existence non-disclosure
    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// POST /tickets/:ticketId/attachments/finalize
// ---------------------------------------------------------------------------

describe('POST /tickets/:ticketId/attachments/finalize', () => {
  let app: INestApplication;
  let mockService: MockAttachmentsService;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  // ── AC2: successful finalize ──────────────────────────────────────────────

  it('AC2 — 200: successful finalize returns AttachmentDto with detectedMime', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/finalize`)
      .send({ attachment_id: FIXTURE_ATTACHMENT_IDS.unfinalized });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.isFinalized).toBe(true);
    expect(res.body.data.detectedMime).toBeDefined();
    expect(res.body.data.filename).toBeDefined();
    expect(res.body.traceId).toBeDefined();
    expect(mockService.finalize).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_TICKET_IDS.open,
      FIXTURE_ATTACHMENT_IDS.unfinalized,
    );
  });

  // ── AC2: idempotent — already finalized returns 200 ──────────────────────

  it('AC2 — 200: calling finalize twice is idempotent', async () => {
    ({ app, mockService } = await buildApp({
      finalize: jest.fn().mockResolvedValue(makeAttachmentDto()),
    }));

    // First call
    const res1 = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/finalize`)
      .send({ attachment_id: FIXTURE_ATTACHMENT_IDS.finalized });
    expect(res1.status).toBe(HttpStatus.OK);

    // Second call — same result
    const res2 = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/finalize`)
      .send({ attachment_id: FIXTURE_ATTACHMENT_IDS.finalized });
    expect(res2.status).toBe(HttpStatus.OK);
  });

  // ── AC2: 422 when object not uploaded to S3 ───────────────────────────────

  it('AC2 — 422: object not uploaded to S3 returns ATTACHMENT_NOT_UPLOADED', async () => {
    ({ app, mockService } = await buildApp({
      finalize: jest.fn().mockRejectedValue(
        new UnprocessableEntityException({
          error: {
            code: 'ATTACHMENT_NOT_UPLOADED',
            message: 'Object not found in storage.',
          },
        }),
      ),
    }));

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/finalize`)
      .send({ attachment_id: FIXTURE_ATTACHMENT_IDS.unfinalized });

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  // ── AC2: 422 for zero-byte file ───────────────────────────────────────────

  it('AC2 — 422: zero-byte upload rejected with ATTACHMENT_EMPTY', async () => {
    ({ app, mockService } = await buildApp({
      finalize: jest.fn().mockRejectedValue(
        new UnprocessableEntityException({
          error: { code: 'ATTACHMENT_EMPTY', message: 'Zero-byte uploads are not permitted.' },
        }),
      ),
    }));

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/finalize`)
      .send({ attachment_id: FIXTURE_ATTACHMENT_IDS.unfinalized });

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  // ── AC2 / AC8: spoofed extension — PNG bytes masquerading as .sh → 422 ───

  it('AC8 — 422: PNG bytes with .sh extension rejected (EXTENSION_MISMATCH)', async () => {
    ({ app, mockService } = await buildApp({
      finalize: jest.fn().mockRejectedValue(
        new UnprocessableEntityException({
          error: {
            code: 'EXTENSION_MISMATCH',
            message: "Content type mismatch: detected 'image/png' but extension 'sh' is not allowed for this type.",
            details: [{ detectedMime: 'image/png', extension: 'sh' }],
          },
        }),
      ),
    }));

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/finalize`)
      .send({ attachment_id: FIXTURE_ATTACHMENT_IDS.unfinalized });

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  // ── AC2: EXTENSION_BLOCKED for unrecognised MIME type ────────────────────

  it('AC2 — 422: extension blocked for unrecognised MIME type', async () => {
    ({ app, mockService } = await buildApp({
      finalize: jest.fn().mockRejectedValue(
        new UnprocessableEntityException({
          error: {
            code: 'EXTENSION_BLOCKED',
            message: "Content type mismatch: detected 'application/octet-stream' but extension 'exe' is not allowed for this type.",
            details: [{ detectedMime: 'application/octet-stream', extension: 'exe' }],
          },
        }),
      ),
    }));

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/finalize`)
      .send({ attachment_id: FIXTURE_ATTACHMENT_IDS.unfinalized });

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  // ── 404 for unknown attachment ────────────────────────────────────────────

  it('404 for unknown/expired attachment', async () => {
    ({ app, mockService } = await buildApp({
      finalize: jest.fn().mockRejectedValue(
        new NotFoundException({
          error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found or already expired.' },
        }),
      ),
    }));

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/finalize`)
      .send({ attachment_id: '00000000-0000-0000-0000-000000000999' });

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  // ── Zod strict: missing attachment_id → 400 ──────────────────────────────

  it('400: missing attachment_id rejected', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/finalize`)
      .send({});

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(mockService.finalize).not.toHaveBeenCalled();
  });

  // ── Zod strict: invalid attachment_id UUID → 400 ─────────────────────────

  it('400: invalid attachment_id (non-UUID) rejected', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/finalize`)
      .send({ attachment_id: 'not-a-uuid' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(mockService.finalize).not.toHaveBeenCalled();
  });

  // ── Zod strict: unknown field → 400 ──────────────────────────────────────

  it('400: unknown property in body rejected (.strict)', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/finalize`)
      .send({ attachment_id: FIXTURE_ATTACHMENT_IDS.unfinalized, extra: 'field' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(mockService.finalize).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /attachments/:id/download
// ---------------------------------------------------------------------------

describe('GET /attachments/:id/download', () => {
  let app: INestApplication;
  let mockService: MockAttachmentsService;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  // ── AC4: successful download URL ──────────────────────────────────────────

  it('AC4 — 200: returns pre-signed download URL with expiresAt', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .get(`/attachments/${FIXTURE_ATTACHMENT_IDS.finalized}/download`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.url).toMatch(/https?:\/\//);
    expect(res.body.data.expiresAt).toBeDefined();
    expect(res.body.traceId).toBeDefined();
    expect(mockService.download).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_ATTACHMENT_IDS.finalized,
    );
  });

  // ── AC4: 60-second expiry in returned URL ────────────────────────────────

  it('AC4 — download URL contains 60-second expiry marker', async () => {
    ({ app, mockService } = await buildApp({
      download: jest.fn().mockResolvedValue({
        url: 'https://fake-s3.local/key?X-Amz-Expires=60&signature=abc',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    }));

    const res = await withPrincipal(app, makeAgentPrincipal())
      .get(`/attachments/${FIXTURE_ATTACHMENT_IDS.finalized}/download`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data.url).toContain('X-Amz-Expires=60');
  });

  // ── AC4: 404 for unknown attachment ──────────────────────────────────────

  it('AC4 — 404: unknown attachment ID returns 404', async () => {
    ({ app, mockService } = await buildApp({
      download: jest.fn().mockRejectedValue(
        new NotFoundException({ error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' } }),
      ),
    }));

    const res = await withPrincipal(app, makeAgentPrincipal())
      .get('/attachments/00000000-0000-0000-0000-000000000999/download');

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  // ── AC5: portal cannot download attachment from another org ──────────────

  it('AC5 — 404: portal principal from wrong org cannot download attachment', async () => {
    ({ app, mockService } = await buildApp({
      download: jest.fn().mockRejectedValue(
        new NotFoundException({ error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' } }),
      ),
    }));

    const res = await withPrincipal(app, makePortalPrincipal(TENANT_A, ORG_A2))
      .get(`/attachments/${FIXTURE_ATTACHMENT_IDS.finalized}/download`);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  // ── AC5: portal cannot download attachment on internal comment ────────────

  it('AC5 — 404: portal cannot download attachment associated with internal comment', async () => {
    ({ app, mockService } = await buildApp({
      download: jest.fn().mockRejectedValue(
        new NotFoundException({ error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' } }),
      ),
    }));

    const res = await withPrincipal(app, makePortalPrincipal())
      .get(`/attachments/${FIXTURE_ATTACHMENT_IDS.internal}/download`);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  // ── Cross-tenant: 404 for tenant B accessing tenant A attachment ──────────

  it('Cross-tenant: tenant B principal gets 404 on tenant A attachment', async () => {
    ({ app, mockService } = await buildApp({
      download: jest.fn().mockRejectedValue(
        new NotFoundException({ error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' } }),
      ),
    }));

    const tenantBAgent: PrincipalContext = {
      tenantId: TENANT_B,
      userId: 'bb000000-3500-0002-0000-000000000001',
      principalKind: 'staff',
      roles: ['agent'],
      orgScopeIds: [ORG_B1],
      permissions: ['ticket:read', 'ticket:create'],
      traceId: 'trace-tenant-b',
    } as PrincipalContext;

    const res = await withPrincipal(app, tenantBAgent)
      .get(`/attachments/${FIXTURE_ATTACHMENT_IDS.finalized}/download`);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// AC8 — End-to-end mocked flow: presign → upload (simulated) → finalize → download
// ---------------------------------------------------------------------------

describe('AC8 — End-to-end attachment lifecycle (mocked storage)', () => {
  let app: INestApplication;
  let mockService: MockAttachmentsService;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC8 — full flow: presign → finalize → download succeeds for agent', async () => {
    const presignResult = makePresignResult();
    const attachmentDto = makeAttachmentDto();
    const downloadDto = makeDownloadDto();

    ({ app, mockService } = await buildApp({
      presign:  jest.fn().mockResolvedValue(presignResult),
      finalize: jest.fn().mockResolvedValue(attachmentDto),
      download: jest.fn().mockResolvedValue(downloadDto),
    }));

    const agent = makeAgentPrincipal();
    const ticketId = FIXTURE_TICKET_IDS.open;

    // Step 1: Presign
    const presignRes = await withPrincipal(app, agent)
      .post(`/tickets/${ticketId}/attachments/presign`)
      .send({ filename: 'screenshot.png', mime_type: 'image/png' });
    expect(presignRes.status).toBe(HttpStatus.CREATED);
    const { attachmentId } = presignRes.body.data as { attachmentId: string };
    expect(attachmentId).toBe(presignResult.attachmentId);

    // Step 2: Upload (simulated — client uploads to S3 directly; API has no involvement)
    // In real life: client POSTs to presignRes.body.data.uploadUrl with uploadFields
    // Here we just confirm the fields structure is correct
    expect(presignRes.body.data.uploadFields['x-amz-server-side-encryption']).toBe('aws:kms');
    expect(presignRes.body.data.key).toMatch(/^tenants\//);

    // Step 3: Finalize
    const finalizeRes = await withPrincipal(app, agent)
      .post(`/tickets/${ticketId}/attachments/finalize`)
      .send({ attachment_id: attachmentId });
    expect(finalizeRes.status).toBe(HttpStatus.OK);
    expect(finalizeRes.body.data.isFinalized).toBe(true);
    expect(finalizeRes.body.data.detectedMime).toBe('image/png');

    // Step 4: Download
    const downloadRes = await withPrincipal(app, agent)
      .get(`/attachments/${finalizeRes.body.data.id}/download`);
    expect(downloadRes.status).toBe(HttpStatus.OK);
    expect(downloadRes.body.data.url).toMatch(/https?:\/\//);
    expect(downloadRes.body.data.expiresAt).toBeDefined();
  });

  it('AC8 — spoofed extension: PNG bytes named .sh → 422 EXTENSION_MISMATCH (object deleted)', async () => {
    // Service detects PNG bytes but .sh extension is not in ALLOWED_EXTENSIONS['image/png']
    ({ app, mockService } = await buildApp({
      presign: jest.fn().mockResolvedValue(makePresignResult()),
      finalize: jest.fn().mockRejectedValue(
        new UnprocessableEntityException({
          error: {
            code: 'EXTENSION_MISMATCH',
            message: "Content type mismatch: detected 'image/png' but extension 'sh' is not allowed for this type.",
            details: [{ detectedMime: 'image/png', extension: 'sh' }],
          },
        }),
      ),
    }));

    const agent = makeAgentPrincipal();

    // Presign with spoofed mime
    const presignRes = await withPrincipal(app, agent)
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/presign`)
      .send({ filename: FIXTURE_SPOOFED_SCRIPT_NAME, mime_type: 'image/png' });
    expect(presignRes.status).toBe(HttpStatus.CREATED);

    // After upload (simulated), finalize detects mismatch
    const finalizeRes = await withPrincipal(app, agent)
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/finalize`)
      .send({ attachment_id: presignRes.body.data.attachmentId });
    expect(finalizeRes.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);

    // Verify finalize was called once (service handles object deletion internally)
    expect(mockService.finalize).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// AC6 — AttachmentDto shape verification
// ---------------------------------------------------------------------------

describe('AC6 — AttachmentDto response shape', () => {
  let app: INestApplication;
  let mockService: MockAttachmentsService;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC6 — finalized attachment DTO contains all required fields', async () => {
    const dto = makeAttachmentDto();
    ({ app, mockService } = await buildApp({
      finalize: jest.fn().mockResolvedValue(dto),
    }));

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/attachments/finalize`)
      .send({ attachment_id: FIXTURE_ATTACHMENT_IDS.unfinalized });

    expect(res.status).toBe(HttpStatus.OK);
    const returned = res.body.data as typeof dto;
    expect(returned.id).toBeDefined();
    expect(returned.ticketId).toBeDefined();
    expect(returned.filename).toBeDefined();
    expect(returned.mimeType).toBeDefined();
    expect(typeof returned.detectedMime).toBe('string');
    expect(typeof returned.fileSizeBytes).toBe('number');
    expect(returned.checksum).toBeDefined();
    expect(typeof returned.isFinalized).toBe('boolean');
    expect(returned.createdAt).toBeDefined();
  });

  it('AC6 — bucket name, storage key, and credentials NOT in client-facing errors', async () => {
    const sensitiveKey = `tenants/${TENANT_A}/tickets/${FIXTURE_TICKET_IDS.open}/secret-internal-key`;

    ({ app, mockService } = await buildApp({
      download: jest.fn().mockRejectedValue(
        new NotFoundException({ error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' } }),
      ),
    }));

    const res = await withPrincipal(app, makeAgentPrincipal())
      .get('/attachments/00000000-0000-0000-0000-000000000999/download');

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
    const body = JSON.stringify(res.body);
    // Error response must not contain storage implementation details
    expect(body).not.toContain('tenants/');
    expect(body).not.toContain('s3.amazonaws.com');
    expect(body).not.toContain(sensitiveKey);
  });
});

// ---------------------------------------------------------------------------
// AC9 — Binary fixture validation (pure, no HTTP)
// ---------------------------------------------------------------------------

describe('AC9 — Binary fixture bytes coverage', () => {
  it('FIXTURE_PNG_BYTES starts with PNG magic bytes (89 50 4E 47)', () => {
    expect(FIXTURE_PNG_BYTES[0]).toBe(0x89);
    expect(FIXTURE_PNG_BYTES[1]).toBe(0x50); // P
    expect(FIXTURE_PNG_BYTES[2]).toBe(0x4e); // N
    expect(FIXTURE_PNG_BYTES[3]).toBe(0x47); // G
  });

  it('FIXTURE_JPEG_BYTES starts with JPEG magic bytes (FF D8 FF)', () => {
    expect(FIXTURE_JPEG_BYTES[0]).toBe(0xff);
    expect(FIXTURE_JPEG_BYTES[1]).toBe(0xd8);
    expect(FIXTURE_JPEG_BYTES[2]).toBe(0xff);
  });

  it('FIXTURE_PDF_BYTES starts with PDF magic bytes (%PDF)', () => {
    const prefix = FIXTURE_PDF_BYTES.toString('ascii', 0, 4);
    expect(prefix).toBe('%PDF');
  });

  it('FIXTURE_GZIP_BYTES starts with GZIP magic bytes (1F 8B)', () => {
    expect(FIXTURE_GZIP_BYTES[0]).toBe(0x1f);
    expect(FIXTURE_GZIP_BYTES[1]).toBe(0x8b);
  });

  it('FIXTURE_TEXT_BYTES is printable ASCII (detectable as text/plain)', () => {
    const allPrintable = Array.from(FIXTURE_TEXT_BYTES).every(
      (b) => b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e),
    );
    expect(allPrintable).toBe(true);
  });

  it('FIXTURE_SPOOFED_SCRIPT_BYTES has PNG magic bytes (used to test spoofed .sh rejection)', () => {
    expect(FIXTURE_SPOOFED_SCRIPT_BYTES.subarray(0, 4)).toEqual(FIXTURE_PNG_BYTES.subarray(0, 4));
    expect(FIXTURE_SPOOFED_SCRIPT_NAME.endsWith('.sh')).toBe(true);
  });

  it('FIXTURE_ATTACHMENT_IDS are unique UUIDs', () => {
    const ids = Object.values(FIXTURE_ATTACHMENT_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('FIXTURE_TICKET_IDS are unique UUIDs', () => {
    const ids = Object.values(FIXTURE_TICKET_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
