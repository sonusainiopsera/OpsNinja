import { BadRequestException, GoneException, TooManyRequestsException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PortalVerificationService } from '../portal-verification.service';
import { DB_TOKEN } from '../../../../data/db.module';
import { REDIS_CLIENT } from '../../../../common/redis/redis.provider';
import { TokenService } from '../../token.service';
import { SessionService } from '../../session.service';
import { generateToken } from '../token.codec';
import { ErrorCode } from '../../../../common/errors/app-errors';

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const SIGNUP_REQUEST_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const TEST_EMAIL = 'applicant@example.com';
const HMAC_KEY = 'test-key';

function makeDbMock() {
  const executeMock = jest.fn().mockResolvedValue(undefined);
  const updateChain = {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([{ tokenId: 'tok-1' }]),
  };
  const insertChain = {
    values: jest.fn().mockReturnThis(),
    onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
  };
  const selectChain = {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
  };
  return {
    execute: executeMock,
    update: jest.fn().mockReturnValue(updateChain),
    insert: jest.fn().mockReturnValue(insertChain),
    select: jest.fn().mockReturnValue(selectChain),
    transaction: jest.fn().mockImplementation(async (cb: (tx: object) => Promise<void>) => {
      const tx = {
        execute: executeMock,
        update: jest.fn().mockReturnValue(updateChain),
        insert: jest.fn().mockReturnValue(insertChain),
        select: jest.fn().mockReturnValue(selectChain),
      };
      return cb(tx);
    }),
    _selectChain: selectChain,
    _updateChain: updateChain,
    _insertChain: insertChain,
  };
}

function makeRedisMock() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    exists: jest.fn().mockResolvedValue(0),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(60),
  };
}

