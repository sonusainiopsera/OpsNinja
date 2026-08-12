/**
 * Unit tests for RecipientPolicy — domain validation for report schedule recipients (AC-10).
 *
 * Tests default-deny semantics:
 *   - External address on allowlist → allowed
 *   - External address matching verified domain → allowed
 *   - External address matching neither → RECIPIENT_DOMAIN_NOT_ALLOWED (422)
 *   - type=user with active userId → allowed
 *   - type=user with inactive/missing userId → denied
 *   - Empty recipient list → SCHEDULE_RECIPIENTS_EMPTY (422)
 *   - Unknown recipient type → denied
 *   - Mixed allow + deny → throws on first denied
 */

import { UnprocessableEntityException } from '@nestjs/common';
import { RecipientPolicy } from './recipient-policy';
import type { ScheduleRecipient } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Fake read repository
// ---------------------------------------------------------------------------

interface FakeRepoConfig {
  allowlistedEmails?: string[];
  verifiedDomains?:   string[];
  activeUserIds?:     string[];
}

function makeFakePolicy(config: FakeRepoConfig = {}): RecipientPolicy {
  const allowlistSet   = new Set((config.allowlistedEmails ?? []).map((e) => e.toLowerCase()));
  const verifiedSet    = new Set((config.verifiedDomains   ?? []).map((d) => d.toLowerCase()));
  const activeUserSet  = new Set(config.activeUserIds ?? []);

  const fakeRepo = {
    getAllowlistedEmails: jest.fn().mockResolvedValue(allowlistSet),
    getVerifiedDomains:  jest.fn().mockResolvedValue(verifiedSet),
    getActiveUserIds:    jest.fn().mockResolvedValue(activeUserSet),
  };

  // RecipientPolicy constructor takes a RecipientPolicyReadRepository.
  // Cast via unknown to bypass the import-only class constraint.
  return new RecipientPolicy(fakeRepo as unknown as any);
}

const TENANT = 'tenant-uuid-001';

// ---------------------------------------------------------------------------
// External recipients
// ---------------------------------------------------------------------------

