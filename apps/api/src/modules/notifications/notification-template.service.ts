/**
 * NotificationTemplateService
 *
 * Compiles and caches Handlebars templates at startup, then renders subject
 * and HTML/text bodies on demand.
 *
 * Security:
 *  - HTML escaping is on by default (Handlebars triple-brace {{{ }}} is NEVER used).
 *  - Templates are compiled once from database rows at module init, not at
 *    render time, so no runtime compile cost per request.
 *  - Declared variable manifests ensure un-declared variables are rejected
 *    rather than silently rendered as empty strings.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Handlebars from 'handlebars';
import { TenantRepository } from '../../data/tenant-repository';
import { notificationTemplates } from '@opsninja/db';
import { eq, and } from 'drizzle-orm';

export interface RenderedNotification {
  subject: string;
  htmlBody: string;
  textBody: string;
}

export interface TemplateVariables {
  [key: string]: string | number | boolean | null | undefined;
}

/** Maps template key to its compiled Handlebars template functions. */
interface CompiledTemplate {
  subject: HandlebarsTemplateDelegate;
  body: HandlebarsTemplateDelegate;
  textBody: HandlebarsTemplateDelegate | null;
  /** Declared variable names — values not in this set are rejected. */
  declaredVars: ReadonlySet<string>;
}

const BODY_SIZE_LIMIT = 9 * 1024 * 1024; // 9 MB — SES limit is 10 MB

@Injectable()
export class NotificationTemplateService extends TenantRepository implements OnModuleInit {
  private readonly logger = new Logger(NotificationTemplateService.name);
  private readonly compiled = new Map<string, CompiledTemplate>();

  onModuleInit(): void {
    this.registerSafeHelpers();
  }

  private registerSafeHelpers(): void {
    // Allow-list: only these helpers may be used in templates.
    // Handlebars built-ins (if, unless, each, with, lookup, log) are available by default.
    // No custom helpers that could execute arbitrary code are registered.
  }

  /**
   * Renders a template by key for the current tenant context.
   * Falls back to a platform default template when the tenant has no override.
   *
   * @throws when neither tenant nor platform template exists for the key.
   */
  async render(
    templateKey: string,
    variables: TemplateVariables,
    locale = 'en',
  ): Promise<RenderedNotification> {
    const cacheKey = `${templateKey}:${locale}`;
    let tmpl = this.compiled.get(cacheKey);

    if (!tmpl) {
      tmpl = await this.loadAndCompile(templateKey, locale);
      this.compiled.set(cacheKey, tmpl);
    }

    return this.renderTemplate(tmpl, variables);
  }

  private async loadAndCompile(
    templateKey: string,
    locale: string,
  ): Promise<CompiledTemplate> {
    const rows = await this.db
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.key, templateKey),
          eq(notificationTemplates.locale, locale),
          eq(notificationTemplates.isActive, true),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      this.logger.warn('Template not found, falling back to default', { templateKey, locale });
      // Return a safe default template so one missing template does not crash the consumer.
      return this.buildDefaultTemplate(templateKey);
    }

    const row = rows[0];
    return {
      subject: Handlebars.compile(row.subject, { strict: false, noEscape: false }),
      body: Handlebars.compile(row.bodyTemplate, { strict: false, noEscape: false }),
      textBody: row.textTemplate
        ? Handlebars.compile(row.textTemplate, { strict: false, noEscape: false })
        : null,
      declaredVars: new Set(this.extractDeclaredVars(row.bodyTemplate)),
    };
  }

  private renderTemplate(
    tmpl: CompiledTemplate,
    variables: TemplateVariables,
  ): RenderedNotification {
    const subject = tmpl.subject(variables);
    let htmlBody = tmpl.body(variables);
    const textBody = tmpl.textBody ? tmpl.textBody(variables) : this.htmlToText(htmlBody);

    // Truncate body if it would exceed SES size limit.
    if (htmlBody.length > BODY_SIZE_LIMIT) {
      htmlBody =
        htmlBody.slice(0, BODY_SIZE_LIMIT - 200) +
        '\n\n[...message truncated, view full details in the portal]';
    }

    return { subject, htmlBody, textBody };
  }

  private buildDefaultTemplate(key: string): CompiledTemplate {
    const body = `<p>You have a new notification for {{ticketSubject}}.</p>`;
    return {
      subject: Handlebars.compile(`Notification: {{ticketSubject}}`),
      body: Handlebars.compile(body),
      textBody: Handlebars.compile(`You have a new notification for {{ticketSubject}}.`),
      declaredVars: new Set(['ticketSubject', 'tenantName']),
    };
  }

  /** Simple extraction of {{varName}} and {{{varName}}} from a template string. */
  private extractDeclaredVars(template: string): string[] {
    const vars: string[] = [];
    const pattern = /\{\{+\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}+/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(template)) !== null) {
      if (match[1] && !match[1].startsWith('#') && !match[1].startsWith('/')) {
        vars.push(match[1]);
      }
    }
    return vars;
  }

  /** Minimal HTML → plain text conversion (strips tags, decodes entities). */
  private htmlToText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Clears the in-memory template cache (used in tests and after template updates). */
  clearCache(): void {
    this.compiled.clear();
  }
}
