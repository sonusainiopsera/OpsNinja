/**
 * PortalVisibilityGuard — second enforcement layer after AuthGuard.
 *
 * Validates that the authenticated principal is a portal principal with a valid
 * bound organisation.  Applied at the controller level on all portal routes so
 * every handler in PortalTicketsController is protected without per-handler
 * decoration.
 *
 * Runs after AuthGuard (which validates the JWT and audience) and after
 * TenantContextInterceptor sets up the tenant transaction.  The guard is
 * therefore safe to assume req.user exists and is a fully populated PrincipalContext.
 *
 * Denial produces 403 AUTHZ_AUDIENCE_MISMATCH (not 401) because the token itself
 * is valid — only the principal type is wrong.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ErrorCode } from '../../../common/errors/app-errors';
import type { PrincipalContext } from '../../../observability/request-context';
import { isPortalPrincipal } from '../../identity/portal/portal-principal';

@Injectable()
export class PortalVisibilityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: PrincipalContext }>();
    const principal = req.user;

    if (!principal) {
      // AuthGuard must have run first; this indicates a pipeline misconfiguration
      throw new ForbiddenException({
        code: ErrorCode.AUTHZ_AUDIENCE_MISMATCH,
        message: 'Portal access requires an authenticated portal principal.',
      });
    }

    if (!isPortalPrincipal(principal)) {
      throw new ForbiddenException({
        code: ErrorCode.AUTHZ_AUDIENCE_MISMATCH,
        message: 'Portal routes require a portal-audience token with an org scope.',
      });
    }

    return true;
  }
}
