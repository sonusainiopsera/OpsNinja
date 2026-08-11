import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SlaPoliciesService } from '../sla-policies.service';

// Mock RequestContextStore
jest.mock('../../../observability/request-context', () => ({
  RequestContextStore: {
    getPrincipal: jest.fn(),
  },
}));

import { RequestContextStore } from '../../../observability/request-context';

const TENANT_ID = 'aaaa0000-0000-0000-0000-000000000001';
const USER_ID   = 'bbbb0000-0000-0000-0000-000000000002';
const CAL_ID    = 'cccc0000-0000-0000-0000-000000000003';
const POLICY_ID = 'dddd0000-0000-0000-0000-000000000004';

function makePrincipal(overrides: Record<string, unknown> = {}) {
  (RequestContextStore.getPrincipal as jest.Mock).mockReturnValue({
    tenantId: TENANT_ID,
    userId: USER_ID,
    principalKind: 'staff',
    roles: ['manager'],
    orgScopeIds: [],
    traceId: 'trace-1',
    ...overrides,
  });
}

function makePolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: POLICY_ID,
    tenantId: TENANT_ID,
    scopeType: 'tenant',
    scopeId: null,
    priority: 'P1',
    responseTargetMins: 15,
    resolutionTargetMins: 240,
    calendarId: CAL_ID,
    reminderPctFirst: 50,
    reminderPctSecond: 80,
    isActive: true,
    targetsRatified: false,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER_ID,
    updatedBy: USER_ID,
    ...overrides,
  };
}

const mockRepo = {
  findAll: jest.fn(),
  findById: jest.fn(),
  findActiveByScopeAndPriority: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  deactivate: jest.fn(),
  createVersion: jest.fn(),
  findVersionsByPolicyId: jest.fn(),
};

const mockAuditWriter = {
  append: jest.fn(),
};

function makeService() {
  return new SlaPoliciesService(mockRepo as any, mockAuditWriter as any);
}

describe('SlaPoliciesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    makePrincipal();
  });

  // ── Create ─────────────────────────────────────────────────────────────────

  describe('createPolicy', () => {
    const dto = {
      scope_type: 'tenant' as const,
      scope_id: null,
      priority: 'P1' as const,
      response_target_mins: 15,
      resolution_target_mins: 240,
      calendar_id: CAL_ID,
      reminder_pct_first: 50,
      reminder_pct_second: 80,
    };

    it('creates a policy when no conflict exists', async () => {
      mockRepo.findActiveByScopeAndPriority.mockResolvedValue(undefined);
      mockRepo.create.mockResolvedValue(makePolicy());
      mockRepo.createVersion.mockResolvedValue({});
      mockAuditWriter.append.mockResolvedValue(undefined);

      const svc = makeService();
      const result = await svc.createPolicy(dto);
      expect(result.priority).toBe('P1');
      expect(mockRepo.create).toHaveBeenCalledTimes(1);
      expect(mockRepo.createVersion).toHaveBeenCalledWith(
        expect.objectContaining({ version: 1, policyId: POLICY_ID }),
      );
    });

    it('throws 409 when a policy with same scope+priority already exists', async () => {
      mockRepo.findActiveByScopeAndPriority.mockResolvedValue(makePolicy());

      const svc = makeService();
      await expect(svc.createPolicy(dto)).rejects.toBeInstanceOf(ConflictException);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('writes an audit record on success', async () => {
      mockRepo.findActiveByScopeAndPriority.mockResolvedValue(undefined);
      mockRepo.create.mockResolvedValue(makePolicy());
      mockRepo.createVersion.mockResolvedValue({});
      mockAuditWriter.append.mockResolvedValue(undefined);

      const svc = makeService();
      await svc.createPolicy(dto);
      expect(mockAuditWriter.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sla_policy.created', resourceId: POLICY_ID }),
      );
    });
  });

  // ── Update (version mismatch) ───────────────────────────────────────────────

  describe('updatePolicy', () => {
    it('throws 409 on version mismatch', async () => {
      mockRepo.findById.mockResolvedValue(makePolicy({ version: 2 }));

      const svc = makeService();
      await expect(svc.updatePolicy(POLICY_ID, {
        response_target_mins: 30,
        if_match_version: 1,
      })).rejects.toBeInstanceOf(ConflictException);
    });

    it('increments version and writes snapshot on success', async () => {
      mockRepo.findById.mockResolvedValue(makePolicy({ version: 1 }));
      mockRepo.findActiveByScopeAndPriority.mockResolvedValue(undefined);
      const updated = makePolicy({ version: 2, responseTargetMins: 30 });
      mockRepo.update.mockResolvedValue(updated);
      mockRepo.createVersion.mockResolvedValue({});
      mockAuditWriter.append.mockResolvedValue(undefined);

      const svc = makeService();
      const result = await svc.updatePolicy(POLICY_ID, {
        response_target_mins: 30,
        if_match_version: 1,
      });
      expect(result.version).toBe(2);
      expect(mockRepo.createVersion).toHaveBeenCalledWith(
        expect.objectContaining({ version: 2 }),
      );
    });

    it('throws 422 when trying to update an inactive policy', async () => {
      mockRepo.findById.mockResolvedValue(makePolicy({ isActive: false }));

      const svc = makeService();
      await expect(svc.updatePolicy(POLICY_ID, {
        response_target_mins: 30,
        if_match_version: 1,
      })).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  // ── Deactivate ─────────────────────────────────────────────────────────────

  describe('deactivatePolicy', () => {
    it('deactivates an active policy', async () => {
      mockRepo.findById.mockResolvedValue(makePolicy());
      mockRepo.deactivate.mockResolvedValue(makePolicy({ isActive: false }));
      mockAuditWriter.append.mockResolvedValue(undefined);

      const svc = makeService();
      const result = await svc.deactivatePolicy(POLICY_ID);
      expect(result.is_active).toBe(false);
    });

    it('throws 409 when policy is already inactive', async () => {
      mockRepo.findById.mockResolvedValue(makePolicy({ isActive: false }));

      const svc = makeService();
      await expect(svc.deactivatePolicy(POLICY_ID)).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws 404 when policy is not found', async () => {
      mockRepo.findById.mockResolvedValue(undefined);

      const svc = makeService();
      await expect(svc.deactivatePolicy(POLICY_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── List with cursor pagination ────────────────────────────────────────────

  describe('listPolicies', () => {
    it('returns data and nextCursor when there is a next page', async () => {
      const policies = Array.from({ length: 3 }, (_, i) =>
        makePolicy({ id: `id-${i}`, priority: i % 2 === 0 ? 'P1' : 'P2' }),
      );
      mockRepo.findAll.mockResolvedValue(policies);

      const svc = makeService();
      // Request limit=2, repo returns 3 rows (limit+1 pattern)
      const result = await svc.listPolicies({ limit: 2, cursor: undefined });
      expect(result.data).toHaveLength(2);
      expect(result.next_cursor).toBe('id-1');
    });

    it('returns null nextCursor on last page', async () => {
      const policies = [makePolicy()];
      mockRepo.findAll.mockResolvedValue(policies);

      const svc = makeService();
      const result = await svc.listPolicies({ limit: 50, cursor: undefined });
      expect(result.next_cursor).toBeNull();
    });
  });
});