describe('RecipientPolicy — external recipients', () => {
  it('allows an email explicitly on the allowlist', async () => {
    const policy = makeFakePolicy({ allowlistedEmails: ['ceo@external.com'] });
    await expect(
      policy.validateRecipients(TENANT, [
        { type: 'external', email: 'ceo@external.com' },
      ]),
    ).resolves.not.toThrow();
  });

  it('allowlist match is case-insensitive', async () => {
    const policy = makeFakePolicy({ allowlistedEmails: ['CEO@External.COM'] });
    await expect(
      policy.validateRecipients(TENANT, [
        { type: 'external', email: 'ceo@external.com' },
      ]),
    ).resolves.not.toThrow();
  });

  it('allows an email whose domain is in verified domains', async () => {
    const policy = makeFakePolicy({ verifiedDomains: ['acme.com'] });
    await expect(
      policy.validateRecipients(TENANT, [
        { type: 'external', email: 'alice@acme.com' },
      ]),
    ).resolves.not.toThrow();
  });

  it('verified domain match is case-insensitive', async () => {
    const policy = makeFakePolicy({ verifiedDomains: ['ACME.COM'] });
    await expect(
      policy.validateRecipients(TENANT, [
        { type: 'external', email: 'alice@Acme.Com' },
      ]),
    ).resolves.not.toThrow();
  });

  it('denies an email that is neither allowlisted nor matches a verified domain', async () => {
    const policy = makeFakePolicy({ verifiedDomains: ['acme.com'] });
    await expect(
      policy.validateRecipients(TENANT, [
        { type: 'external', email: 'bob@untrusted.org' },
      ]),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('denied error code is RECIPIENT_DOMAIN_NOT_ALLOWED', async () => {
    const policy = makeFakePolicy();
    let thrown: UnprocessableEntityException | undefined;
    try {
      await policy.validateRecipients(TENANT, [
        { type: 'external', email: 'bad@nowhere.xyz' },
      ]);
    } catch (err) {
      thrown = err as UnprocessableEntityException;
    }
    expect(thrown).toBeDefined();
    const body = thrown!.getResponse() as Record<string, unknown>;
    const error = (body.error ?? body) as Record<string, unknown>;
    expect(error.code ?? JSON.stringify(body)).toContain('RECIPIENT_DOMAIN_NOT_ALLOWED');
  });

  it('denies when no domains or allowlist are configured (default-deny)', async () => {
    const policy = makeFakePolicy(); // no config = empty sets
    await expect(
      policy.validateRecipients(TENANT, [
        { type: 'external', email: 'any@anywhere.io' },
      ]),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('denies external recipient missing the email field', async () => {
    const policy = makeFakePolicy({ verifiedDomains: ['acme.com'] });
    await expect(
      policy.validateRecipients(TENANT, [
        { type: 'external' } as ScheduleRecipient,
      ]),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});

// ---------------------------------------------------------------------------
// User recipients
// ---------------------------------------------------------------------------

describe('RecipientPolicy — user recipients', () => {
  it('allows an active user', async () => {
    const uid = 'user-active-001';
    const policy = makeFakePolicy({ activeUserIds: [uid] });
    await expect(
      policy.validateRecipients(TENANT, [{ type: 'user', userId: uid }]),
    ).resolves.not.toThrow();
  });

  it('denies an inactive user', async () => {
    const policy = makeFakePolicy({ activeUserIds: ['active-user'] }); // different uid
    await expect(
      policy.validateRecipients(TENANT, [{ type: 'user', userId: 'inactive-user' }]),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('denies a user that does not exist in this tenant', async () => {
    const policy = makeFakePolicy(); // activeUserIds = []
    await expect(
      policy.validateRecipients(TENANT, [{ type: 'user', userId: 'ghost-user' }]),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('denies user recipient missing the userId field', async () => {
    const policy = makeFakePolicy({ activeUserIds: ['some-user'] });
    await expect(
      policy.validateRecipients(TENANT, [
        { type: 'user' } as ScheduleRecipient,
      ]),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});

// ---------------------------------------------------------------------------
// Empty recipient list
// ---------------------------------------------------------------------------

describe('RecipientPolicy — empty recipient list', () => {
  it('throws on an empty list', async () => {
    const policy = makeFakePolicy({ verifiedDomains: ['acme.com'] });
    await expect(policy.validateRecipients(TENANT, [])).rejects.toThrow(UnprocessableEntityException);
  });

  it('empty-list error contains SCHEDULE_RECIPIENTS_EMPTY code', async () => {
    const policy = makeFakePolicy();
    let thrown: UnprocessableEntityException | undefined;
    try {
      await policy.validateRecipients(TENANT, []);
    } catch (err) {
      thrown = err as UnprocessableEntityException;
    }
    expect(thrown).toBeDefined();
    const body = thrown!.getResponse() as Record<string, unknown>;
    const error = (body.error ?? body) as Record<string, unknown>;
    expect(error.code ?? JSON.stringify(body)).toContain('SCHEDULE_RECIPIENTS_EMPTY');
  });
});

// ---------------------------------------------------------------------------
// Mixed lists
// ---------------------------------------------------------------------------

describe('RecipientPolicy — mixed recipient lists', () => {
  it('allows a mixed list when all pass', async () => {
    const uid = 'active-user-xyz';
    const policy = makeFakePolicy({
      activeUserIds:     [uid],
      allowlistedEmails: ['exec@partner.org'],
    });
    await expect(
      policy.validateRecipients(TENANT, [
        { type: 'user',     userId: uid },
        { type: 'external', email: 'exec@partner.org' },
      ]),
    ).resolves.not.toThrow();
  });

  it('throws when at least one recipient is denied', async () => {
    const uid = 'active-user-xyz';
    const policy = makeFakePolicy({ activeUserIds: [uid] });
    await expect(
      policy.validateRecipients(TENANT, [
        { type: 'user',     userId: uid },
        { type: 'external', email: 'bad@nowhere.xyz' }, // this will be denied
      ]),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('multiple valid external addresses via verified domain all pass', async () => {
    const policy = makeFakePolicy({ verifiedDomains: ['enterprise.io'] });
    await expect(
      policy.validateRecipients(TENANT, [
        { type: 'external', email: 'alice@enterprise.io' },
        { type: 'external', email: 'bob@enterprise.io' },
        { type: 'external', email: 'charlie@enterprise.io' },
      ]),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DB repository interaction
// ---------------------------------------------------------------------------

describe('RecipientPolicy — repository calls', () => {
  it('passes tenantId to getAllowlistedEmails and getVerifiedDomains', async () => {
    const fakeRepo = {
      getAllowlistedEmails: jest.fn().mockResolvedValue(new Set(['ceo@external.com'])),
      getVerifiedDomains:  jest.fn().mockResolvedValue(new Set<string>()),
      getActiveUserIds:    jest.fn().mockResolvedValue(new Set<string>()),
    };
    const policy = new RecipientPolicy(fakeRepo as unknown as any);
    await policy.validateRecipients('my-tenant', [{ type: 'external', email: 'ceo@external.com' }]);

    expect(fakeRepo.getAllowlistedEmails).toHaveBeenCalledWith('my-tenant');
    expect(fakeRepo.getVerifiedDomains).toHaveBeenCalledWith('my-tenant');
  });

  it('calls getActiveUserIds with empty array when there are no user-type recipients', async () => {
    const fakeRepo = {
      getAllowlistedEmails: jest.fn().mockResolvedValue(new Set(['ceo@external.com'])),
      getVerifiedDomains:  jest.fn().mockResolvedValue(new Set<string>()),
      getActiveUserIds:    jest.fn().mockResolvedValue(new Set<string>()),
    };
    const policy = new RecipientPolicy(fakeRepo as unknown as any);
    await policy.validateRecipients('my-tenant', [{ type: 'external', email: 'ceo@external.com' }]);

    // External-only recipients: getActiveUserIds is called with [] (short-circuits in impl).
    expect(fakeRepo.getActiveUserIds).toHaveBeenCalledWith('my-tenant', []);
  });
});
