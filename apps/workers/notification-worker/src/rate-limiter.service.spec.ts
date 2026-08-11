import { RateLimiterService } from './rate-limiter.service';

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    eval: jest.fn().mockResolvedValue(1),
    disconnect: jest.fn(),
  }));
});

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let mockEval: jest.Mock;

  beforeEach(() => {
    const Redis = jest.requireMock('ioredis') as jest.Mock;
    const mockRedis = {
      on: jest.fn(),
      eval: jest.fn().mockResolvedValue(1),
      disconnect: jest.fn(),
    };
    Redis.mockImplementation(() => mockRedis);
    mockEval = mockRedis.eval;
    service = new RateLimiterService('redis://localhost:6379');
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('returns true when bucket has tokens (Lua returns 1)', async () => {
    mockEval.mockResolvedValueOnce(1);
    await expect(service.tryConsume('tenant-1')).resolves.toBe(true);
  });

  it('returns false when bucket is empty (Lua returns 0)', async () => {
    mockEval.mockResolvedValueOnce(0);
    await expect(service.tryConsume('tenant-1')).resolves.toBe(false);
  });

  it('fails open on Redis error', async () => {
    mockEval.mockRejectedValueOnce(new Error('Redis connection refused'));
    await expect(service.tryConsume('tenant-1')).resolves.toBe(true);
  });

  it('uses the correct key format notif:rate:{tenantId}', async () => {
    mockEval.mockResolvedValueOnce(1);
    await service.tryConsume('tenant-abc');
    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String), // Lua script
      1,
      'notif:rate:tenant-abc',
      expect.any(String), // capacity
      expect.any(String), // windowMs
      expect.any(String), // now
    );
  });
});
