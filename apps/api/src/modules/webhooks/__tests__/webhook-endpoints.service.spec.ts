/**
 * Unit tests for WebhookEndpointsService.
 *
 * Stubs DNS, the cipher, and repository to test service logic in isolation.
 */

import { jest } from '@jest/globals';

jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

import { promises as dns } from 'dns';
import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookEndpointsService } from '../webhook-endpoints.service';
import { WebhookSecretService } from '../webhook-secret.service';
import { WebhookEndpointsRepository } from '../webhook-endpoints.repository';
import { InMemoryEnvelopeCipher } from '@opsninja/crypto';

const mockLookup = dns.lookup as jest.MockedFunction<typeof dns.lookup>;

function stubPublicIp() {
  mockLookup.mockResolvedValue([{ address: '203.0.114.1', family: 4 }] as never);
}

function makeService() {
  const cipher = new InMemoryEnvelopeCipher();
  const config = {
    get: jest.fn((k: string, d: unknown) => d),
    getOrThrow: jest.fn(),
  } as unknown as ConfigService;
  const secretService = new WebhookSecretService(cipher, config);

  const repo = {
    create: jest.fn(),
    findById: jest.fn(),
    findPage: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    writeAudit: jest.fn().mockResolvedValue(undefined),
  } as unknown as WebhookEndpointsRepository;

  const svc = new WebhookEndpointsService(repo as never, secretService);
  return { svc, repo };
}

const principal = {
  tenantId: 'tenant-1',
  userId: 'actor-1',
  principalKind: 'staff' as const,
  roles: ['integration_admin'],
  orgScopeIds: [],
  traceId: 'trace-1',
};

