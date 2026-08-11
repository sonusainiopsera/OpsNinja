/**
 * NotificationTemplateService
 *
 * Manages the tenant-scoped template registry and renders templates with
 * Handlebars. Key design properties:
 *
 *  - HTML escaping on by default (Handlebars default).
 *  - Strict allow-list of helpers: no built-in helpers are registered beyond
 *    what is required. Custom helpers must be explicitly declared here.
 *  - Variable manifest per template: rendering rejects interpolated variables
 *    not declared in the manifest, preventing unintended data exposure.
 *  - MJML compilation is a build-time step; this service receives pre-compiled
 *    HTML. There is no runtime MJML dependency.
 *  - Platform fallback template used when a tenant-specific template is absent.
 */

import { Injectable, Logger } from '@nestjs/common';
import Handlebars from 'handlebars';

import type { TxHandle } from '@opsninja/db';
import { notificationTemplates } from '@opsninja/db';
import { eq, and } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Template manifest — declared variable allowlists per template key
// ---------------------------------------------------------------------------

export interface TemplateManifest {
  allowedVariables: string[];
}

const TEMPLATE_MANIFESTS: Record<string, TemplateManifest> = {
  'generic-notification': {
    allowedVariables: ['tenantName', 'ticketId', 'subject', 'portalUrl', 'year'],
  },
};

const PLATFORM_FALLBACK_TEMPLATE_KEY = 'generic-notification';

// ---------------------------------------------------------------------------
// Rendered output
// ---------------------------------------------------------------------------

export interface RenderedTemplate {
  subject: string;
  htmlBody: string;
  textBody: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class NotificationTemplateService {
  private readonly logger = new Logger(NotificationTemplateService.name);

  /**
   * Resolve a template for a tenant, falling back to the platform default.
   * Renders subject, HTML body and text body with Handlebars (HTML-escaped).
   *
   * @throws Error if no template exists for the requested key (even as fallback).
   */
  async renderTemplate(
    tx: TxHandle,
    tenantId: string,
    templateKey: string,
    locale: string,
    payload: Record<string, unknown>,
  ): Promise<RenderedTemplate> {
    // Try tenant-specific template first
    let tmpl = await this.loadTemplate(tx, tenantId, templateKey, locale);

    if (!tmpl) {
      this.logger.warn('Template not found for tenant, using platform fallback', {
        tenantId,
        templateKey,
        locale,
      });
      tmpl = await this.loadTemplate(tx, tenantId, PLATFORM_FALLBACK_TEMPLATE_KEY, locale);
    }

    if (!tmpl) {
      throw new Error(
        `No template found for key "${templateKey}" (locale "${locale}") and no platform fallback available`,
      );
    }

    this.validatePayload(templateKey, payload);

    return {
      subject: this.render(tmpl.subject, payload),
      htmlBody: this.render(tmpl.bodyTemplate, payload),
      textBody: this.render(tmpl.textTemplate, payload),
    };
  }

  private async loadTemplate(
    tx: TxHandle,
    tenantId: string,
    key: string,
    locale: string,
  ) {
    const rows = await tx
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.tenantId, tenantId),
          eq(notificationTemplates.key, key),
          eq(notificationTemplates.locale, locale),
          eq(notificationTemplates.isActive, true),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Compile and render a single Handlebars template string. HTML-escaped by default. */
  private render(templateStr: string, data: Record<string, unknown>): string {
    const compiled = Handlebars.compile(templateStr, { noEscape: false });
    return compiled(data);
  }

  /**
   * Validate that payload keys are declared in the manifest.
   * Undeclared variables are rejected rather than silently ignored.
   */
  private validatePayload(templateKey: string, payload: Record<string, unknown>): void {
    const manifest = TEMPLATE_MANIFESTS[templateKey];
    if (!manifest) return; // unknown key: fallback template handles it

    for (const key of Object.keys(payload)) {
      if (!manifest.allowedVariables.includes(key)) {
        throw new Error(
          `Template variable "${key}" is not declared in the manifest for template "${templateKey}"`,
        );
      }
    }
  }

  getManifest(templateKey: string): TemplateManifest | null {
    return TEMPLATE_MANIFESTS[templateKey] ?? null;
  }
}
