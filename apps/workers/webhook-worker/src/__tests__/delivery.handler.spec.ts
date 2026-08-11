import { Test, TestingModule } from '@nestjs/testing';
import { WebhookDeliveryHandler, ConcurrencyError, RateLimitError, RetryableError, AUTO_DISABLE_THRESHOLD } from '../delivery.handler';
import { WEBHOOK_DB_POOL, WEBHOOK_REDIS } from '../worker.module';
import { ENVELOPE_CIPHER_PORT } from '@opsninja/crypto';

jest.mock('@opsninja/webhooks', () => ({
  dispatch: jest.fn(),
  classifyRetry: jest.fn(),
  buildCanonicalPayload: jest.fn(() => '{"id":"evt-001","type":"ticket.created","occurredAt":"2025-06-01T12:00:00.000Z","tenantId":"tenant-abc","data":{}}'),
  BACKOFF_DELAYS_SEC: [0, 1, 2, 4, 8, 60, 900],
  LONG_DELAY_THRESHOLD_SEC: 60,
}));

jest.mock('drizzle-orm/node-postgres', () => ({
  drizzle: jest.fn(),
}));

const mockDispatch = jest.requireMock('@opsninja/webhooks').dispatch as jest.Mock;
const mockClassifyRetry = jest.requireMock('@opsninja/webhooks').classifyRetry as jest.Mock;

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ENDPOINT_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const EVENT_ID = 'evt-001';

const activeEndpoint = {
  id: ENDPOINT_ID,
  tenantId: TENANT_ID,
  url: 'https://example.com/webhook',
  status: 'active',
  secretCiphertext: Buffer.from('enc-secret'),
  secretKeyVersion: 1,
  previousSecretCiphertext: null,
  previousSecretExpiresAt: null,
  consecutiveFailures: 0,
  lastSuccessAt: null,
};

function makeDbMock(endpoint: object | null, existingDelivery: object | null = null) {
  const selectMock = jest.fn();
  const updateMock = jest.fn().mockReturnThis();
  const insertMock = jest.fn().mockReturnThis();
  const executeMock = jest.fn().mockResolvedValue(undefined);

  // Build a chainable query builder
  const queryChain = {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
    orderBy: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([{ status: 'active', consecutiveFailures: 1 }]),
    values: jest.fn().mockReturnThis(),
    onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
  };

  let callCount = 0;
  selectMock.mockImplementation(() => {
    callCount++;
    const chain = { ...queryChain };
    if (callCount === 1) {
      // First select: endpoint lookup
      chain.limit = jest.fn().mockResolvedValue(endpoint ? [endpoint] : []);
    } else {
      // Second select: idempotency check
      chain.limit = jest.fn().mockResolvedValue(existingDelivery ? [existingDelivery] : []);
    }
    return chain;
  });

  return {
    execute: executeMock,
    select: selectMock,
    update: jest.fn().mockReturnValue(queryChain),
    insert: jest.fn().mockReturnValue(queryChain),
    transaction: jest.fn().mockImplementation((cb: (tx: object) => Promise<void>) => {
      const tx = {
        execute: executeMock,
        select: selectMock,
        update: jest.fn().mockReturnValue(queryChain),
        insert: jest.fn().mockReturnValue(queryChain),
      };
      return cb(tx);
    }),
  };
}

describe('WebhookDeliveryHandler', () => {
  let handler: WebhookDeliveryHandler;
  let pool: { connect: jest.Mock };
  let redis: { eval: jest.Mock };
  let cipher: { decrypt: jest.Mock };

  beforeEach(async () => {
    pool = { connect: jest.fn() };
    redis = { eval: jest.fn().mockResolvedValue(1) };
    cipher = { decrypt: jest.fn().mockResolvedValue(Buffer.from('plaintextsecret')) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDeliveryHandler,
        { provide: WEBHOOK_DB_POOL, useValue: pool },
        { provide: WEBHOOK_REDIS, useValue: redis },
        { provide: ENVELOPE_CIPHER_PORT, useValue: cipher },
      ],
    }).compile();

    handler = module.get<WebhookDeliveryHandler>(WebhookDeliveryHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handle', () => {
    it('silently discards malformed JSON envelopes', async () => {
      await expect(handler.handle('not-json')).resolves.toBeUndefined();
    });

    it('silently discards envelopes with missing required fields', async () => {
      await expect(handler.handle(JSON.stringify({ tenantId: TENANT_ID }))).resolves.toBeUndefined();
    });
  });

  describe('error classes', () => {
    it('ConcurrencyError carries endpointId', () => {
      const err = new ConcurrencyError(ENDPOINT_ID);
      expect(err.endpointId).toBe(ENDPOINT_ID);
      expect(err.name).toBe('ConcurrencyError');
    });

    it('RateLimitError carries tenantId', () => {
      const err = new RateLimitError(TENANT_ID);
      expect(err.tenantId).toBe(TENANT_ID);
      expect(err.name).toBe('RateLimitError');
    });

    it('RetryableError carries delaySec and requiresReEnqueue', () => {
      const err = new RetryableError(900, true);
      expect(err.delaySec).toBe(900);
      expect(err.requiresReEnqueue).toBe(true);
      expect(err.name).toBe('RetryableError');
    });

    it('RetryableError short delay sets requiresReEnqueue=false', () => {
      const err = new RetryableError(8, false);
      expect(err.requiresReEnqueue).toBe(false);
    });
  });

  describe('AUTO_DISABLE_THRESHOLD', () => {
    it('is 20', () => {
      expect(AUTO_DISABLE_THRESHOLD).toBe(20);
    });
  });
});
