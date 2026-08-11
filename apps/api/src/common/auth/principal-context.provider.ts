/**
 * Request-scoped PrincipalContext provider.
 *
 * Exposes the immutable authenticated principal to services via dependency
 * injection so that no module other than the auth guard and interceptor layer
 * needs to import the HTTP Request object.
 *
 * Usage in services:
 *   constructor(
 *     @Inject(PRINCIPAL_CONTEXT_TOKEN) private readonly principal: PrincipalContext,
 *   ) {}
 *
 * NOTE: Services that inject PRINCIPAL_CONTEXT_TOKEN must be declared with
 * scope: Scope.REQUEST (or have their module use REQUEST scope) because
 * request-scoped providers cannot be injected into default (singleton) scoped
 * providers without re-declaring the consumer as request-scoped.
 */

import { FactoryProvider, Inject, Scope, UnauthorizedException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import type { PrincipalContext } from '../../observability/request-context';

export const PRINCIPAL_CONTEXT_TOKEN = 'PRINCIPAL_CONTEXT';

export const PrincipalContextProvider: FactoryProvider = {
  provide: PRINCIPAL_CONTEXT_TOKEN,
  scope: Scope.REQUEST,
  inject: [REQUEST],
  useFactory: (req: Request & { user?: PrincipalContext }): Readonly<PrincipalContext> => {
    if (!req.user) {
      throw new UnauthorizedException({
        message: 'Principal context requested outside an authenticated request.',
        code: 'UNAUTHENTICATED',
      });
    }
    return Object.freeze({ ...req.user });
  },
};

/** Re-export for convenience so consumers only need one import. */
export { Inject };