describe('WebhookEndpointsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('rejects invalid event types with 400', async () => {
      stubPublicIp();
      const { svc } = makeService();
      await expect(
        svc.create({ url: 'https://example.com', eventTypes: ['fake.event'] }, principal),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects private-IP URL with 422', async () => {
      mockLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as never);
      const { svc } = makeService();
      await expect(
        svc.create({ url: 'https://internal.example.com', eventTypes: ['ticket.created'] }, principal),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('returns plaintext secret exactly once', async () => {
      stubPublicIp();
      const { svc, repo } = makeService();
      const fakeRow = {
        id: 'ep-1',
        tenantId: 'tenant-1',
        url: 'https://example.com',
        description: null,
        eventTypes: ['ticket.created'],
        status: 'active',
        secretKeyVersion: 1,
        consecutiveFailures: 0,
        lastSuccessAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        secretCiphertext: Buffer.alloc(1),
        previousSecretCiphertext: null,
        previousSecretExpiresAt: null,
        createdBy: 'actor-1',
      };
      (repo.create as jest.Mock).mockResolvedValue(fakeRow);

      const result = await svc.create(
        { url: 'https://example.com', eventTypes: ['ticket.created'] },
        principal,
      );

      expect(typeof result.secret).toBe('string');
      expect(result.secret.length).toBeGreaterThan(0);
      expect((result as Record<string, unknown>).secretCiphertext).toBeUndefined();
    });

    it('writes audit log', async () => {
      stubPublicIp();
      const { svc, repo } = makeService();
      const fakeRow = {
        id: 'ep-1',
        tenantId: 'tenant-1',
        url: 'https://example.com',
        description: null,
        eventTypes: ['ticket.created'],
        status: 'active',
        secretKeyVersion: 1,
        consecutiveFailures: 0,
        lastSuccessAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        secretCiphertext: Buffer.alloc(1),
        previousSecretCiphertext: null,
        previousSecretExpiresAt: null,
        createdBy: 'actor-1',
      };
      (repo.create as jest.Mock).mockResolvedValue(fakeRow);

      await svc.create({ url: 'https://example.com', eventTypes: ['ticket.created'] }, principal);

      expect(repo.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'webhook_endpoint.created' }),
      );
    });
  });

  describe('getOne', () => {
    it('throws 404 when endpoint does not exist', async () => {
      const { svc, repo } = makeService();
      (repo.findById as jest.Mock).mockResolvedValue(null);
      await expect(svc.getOne('non-existent', principal)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('response never contains secret fields', async () => {
      const { svc, repo } = makeService();
      const fakeRow = {
        id: 'ep-1',
        tenantId: 'tenant-1',
        url: 'https://example.com',
        description: null,
        eventTypes: ['ticket.created'],
        status: 'active',
        secretKeyVersion: 1,
        secretCiphertext: Buffer.alloc(32),
        previousSecretCiphertext: null,
        previousSecretExpiresAt: null,
        consecutiveFailures: 0,
        lastSuccessAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        createdBy: 'actor-1',
      };
      (repo.findById as jest.Mock).mockResolvedValue(fakeRow);

      const summary = await svc.getOne('ep-1', principal);
      expect((summary as Record<string, unknown>).secret).toBeUndefined();
      expect((summary as Record<string, unknown>).secretCiphertext).toBeUndefined();
    });
  });

  describe('cross-tenant: 404 not 403', () => {
    it('returns 404 for endpoint that exists under a different tenant', async () => {
      const { svc, repo } = makeService();
      // Repository returns null because RLS / tenant-scoped query sees nothing.
      (repo.findById as jest.Mock).mockResolvedValue(null);

      const otherPrincipal = { ...principal, tenantId: 'different-tenant' };
      await expect(svc.getOne('ep-of-tenant-1', otherPrincipal)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('rotateSecret', () => {
    it('throws 404 for unknown endpoint', async () => {
      const { svc, repo } = makeService();
      (repo.findById as jest.Mock).mockResolvedValue(null);
      await expect(svc.rotateSecret('missing', principal)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns new secret with previousSecretExpiresAt', async () => {
      const { svc, repo } = makeService();
      const existingRow = {
        id: 'ep-1',
        tenantId: 'tenant-1',
        url: 'https://example.com',
        description: null,
        eventTypes: ['ticket.created'],
        status: 'active',
        secretKeyVersion: 1,
        secretCiphertext: Buffer.alloc(50),
        previousSecretCiphertext: null,
        previousSecretExpiresAt: null,
        consecutiveFailures: 0,
        lastSuccessAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        createdBy: 'actor-1',
      };
      (repo.findById as jest.Mock).mockResolvedValue(existingRow);
      (repo.update as jest.Mock).mockResolvedValue(existingRow);

      const result = await svc.rotateSecret('ep-1', principal);
      expect(typeof result.secret).toBe('string');
      expect(result.secret.length).toBeGreaterThan(0);
      expect(typeof result.previousSecretExpiresAt).toBe('string');
      expect(new Date(result.previousSecretExpiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('audit log never contains the secret value', async () => {
      const { svc, repo } = makeService();
      const existingRow = {
        id: 'ep-1',
        tenantId: 'tenant-1',
        url: 'https://example.com',
        description: null,
        eventTypes: ['ticket.created'],
        status: 'active',
        secretKeyVersion: 1,
        secretCiphertext: Buffer.alloc(50),
        previousSecretCiphertext: null,
        previousSecretExpiresAt: null,
        consecutiveFailures: 0,
        lastSuccessAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        createdBy: 'actor-1',
      };
      (repo.findById as jest.Mock).mockResolvedValue(existingRow);
      (repo.update as jest.Mock).mockResolvedValue(existingRow);

      await svc.rotateSecret('ep-1', principal);

      const auditCall = (repo.writeAudit as jest.Mock).mock.calls[0][0];
      const detailsJson = JSON.stringify(auditCall.details);
      // Must not contain any 43-char base64url string matching a 32-byte key
      expect(detailsJson).not.toMatch(/[A-Za-z0-9_-]{43}/);
    });
  });
});