describe('PortalVerificationService', () => {
  let service: PortalVerificationService;
  let db: ReturnType<typeof makeDbMock>;
  let redis: ReturnType<typeof makeRedisMock>;
  let tokenService: { mintAccessToken: jest.Mock };
  let sessionService: { createSession: jest.Mock; buildRefreshCookie: jest.Mock };

  beforeEach(async () => {
    db = makeDbMock();
    redis = makeRedisMock();
    tokenService = {
      mintAccessToken: jest.fn().mockReturnValue({
        accessToken: 'test-access-token',
        expiresIn: 900,
        jti: 'jti-1',
      }),
    };
    sessionService = {
      createSession: jest.fn().mockResolvedValue({
        rawToken: 'raw-refresh',
        sessionId: 'sess-1',
        tenantId: TENANT_ID,
        expiresAt: new Date(),
      }),
      buildRefreshCookie: jest.fn().mockReturnValue('cookie-value'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortalVerificationService,
        { provide: DB_TOKEN, useValue: db },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: TokenService, useValue: tokenService },
        { provide: SessionService, useValue: sessionService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: unknown) => {
              if (key === 'VERIFICATION_HMAC_KEY') return HMAC_KEY;
              if (key === 'PORTAL_BASE_URL') return 'https://portal.example.com';
              if (key === 'DEFAULT_TENANT_ID') return TENANT_ID;
              return def;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<PortalVerificationService>(PortalVerificationService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('issue()', () => {
    it('calls db.transaction to invalidate old tokens and insert new one', async () => {
      await service.issue({
        signupRequestId: SIGNUP_REQUEST_ID,
        tenantId: TENANT_ID,
        email: TEST_EMAIL,
        applicantName: 'Alice',
        organizationId: null,
      });

      expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    it('returns tokenId and expiresAt', async () => {
      const result = await service.issue({
        signupRequestId: SIGNUP_REQUEST_ID,
        tenantId: TENANT_ID,
        email: TEST_EMAIL,
        applicantName: null,
        organizationId: null,
      });

      expect(result.tokenId).toBeTruthy();
      expect(result.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('redeem()', () => {
    it('throws VERIFICATION_TOKEN_INVALID when token not found in DB', async () => {
      // DB returns no token rows
      db._selectChain.limit.mockResolvedValue([]);
      await expect(service.redeem('unknown-token', TENANT_ID))
        .rejects.toThrow(BadRequestException);
    });

    it('throws VERIFICATION_TOKEN_CONSUMED when consumed_at is set', async () => {
      const { rawToken, tokenHash, expiresAt } = generateToken(HMAC_KEY);
      const consumedToken = {
        tokenId: 'tok-1',
        signupRequestId: SIGNUP_REQUEST_ID,
        tenantId: TENANT_ID,
        tokenHash,
        expiresAt,
        consumedAt: new Date(), // already consumed
        attemptCount: 1,
        createdAt: new Date(),
      };
      const signupRow = {
        id: SIGNUP_REQUEST_ID,
        tenantId: TENANT_ID,
        email: TEST_EMAIL,
        emailHash: 'hash',
        applicantName: 'Alice',
        organizationId: null,
        status: 'pending_verification' as const,
        verifiedAt: null,
        verificationEmailStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      let callCount = 0;
      db.transaction.mockImplementation(async (cb: (tx: object) => Promise<void>) => {
        callCount++;
        const tx = {
          execute: jest.fn().mockResolvedValue(undefined),
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockImplementation(() => {
              return Promise.resolve(callCount === 1
                ? (tx.select as any)._call === 1 ? [consumedToken] : [signupRow]
                : []);
            }),
          }),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([]),
          }),
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnThis(),
            onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
          }),
        };
        return cb(tx);
      });

      // Simpler: patch the whole redeem flow - just verify the GoneException is thrown for consumed
      // by injecting token data directly via hash lookup
      // Test that consumed_at check works
      const { createHash } = require('crypto') as typeof import('crypto');
      const computedHash = createHash('sha256').update(rawToken).digest('hex');

      let selectCallIndex = 0;
      db.transaction.mockImplementation(async (cb: (tx: object) => Promise<void>) => {
        const tx = {
          execute: jest.fn().mockResolvedValue(undefined),
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockImplementation(() => {
              selectCallIndex++;
              if (selectCallIndex === 1) return Promise.resolve([consumedToken]);
              return Promise.resolve([signupRow]);
            }),
          }),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([]),
          }),
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnThis(),
            onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
          }),
        };
        return cb(tx);
      });

      await expect(service.redeem(rawToken, TENANT_ID))
        .rejects.toBeInstanceOf(GoneException);
    });

    it('throws VERIFICATION_TOKEN_EXPIRED for an expired token', async () => {
      const pastExpiry = new Date(Date.now() - 1000);
      const { rawToken, tokenHash } = generateToken(HMAC_KEY);
      const expiredToken = {
        tokenId: 'tok-expired',
        signupRequestId: SIGNUP_REQUEST_ID,
        tenantId: TENANT_ID,
        tokenHash,
        expiresAt: pastExpiry,
        consumedAt: null,
        attemptCount: 0,
        createdAt: new Date(),
      };
      const signupRow = {
        id: SIGNUP_REQUEST_ID,
        tenantId: TENANT_ID,
        email: TEST_EMAIL,
        emailHash: 'hash',
        applicantName: null,
        organizationId: null,
        status: 'pending_verification' as const,
        verifiedAt: null,
        verificationEmailStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      let selectCallIndex = 0;
      db.transaction.mockImplementation(async (cb: (tx: object) => Promise<void>) => {
        const tx = {
          execute: jest.fn().mockResolvedValue(undefined),
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockImplementation(() => {
              selectCallIndex++;
              if (selectCallIndex === 1) return Promise.resolve([expiredToken]);
              return Promise.resolve([signupRow]);
            }),
          }),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([]),
          }),
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnThis(),
            onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
          }),
        };
        return cb(tx);
      });

      await expect(service.redeem(rawToken, TENANT_ID))
        .rejects.toBeInstanceOf(GoneException);
    });
  });

  describe('recordFailedAttempt()', () => {
    it('throws TooManyRequestsException when lockout key exists', async () => {
      redis.exists.mockResolvedValue(1);
      redis.ttl.mockResolvedValue(300);
      await expect(service.recordFailedAttempt('email-hash'))
        .rejects.toBeInstanceOf(TooManyRequestsException);
    });

    it('sets lockout after 5 failures', async () => {
      redis.exists.mockResolvedValue(0);
      redis.incr.mockResolvedValue(5); // threshold
      await expect(service.recordFailedAttempt('email-hash'))
        .rejects.toBeInstanceOf(TooManyRequestsException);
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('verify:lock:'),
        '1',
        'EX',
        900,
      );
    });

    it('does not throw below threshold', async () => {
      redis.exists.mockResolvedValue(0);
      redis.incr.mockResolvedValue(2);
      await expect(service.recordFailedAttempt('email-hash')).resolves.toBeUndefined();
    });
  });

  describe('resend()', () => {
    it('returns accepted regardless of whether a request exists', async () => {
      // No pending signup request found
      const result = await service.resend(TEST_EMAIL, TENANT_ID);
      expect(result.status).toBe('accepted');
    });

    it('throws TooManyRequestsException when hourly limit exceeded', async () => {
      redis.exists.mockResolvedValue(0);
      redis.get.mockImplementation((key: string) => {
        if (key.includes('resend:hour')) return Promise.resolve('3');
        return Promise.resolve(null);
      });
      redis.ttl.mockResolvedValue(1800);
      await expect(service.resend(TEST_EMAIL, TENANT_ID))
        .rejects.toBeInstanceOf(TooManyRequestsException);
    });
  });
});
