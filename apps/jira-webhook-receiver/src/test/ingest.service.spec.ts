/**
 * Unit tests for IngestService — WO-054.
 *
 * Covers:
 *  - resolveConnection: unknown tenant slug returns null
 *  - resolveConnection: known tenant, Redis cache hit
 *  - ingest: first delivery persists and enqueues (mocked pool)
 *  - ingest: duplicate delivery returns deduped=true without second enqueue
 *  - ingest: unknown event type sets processingState='ignored'
 *
 * Database calls are fully mocked — no real Postgres required.
 */

import { IngestService, type JiraWebhookPayload } from '../ingest.service';
import { REDIS_CLIENT } from '../redis.provider';
import { CREDENTIAL_VAULT } from '../credential-vault.port';
import { Test } from '@nestjs/testing';

// ---------------------------------------------------------------------------
// Mock pool (imported by ingest.service via @opsninja/db)
// ---------------------------------------------------------------------------

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

const mockInsert = jest.fn();
const mockTx = { insert: mockInsert };

jest.mock('@opsninja/db', () => ({
  pool: { connect: jest.fn().mockResolvedValue(mockClient) },
  createTransactionHandle: jest.fn().mockReturnValue(mockTx),
  jiraWebhookEvents: { name: 'jira_webhook_events' },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRedis(cacheValue: string | null = null) {
  return {
    get: jest.fn().mockResolvedValue(cacheValue),
    setex: jest.fn().mockResolvedValue('OK'),
  };
}

function makeVault(secretValue = 'whs_test_secret') {
  return {
    retrieve: jest.fn().mockResolvedValue(secretValue),
    store: jest.fn(),
    delete: jest.fn(),
  };
}

const TENANT_ID = 'f2000001-0000-0000-0000-000000000001';
const CONNECTION_ID = 'f2000002-0000-0000-0000-000000000001';
const CLOUD_ID = 'cloud-abc-123';
const TENANT_SLUG = 'acme-corp';

const ISSUE_UPDATED_PAYLOAD: JiraWebhookPayload = {
  id: 100001,
  webhookEvent: 'jira:issue_updated',
  timestamp: 1712300000000,
  issue: { id: '10042', key: 'OPS-42' },
};

const UNKNOWN_TYPE_PAYLOAD: JiraWebhookPayload = {
  id: 100005,
  webhookEvent: 'sprint_started',
  timestamp: 1712300400000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IngestService', () => {
  let service: IngestService;
  let redis: ReturnType<typeof makeRedis>;
  let vault: ReturnType<typeof makeVault>;

  beforeEach(async () => {
    jest.clearAllMocks();
    redis = makeRedis();
    vault = makeVault();

    const module = await Test.createTestingModule({
      providers: [
        IngestService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: CREDENTIAL_VAULT, useValue: vault },
      ],
    }).compile();

    service = module.get(IngestService);
  });

  // --------------------------------------------------------------------------
  // resolveConnection
  // --------------------------------------------------------------------------

  describe('resolveConnection', () => {
    it('returns null for an unknown tenant slug', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN READ ONLY
        .mockResolvedValueOnce({ rows: [] }) // tenants SELECT
        .mockResolvedValueOnce(undefined); // ROLLBACK

      const result = await service.resolveConnection('unknown-slug', CLOUD_ID);
      expect(result).toBeNull();
    });

    it('returns cached resolution on Redis hit', async () => {
      const cached = {
        tenantId: TENANT_ID,
        connectionId: CONNECTION_ID,
        secret: 'whs_cached_secret',
        previousSecret: undefined,
      };
      redis = makeRedis(JSON.stringify(cached));

      const module = await Test.createTestingModule({
        providers: [
          IngestService,
          { provide: REDIS_CLIENT, useValue: redis },
          { provide: CREDENTIAL_VAULT, useValue: vault },
        ],
      }).compile();
      service = module.get(IngestService);

      const result = await service.resolveConnection(TENANT_SLUG, CLOUD_ID);
      expect(result).toEqual(cached);
      // Should NOT have hit Postgres
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('resolves tenant + connection from DB and caches result', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN READ ONLY
        .mockResolvedValueOnce({ rows: [{ id: TENANT_ID }] }) // tenants
        .mockResolvedValueOnce({ // jira_connections
          rows: [{
            id: CONNECTION_ID,
            webhook_secret_ref: 'opsninja/tenant/jira/conn-a',
            webhook_secret_rotated_at: null,
          }],
        })
        .mockResolvedValueOnce(undefined); // ROLLBACK

      const result = await service.resolveConnection(TENANT_SLUG, CLOUD_ID);

      expect(result).not.toBeNull();
      expect(result!.tenantId).toBe(TENANT_ID);
      expect(result!.connectionId).toBe(CONNECTION_ID);
      expect(redis.setex).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // ingest
  // --------------------------------------------------------------------------

  describe('ingest', () => {
    beforeEach(() => {
      // Default happy-path DB mock: BEGIN, set_config, COMMIT
      mockClient.query.mockResolvedValue(undefined);
      // Default insert: resolves (no conflict)
      mockInsert.mockReturnValue({ values: jest.fn().mockResolvedValue([]) });
    });

    it('persists and enqueues a new event', async () => {
      const result = await service.ingest(TENANT_ID, CONNECTION_ID, ISSUE_UPDATED_PAYLOAD);

      expect(result.deduped).toBe(false);
      expect(result.jiraEventId).toBe('100001');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'jira_webhook_events' }),
      );
      // Outbox INSERT via raw SQL
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO outbox_events'),
        expect.any(Array),
      );
    });

    it('returns deduped=true on unique constraint conflict', async () => {
      const uniqueViolation = Object.assign(new Error('duplicate'), { code: '23505' });
      mockInsert.mockReturnValue({
        values: jest.fn().mockRejectedValue(uniqueViolation),
      });

      const result = await service.ingest(TENANT_ID, CONNECTION_ID, ISSUE_UPDATED_PAYLOAD);

      expect(result.deduped).toBe(true);
      // Outbox should NOT have been inserted
      expect(mockClient.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO outbox_events'),
        expect.any(Array),
      );
    });

    it('sets processingState=ignored for unknown event types', async () => {
      await service.ingest(TENANT_ID, CONNECTION_ID, UNKNOWN_TYPE_PAYLOAD);

      const valuesCall = mockInsert.mock.results[0]?.value?.values?.mock?.calls[0]?.[0];
      expect(valuesCall?.processingState).toBe('ignored');
      // Ignored events are NOT enqueued
      expect(mockClient.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO outbox_events'),
        expect.any(Array),
      );
    });

    it('rolls back and rethrows on unexpected DB error', async () => {
      const dbError = new Error('connection lost');
      mockInsert.mockReturnValue({
        values: jest.fn().mockRejectedValue(dbError),
      });

      await expect(
        service.ingest(TENANT_ID, CONNECTION_ID, ISSUE_UPDATED_PAYLOAD),
      ).rejects.toThrow('connection lost');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });
});
