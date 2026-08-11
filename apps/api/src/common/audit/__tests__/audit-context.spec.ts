import { AuditContext, AuditContextMissingError } from '../audit-context';

const baseCtx = {
  tenantId: 'tenant-1',
  actorType: 'user' as const,
  actorId: 'user-1',
  actorRole: 'admin',
  traceId: 'trace-1',
  requestId: 'req-1',
  hashedIp: 'abc123',
  userAgent: 'Jest/1.0',
  source: null,
};

describe('AuditContext', () => {
  it('returns undefined when no context is active', () => {
    expect(AuditContext.get()).toBeUndefined();
  });

  it('getOrThrow throws AuditContextMissingError outside a context', () => {
    expect(() => AuditContext.getOrThrow()).toThrow(AuditContextMissingError);
  });

  it('run() makes context available via get()', async () => {
    let captured: ReturnType<typeof AuditContext.get>;
    await AuditContext.run(baseCtx, async () => {
      captured = AuditContext.get();
    });
    expect(captured).toEqual(baseCtx);
  });

  it('run() makes context available via getOrThrow()', async () => {
    await AuditContext.run(baseCtx, async () => {
      expect(AuditContext.getOrThrow()).toEqual(baseCtx);
    });
  });

  it('context is isolated between concurrent runs', async () => {
    const ctxA = { ...baseCtx, tenantId: 'tenant-a' };
    const ctxB = { ...baseCtx, tenantId: 'tenant-b' };

    const results: string[] = [];
    await Promise.all([
      AuditContext.run(ctxA, async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(AuditContext.getOrThrow().tenantId!);
      }),
      AuditContext.run(ctxB, async () => {
        results.push(AuditContext.getOrThrow().tenantId!);
      }),
    ]);

    expect(results).toContain('tenant-a');
    expect(results).toContain('tenant-b');
  });

  it('hashIp returns a 16-char hex string', () => {
    const h = AuditContext.hashIp('192.168.1.1');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('hashIp is deterministic', () => {
    expect(AuditContext.hashIp('10.0.0.1')).toBe(AuditContext.hashIp('10.0.0.1'));
  });

  it('hashIp differs for different IPs', () => {
    expect(AuditContext.hashIp('1.2.3.4')).not.toBe(AuditContext.hashIp('5.6.7.8'));
  });

  it('anonymous actor context: null tenantId and actorId are valid', async () => {
    const anonymousCtx = {
      ...baseCtx,
      tenantId: null,
      actorId: null,
      actorType: 'anonymous' as const,
    };
    await AuditContext.run(anonymousCtx, async () => {
      const ctx = AuditContext.getOrThrow();
      expect(ctx.tenantId).toBeNull();
      expect(ctx.actorId).toBeNull();
      expect(ctx.actorType).toBe('anonymous');
    });
  });
});
