/**
 * Route-inventory test — ensures all registered routes either declare a
 * required permission or are explicitly marked @Public.
 *
 * An undeclared, non-public route would be denied by default by the AuthGuard.
 * While this is the correct security posture, it means a new controller method
 * would silently become unreachable without an obvious error. This test
 * catches that at build time and forces the author to make an explicit choice.
 *
 * When a new controller is added, import it here and add it to CONTROLLERS.
 */

import 'reflect-metadata';

import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';
import { PUBLIC_KEY } from './public.decorator';
import { HealthController } from '../../health/health.controller';
import { AuthController } from '../../modules/identity/auth.controller';
import { AdminAuthController } from '../../modules/identity/admin.auth.controller';
import { PortalTicketsController } from '../../modules/tickets/portal/portal-tickets.controller';
import { PortalAttachmentsController } from '../../modules/tickets/portal/portal-attachments.controller';
import { AgentScopesController } from '../../modules/organizations/agent-scopes.controller';
import { UsersController } from '../../modules/users/users.controller';
import { ViewsController } from '../../modules/views/views.controller';
import { SlaPoliciesController } from '../../modules/sla/sla-policies.controller';
import { SlaCalendarsController } from '../../modules/sla/sla-calendars.controller';
import { JiraConnectionsController } from '../../modules/jira/connections/jira-connections.controller';
import { JiraOAuthController } from '../../modules/jira/oauth/jira-oauth.controller';
import { JiraLinksController } from '../../modules/jira/links/jira-links.controller';
import { JiraHealthController } from '../../modules/jira/health/jira-health.controller';
import { JiraAuditController } from '../../modules/jira/audit/jira-audit.controller';
import { OrganizationsController } from '../../modules/organizations/organizations.controller';
import { ContactsController } from '../../modules/organizations/contacts/contacts.controller';
import { TicketsController } from '../../modules/tickets/tickets.controller';
import { CommentsController } from '../../modules/tickets/comments/comments.controller';
import { AttachmentsController, AttachmentDownloadController } from '../../modules/tickets/attachments/attachments.controller';
import { AuditController } from '../../modules/audit/audit.controller';
import { SubjectRequestsController } from '../../modules/privacy/subject-requests.controller';
import { AiAdminController } from '../../modules/ai/ai-admin.controller';
import { AiSynthesisAdminController } from '../../modules/ai/ai-synthesis-admin.controller';

// NestJS sets 'path' and 'method' metadata keys on route handler methods.
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

/**
 * All registered application controllers.
 * !! ADD NEW CONTROLLERS HERE when they are created !!
 */
const CONTROLLERS: Function[] = [
  HealthController,
  AuthController,
  AdminAuthController,
  PortalTicketsController,
  PortalAttachmentsController,
  AgentScopesController,
  UsersController,
  ViewsController,
  SlaPoliciesController,
  SlaCalendarsController,
  JiraConnectionsController,
  JiraOAuthController,
  JiraLinksController,
  JiraHealthController,
  JiraAuditController,
  OrganizationsController,
  ContactsController,
  TicketsController,
  CommentsController,
  AttachmentsController,
  AttachmentDownloadController,
  AuditController,
  SubjectRequestsController,
  AiAdminController,
  AiSynthesisAdminController,
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

interface UndeclaredRoute {
  controller: string;
  method: string;
}

function findUndeclaredRoutes(controllers: Function[]): UndeclaredRoute[] {
  const undeclared: UndeclaredRoute[] = [];

  for (const Controller of controllers) {
    // Class-level @Public or @RequirePermission applies to all methods
    const isPublicClass = Reflect.getMetadata(PUBLIC_KEY, Controller) as boolean | undefined;
    const classPermissions = Reflect.getMetadata(REQUIRE_PERMISSION_KEY, Controller) as
      | string[]
      | undefined;

    if (isPublicClass || (classPermissions && classPermissions.length > 0)) {
      continue; // all methods in this controller are covered
    }

    const prototype = Controller.prototype as Record<string, unknown>;
    const methodNames = Object.getOwnPropertyNames(prototype).filter(
      (m) => m !== 'constructor',
    );

    for (const methodName of methodNames) {
      const handler = prototype[methodName];
      if (typeof handler !== 'function') continue;

      // Only inspect methods that are route handlers (have NestJS routing metadata)
      const hasPath = Reflect.getMetadata(PATH_METADATA, handler) !== undefined;
      const hasHttpMethod = Reflect.getMetadata(METHOD_METADATA, handler) !== undefined;
      if (!hasPath && !hasHttpMethod) continue;

      const isPublicMethod = Reflect.getMetadata(PUBLIC_KEY, handler) as boolean | undefined;
      const methodPermissions = Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler) as
        | string[]
        | undefined;

      if (!isPublicMethod && (!methodPermissions || methodPermissions.length === 0)) {
        undeclared.push({
          controller: Controller.name,
          method: methodName,
        });
      }
    }
  }

  return undeclared;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('Route inventory', () => {
  it('all registered routes have either @RequirePermission or @Public', () => {
    const undeclared = findUndeclaredRoutes(CONTROLLERS);

    if (undeclared.length > 0) {
      const formatted = undeclared
        .map((r) => `  ${r.controller}.${r.method}`)
        .join('\n');
      throw new Error(
        `The following route handlers lack a @RequirePermission or @Public declaration.\n` +
          `Add @Public() to bypass auth, or @RequirePermission(...) to enforce RBAC:\n${formatted}`,
      );
    }

    expect(undeclared).toHaveLength(0);
  });

  it('HealthController is @Public', () => {
    const isPublic = Reflect.getMetadata(PUBLIC_KEY, HealthController) as boolean | undefined;
    expect(isPublic).toBe(true);
  });

  it('AuthController is @Public', () => {
    const isPublic = Reflect.getMetadata(PUBLIC_KEY, AuthController) as boolean | undefined;
    expect(isPublic).toBe(true);
  });

  it('PortalTicketsController is @PortalRoute', () => {
    const { PORTAL_ROUTE_KEY } = require('./portal-route.decorator') as { PORTAL_ROUTE_KEY: string };
    const isPortal = Reflect.getMetadata(PORTAL_ROUTE_KEY, PortalTicketsController) as boolean | undefined;
    expect(isPortal).toBe(true);
  });

  it('PortalAttachmentsController is @PortalRoute', () => {
    const { PORTAL_ROUTE_KEY } = require('./portal-route.decorator') as { PORTAL_ROUTE_KEY: string };
    const isPortal = Reflect.getMetadata(PORTAL_ROUTE_KEY, PortalAttachmentsController) as boolean | undefined;
    expect(isPortal).toBe(true);
  });
});
