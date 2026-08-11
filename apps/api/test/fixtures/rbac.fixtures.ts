/**
 * RBAC test fixtures.
 *
 * Provides:
 *   - Pre-signed access tokens for each of the six seeded roles
 *   - Role-permission matrix for assertion in tests
 *   - Helpers for building mock ExecutionContexts for guard unit tests
 */

import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { getTestSigningKeyPair, TEST_KID, TEST_ISSUER, TEST_AUDIENCE } from './session.fixtures';
import { TENANT_A_ID, TENANT_A_STAFF_USER_ID, TENANT_B_ID } from '../factories/principal-context.factory';
import { ROLE_PERMISSIONS, type Permission } from '../../src/common/auth/permission.catalog';

// ---------------------------------------------------------------------------
// Token factory (signs real JWTs using the test RSA key pair)
// ---------------------------------------------------------------------------

import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

export type TestRole = 'admin' | 'manager' | 'agent' | 'lead_analyst' | 'integration_admin' | 'portal_user' | 'machine';

export interface TokenForRoleOptions {
  userId?: string;
  tenantId?: string;
  roles?: string[];
  userType?: 'staff' | 'portal' | 'machine';
  audience?: string;
  expiresIn?: number;
}

/**
 * Mint a real RS256 access token for a given role, using the test signing key.
 */
export function mintTokenForRole(role: TestRole, options: TokenForRoleOptions = {}): string {
  const { privateKeyPem } = getTestSigningKeyPair();

  const userType: string =
    options.userType ?? (role === 'portal_user' ? 'portal' : role === 'machine' ? 'machine' : 'staff');

  const audience = options.audience ?? TEST_AUDIENCE;

  return jwt.sign(
    {
      sub: options.userId ?? TENANT_A_STAFF_USER_ID,
      tenant_id: options.tenantId ?? TENANT_A_ID,
      roles: options.roles ?? [role],
      org_scope_version: 1,
      user_type: userType,
      jti: randomUUID(),
      iss: TEST_ISSUER,
    },
    privateKeyPem,
    {
      algorithm: 'RS256',
      expiresIn: options.expiresIn ?? 900,
      keyid: TEST_KID,
    },
  );
}

/**
 * Pre-signed tokens for each role — generated at module load.
 */
export const ROLE_TOKENS: Record<TestRole, string> = {
  admin: mintTokenForRole('admin'),
  manager: mintTokenForRole('manager'),
  agent: mintTokenForRole('agent'),
  lead_analyst: mintTokenForRole('lead_analyst'),
  integration_admin: mintTokenForRole('integration_admin'),
  portal_user: mintTokenForRole('portal_user', { userType: 'portal' }),
  machine: mintTokenForRole('machine', { userType: 'machine' }),
};

/**
 * An expired token — signed with nbf in the past and exp already elapsed.
 */
export function mintExpiredToken(): string {
  const { privateKeyPem } = getTestSigningKeyPair();
  return jwt.sign(
    {
      sub: TENANT_A_STAFF_USER_ID,
      tenant_id: TENANT_A_ID,
      roles: ['agent'],
      org_scope_version: 1,
      user_type: 'staff',
      jti: randomUUID(),
      iss: TEST_ISSUER,
    },
    privateKeyPem,
    {
      algorithm: 'RS256',
      expiresIn: -1, // already expired
      keyid: TEST_KID,
    },
  );
}

// ---------------------------------------------------------------------------
// Role-permission matrix for test assertions
// ---------------------------------------------------------------------------

/**
 * Expected permissions for each test role.
 * Assertions use this fixture rather than re-implementing the resolution logic.
 */
export const EXPECTED_PERMISSIONS: Record<TestRole, Set<Permission>> = Object.fromEntries(
  (Object.keys(ROLE_TOKENS) as TestRole[]).map((role) => [
    role,
    new Set<Permission>(ROLE_PERMISSIONS[role] ?? []),
  ]),
) as Record<TestRole, Set<Permission>>;

// ---------------------------------------------------------------------------
// ExecutionContext mock factory for guard unit tests
// ---------------------------------------------------------------------------

export interface MockExecutionContextOptions {
  /** Bearer token in Authorization header (omit to test missing-token path) */
  bearerToken?: string;
  /** Route metadata — pass 'require_permission' or 'is_public' */
  handlerMetadata?: Record<string, unknown>;
  classMetadata?: Record<string, unknown>;
  method?: string;
  path?: string;
}

/**
 * Build a mock NestJS ExecutionContext and a matching Reflector for unit tests.
 */
export function buildMockContext(options: MockExecutionContextOptions = {}): {
  context: ExecutionContext;
  reflector: Reflector;
} {
  const headers: Record<string, string> = {
    'x-trace-id': randomUUID(),
  };
  if (options.bearerToken) {
    headers['authorization'] = `Bearer ${options.bearerToken}`;
  }

  const mockRequest = {
    headers,
    method: options.method ?? 'GET',
    path: options.path ?? '/api/v1/tickets',
    socket: { remoteAddress: '127.0.0.1' },
    user: undefined as unknown,
  };

  const handlerFn = jest.fn();
  const controllerClass = jest.fn();

  const context = {
    getHandler: () => handlerFn,
    getClass: () => controllerClass,
    switchToHttp: () => ({
      getRequest: () => mockRequest,
    }),
  } as unknown as ExecutionContext;

  // Reflector that returns metadata based on what's in options
  const reflector = new Reflector();

  // Attach metadata to the mock handler/class functions
  const hm = options.handlerMetadata ?? {};
  const cm = options.classMetadata ?? {};

  jest.spyOn(reflector, 'getAllAndOverride').mockImplementation(
    (key: string | symbol, targets: [object, object]) => {
      const [handler, controller] = targets;
      const handlerVal = handler === handlerFn ? hm[String(key)] : undefined;
      const classVal = controller === controllerClass ? cm[String(key)] : undefined;
      return handlerVal ?? classVal ?? undefined;
    },
  );

  return { context, reflector };
}
