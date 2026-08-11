import { NotificationHandler, RateLimitExceededError, DedupeConflictError } from './notification.handler';
import type { EmailSenderPort } from './ports/email-sender.port';
import { RateLimiterService } from './rate-limiter.service';
import { makeEnvelope, TENANT_ID, MALFORMED_JSON } from '../test/fixtures/sqs-envelopes.fixtures';

// Minimal mock for pg.Pool + PoolClient
function makeMockPool(insertReturns: Array<{ id: string }> = [{ id: 'notif-uuid-1' }]) {
  const mockClient = {
    query: jest.fn().mockResolvedValue({}),
    release: jest.fn(),
  };
  // We need to mock drizzle; since this is a unit test we stub the pool client
  // to avoid actual DB connections.
  const pool = { connect: jest.fn().mockResolvedValue(mockClient) };
  return { pool, mockClient };
}

describe('NotificationHandler', () => {
  let handler: NotificationHandler;
  let emailSender: jest.Mocked<EmailSenderPort>;
  let rateLimiter: jest.Mocked<Pick<RateLimiterService, 'tryConsume'>>;

  beforeEach(() => {
    emailSender = { sendEmail: jest.fn().mockResolvedValue({ messageId: 'ses-msg-001' }) };
    rateLimiter = { tryConsume: jest.fn().mockResolvedValue(true) };
  });

  it('discards and returns silently on malformed JSON envelope', async () => {
    const { pool } = makeMockPool();
    handler = new NotificationHandler(
      pool as never,
      emailSender,
      rateLimiter as never,
    );
    await expect(handler.handleMessage(MALFORMED_JSON)).resolves.toBeUndefined();
    // Pool should not be connected — envelope was rejected before DB access.
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('discards invalid (non-JSON-parseable but valid JSON with wrong schema) envelope', async () => {
    const { pool } = makeMockPool();
    handler = new NotificationHandler(pool as never, emailSender, rateLimiter as never);
    await expect(handler.handleMessage(JSON.stringify({ version: '9' }))).resolves.toBeUndefined();
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

describe('classifySesError', () => {
  const { classifySesError } = require('./ports/email-sender.port');

  it('classifies MessageRejected as permanent', () => {
    expect(classifySesError('MessageRejected')).toBe('permanent');
  });

  it('classifies Throttling as retryable', () => {
    expect(classifySesError('Throttling')).toBe('retryable');
  });

  it('classifies undefined as retryable', () => {
    expect(classifySesError(undefined)).toBe('retryable');
  });
});
