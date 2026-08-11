/**
 * NotificationPreferencesRepository — WO-081.
 *
 * Reads and writes notification_preferences rows inside the ambient tenant
 * transaction (TenantRepository pattern). All writes are validated against the
 * event catalogue before reaching the DB.
 *
 * Cache invalidation is handled by NotificationPreferencesService, not here.
 */

import { Injectable } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';

import { notificationPreferences } from '@opsninja/db';
import type {
  NotificationPreference,
  NewNotificationPreference,
  NotificationScope,
  NotificationMode,
} from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';

export interface UpsertPreferenceParams {
  tenantId: string;
  scope: NotificationScope;
  contactId: string | null;
  organizationId: string;
  eventType: string;
  channel: string;
  mode: NotificationMode;
  updatedBy: string;
}

@Injectable()
export class NotificationPreferencesRepository extends TenantRepository {
  /**
   * Returns all preference rows for a specific contact (contact-level overrides).
   */
  async findByContact(
    tenantId: string,
    contactId: string,
  ): Promise<NotificationPreference[]> {
    return this.tx
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, tenantId),
          eq(notificationPreferences.scope, 'contact'),
          eq(notificationPreferences.contactId, contactId),
        ),
      );
  }

  /**
   * Returns all preference rows for an organization (org-level defaults).
   */
  async findByOrganization(
    tenantId: string,
    organizationId: string,
  ): Promise<NotificationPreference[]> {
    return this.tx
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, tenantId),
          eq(notificationPreferences.scope, 'organization'),
          eq(notificationPreferences.organizationId, organizationId),
          isNull(notificationPreferences.contactId),
        ),
      );
  }

  /**
   * Returns the effective mode for one (contact, event_type, channel) triple.
   * Checks contact-level first, falls back to org-level, falls back to 'immediate'.
   */
  async getEffectiveMode(
    tenantId: string,
    contactId: string,
    organizationId: string,
    eventType: string,
    channel: string,
  ): Promise<NotificationMode> {
    // Contact-level override wins
    const contactRows = await this.tx
      .select({ mode: notificationPreferences.mode })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, tenantId),
          eq(notificationPreferences.scope, 'contact'),
          eq(notificationPreferences.contactId, contactId),
          eq(notificationPreferences.eventType, eventType),
          eq(notificationPreferences.channel, channel),
        ),
      )
      .limit(1);

    if (contactRows[0]) {
      return contactRows[0].mode;
    }

    // Org-level default
    const orgRows = await this.tx
      .select({ mode: notificationPreferences.mode })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, tenantId),
          eq(notificationPreferences.scope, 'organization'),
          eq(notificationPreferences.organizationId, organizationId),
          isNull(notificationPreferences.contactId),
          eq(notificationPreferences.eventType, eventType),
          eq(notificationPreferences.channel, channel),
        ),
      )
      .limit(1);

    return (orgRows[0]?.mode as NotificationMode) ?? 'immediate';
  }

  /**
   * Upsert a preference row.
   * Uses ON CONFLICT to handle the partial unique indexes.
   */
  async upsert(params: UpsertPreferenceParams): Promise<NotificationPreference> {
    const values: NewNotificationPreference = {
      tenantId: params.tenantId,
      scope: params.scope,
      contactId: params.contactId ?? undefined,
      organizationId: params.organizationId,
      eventType: params.eventType,
      channel: params.channel,
      mode: params.mode,
      updatedBy: params.updatedBy,
      updatedAt: new Date(),
    };

    // Use insert + ON CONFLICT DO UPDATE to handle both create and update.
    const inserted = await this.tx
      .insert(notificationPreferences)
      .values(values)
      .onConflictDoUpdate({
        target:
          params.scope === 'contact'
            ? [
                notificationPreferences.tenantId,
                notificationPreferences.contactId,
                notificationPreferences.eventType,
                notificationPreferences.channel,
              ]
            : [
                notificationPreferences.tenantId,
                notificationPreferences.organizationId,
                notificationPreferences.eventType,
                notificationPreferences.channel,
              ],
        set: {
          mode: params.mode,
          updatedBy: params.updatedBy,
          updatedAt: new Date(),
        },
      })
      .returning();

    return inserted[0]!;
  }

  /**
   * Delete all preference rows for a contact (used when resetting to defaults).
   */
  async deleteByContact(tenantId: string, contactId: string): Promise<void> {
    await this.tx
      .delete(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, tenantId),
          eq(notificationPreferences.scope, 'contact'),
          eq(notificationPreferences.contactId, contactId),
        ),
      );
  }

  /**
   * Delete all org-level preference rows for an organization.
   */
  async deleteByOrganization(tenantId: string, organizationId: string): Promise<void> {
    await this.tx
      .delete(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, tenantId),
          eq(notificationPreferences.scope, 'organization'),
          eq(notificationPreferences.organizationId, organizationId),
        ),
      );
  }
}
