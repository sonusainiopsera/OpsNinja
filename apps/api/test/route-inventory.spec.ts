/**
 * Route inventory test.
 *
 * Bootstraps the full AppModule, enumerates all registered controller routes,
 * and asserts that every route has EITHER:
 *   a) a @RequirePermission(...) declaration, OR
 *   b) a @Public() marker, OR
 *   c) a @NoTenantContext() class-level exemption (auth and health routes).
 *
 * A route that has none of these will cause this test to fail, which prevents
 * unguarded endpoints from reaching production.
 */

import { Test } from '@nestjs/testing';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { REDIS_CLIENT } from '../src/common/redis/redis.provider';
import { DB_TOKEN } from '../src/data/db.module';
import { REQUIRE_PERMISSION_KEY, IS_PUBLIC_KEY } from '../src/common/auth/require-permission.decorator';
import { NO_TENANT_CONTEXT_KEY } from '../src/common/tenant/no-tenant-context.decorator';

function makeFakeRedis() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    scan: jest.fn().mockResolvedValue(['0', []]),
    del: jest.fn().mockResolvedValue(0),
    hset: jest.fn().mockResolvedValue(1),
    hmget: jest.fn().mockResolvedValue([]),
    hgetall: jest.fn().mockResolvedValue(null),
    hmset: jest.fn().mockResolvedValue('OK'),
    sadd: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    script: jest.fn().mockResolvedValue('sha'),
    eval: jest.fn().mockResolvedValue([1, 'ROTATED', '']),
    evalsha: jest.fn().mockResolvedValue([1, 'ROTATED', '']),
    pipeline: jest.fn().mockReturnValue({ hset: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) }),
    lazyConnect: jest.fn(),
  };
}

function makeFakeDb() {
  return {
    insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
    update: jest.fn().mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }) }),
    select: jest.fn().mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }),
    transaction: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({})),
    execute: jest.fn().mockResolvedValue([]),
  };
}

describe('Route inventory', () => {
  it('every registered route has a permission declaration, @Public(), or @NoTenantContext() exemption', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(REDIS_CLIENT)
      .useValue(makeFakeRedis())
      .overrideProvider(DB_TOKEN)
      .useValue(makeFakeDb())
      .compile();

    const discoveryService = moduleRef.get(DiscoveryService);
    const metadataScanner = moduleRef.get(MetadataScanner);
    const reflector = moduleRef.get(Reflector);

    const undeclaredRoutes: string[] = [];

    const controllers = discoveryService.getControllers();
    for (const wrapper of controllers) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;

      const controllerName = metatype.name ?? 'UnknownController';

      // Class-level exemptions apply to all handlers within the controller
      const classIsPublic = reflector.get<boolean>(IS_PUBLIC_KEY, metatype);
      const classIsExempt = reflector.get<boolean>(NO_TENANT_CONTEXT_KEY, metatype);
      if (classIsPublic || classIsExempt) continue;

      const methodNames = metadataScanner.getAllMethodNames(
        Object.getPrototypeOf(instance) as Record<string, unknown>,
      );

      for (const methodName of methodNames) {
        const handler = (instance as Record<string, unknown>)[methodName] as Function;
        if (typeof handler !== 'function') continue;

        const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, handler);
        const isExempt = reflector.get<boolean>(NO_TENANT_CONTEXT_KEY, handler);
        const hasPermission = reflector.get<string[]>(REQUIRE_PERMISSION_KEY, handler);

        if (!isPublic && !isExempt && !hasPermission) {
          undeclaredRoutes.push(`${controllerName}.${methodName}`);
        }
      }
    }

    await moduleRef.close();

    if (undeclaredRoutes.length > 0) {
      throw new Error(
        `The following routes lack a @RequirePermission() or @Public() declaration:\n` +
          undeclaredRoutes.map((r) => `  - ${r}`).join('\n') +
          `\n\nAdd @RequirePermission(Permission.XXX) or @Public() to each route.`,
      );
    }

    expect(undeclaredRoutes).toHaveLength(0);
  });
});
