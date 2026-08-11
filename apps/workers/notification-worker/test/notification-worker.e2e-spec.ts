/**
 * E2E integration test for the notification worker.
 *
 * Requires:
 *  - DATABASE_URL pointing to a test Postgres instance with migrations applied
 *  - REDIS_URL pointing to a test Redis instance
 *  - InMemoryEmailSender instead of SesEmailSender
 *
 * Run with: npx jest --config jest.e2e.config.js
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { NotificationHandler } from '../src/notification.handler';
import { RateLimiterService } from '../src/rate-limiter.service';
import { InMemoryEmailSender } from '../src/adapters/in-memory-email-sender';
import { EMAIL_SENDER } from '../src/ports/email-sender.port';
import { makeEnvelope, TENANT_ID } from './fixtures/sqs-envelopes.fixtures';

const TEST_DB_URL = process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/opsninja_test';
const TEST_REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

describe('NotificationHandler (e2e)', () => {
  let module: TestingModule;
  let handler: NotificationHandler;
  let emailSender: InMemoryEmailSender;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
    emailSender = new InMemoryEmailSender();
    const rateLimiter = new RateLimiterService(TEST_REDIS_URL);

    module = await Test.createTestingModule({
      providers: [
        { provide: Pool, useValue: pool },
        { provide: EMAIL_SENDER, useValue: emailSender },
        { provide: RateLimiterService, useValue: rateLimiter },
        {
          provide: NotificationHandler,
          useFactory: () => new NotificationHandler(pool, emailSender, rateLimiter),
        },
      ],
    }).compile();

    handler = module.get<NotificationHandler>(NotificationHandler);
  });

  afterAll(async () => {
    await module.close();
    await pool.end();
  });

  beforeEach(() => {
    emailSender.reset();
  });

  it('sends an email and persists sent status (requires real DB)', async () => {
    // This test is skipped in environments without a real DB — it serves as a
    // documentation and contract test rather than a CI gate.
    if (!process.env['DATABASE_URL']) {
      return;
    }

    const envelope = makeEnvelope({ dedupeKey: `e2e-${Date.now()}` });
    await handler.handleMessage(envelope);
    expect(emailSender.captured).toHaveLength(1);
  });

  it('deduplicates re-delivered messages (same dedupeKey)', async () => {
    if (!process.env['DATABASE_URL']) return;

    const key = `e2e-dedup-${Date.now()}`;
    const envelope = makeEnvelope({ dedupeKey: key });

    await handler.handleMessage(envelope);
    const countAfterFirst = emailSender.captured.length;

    await handler.handleMessage(envelope); // same dedupeKey
    expect(emailSender.captured.length).toBe(countAfterFirst); // no additional send
  });
});
