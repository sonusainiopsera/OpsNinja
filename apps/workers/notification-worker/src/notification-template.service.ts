/**
 * Worker-side NotificationTemplateService.
 *
 * This is a stripped-down version used by the worker that queries the DB
 * directly via a raw pool connection (the worker is a standalone NestJS app,
 * not behind the HTTP interceptor stack).
 *
 * Template compilation happens at startup (onModuleInit) for perf.
 */

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Handlebars from 'handlebars';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { notificationTemplates } from '@opsninja/db';
import { eq, and } from 'drizzle-orm';
import { WORKER_DB_POOL } from './worker.module';

export interface RenderedNotification {
  subject: string;
  htmlBody: string;
  textBody: string;
}

export type TemplateVariables = Record<string, unknown>;

interface CompiledTemplate {
  subject: HandlebarsTemplateDelegate;
  body: HandlebarsTemplateDelegate;
  textBody: HandlebarsTemplateDelegate | null;
}

const BODY_TRUNCATE_LIMIT = 9 * 1024 * 1024;

@Injectable()
export class NotificationTemplateService implements OnModuleInit {
  private readonly logger = new Logger(NotificationTemplateService.name);
  private readonly compiled = new Map<string, CompiledTemplate>();

  constructor(@Inject(WORKER_DB_POOL) private readonly pool: Pool) {}

  onModuleInit(): void {
    // Nothing to pre-warm at startup — templates are loaded per-tenant on first use.
  }

  async render(
    templateKey: string,
    variables: TemplateVariables,
    tenantId: string,
    locale = 'en',
  ): Promise<RenderedNotification> {
    const cacheKey = `${tenantId}:${templateKey}:${locale}`;
    let tmpl = this.compiled.get(cacheKey);

    if (!tmpl) {
      tmpl = await this.loadTemplate(tenantId, templateKey, locale);
      this.compiled.set(cacheKey, tmpl);
    }

    return this.renderTemplate(tmpl, variables);
  }

  private async loadTemplate(
    tenantId: string,
    key: string,
    locale: string,
  ): Promise<CompiledTemplate> {
    const db = drizzle(this.pool);

    const rows = await db
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

    if (rows.length === 0) {
      this.logger.warn('Template not found; using fallback', { key, locale });
      return this.defaultTemplate(key);
    }

    const row = rows[0];
    return {
      subject: Handlebars.compile(row.subject, { noEscape: false }),
      body: Handlebars.compile(row.bodyTemplate, { noEscape: false }),
      textBody: row.textTemplate
        ? Handlebars.compile(row.textTemplate, { noEscape: false })
        : null,
    };
  }

  private renderTemplate(
    tmpl: CompiledTemplate,
    variables: TemplateVariables,
  ): RenderedNotification {
    const subject = tmpl.subject(variables);
    let htmlBody = tmpl.body(variables);
    const textBody = tmpl.textBody ? tmpl.textBody(variables) : this.htmlToText(htmlBody);

    if (htmlBody.length > BODY_TRUNCATE_LIMIT) {
      htmlBody =
        htmlBody.slice(0, BODY_TRUNCATE_LIMIT - 200) +
        '\n\n[...view the full details in the support portal]';
    }

    return { subject, htmlBody, textBody };
  }

  private defaultTemplate(key: string): CompiledTemplate {
    return {
      subject: Handlebars.compile('Notification: {{ticketSubject}}'),
      body: Handlebars.compile(
        '<p>You have a new notification regarding <strong>{{ticketSubject}}</strong>.</p>',
      ),
      textBody: Handlebars.compile(
        'You have a new notification regarding {{ticketSubject}}.',
      ),
    };
  }

  private htmlToText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }

  clearCache(): void {
    this.compiled.clear();
  }
}
