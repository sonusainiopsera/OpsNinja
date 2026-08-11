/**
 * AdminOrganizationsPage — page object for the admin org management drawer.
 */

import { Page, Locator } from '@playwright/test';

export class AdminOrganizationsPage {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/admin/organizations');
    await this.page.waitForSelector('[data-testid="admin-orgs-list"]', { timeout: 10_000 });
  }

  orgRows(): Locator {
    return this.page.locator('[data-testid="admin-org-row"]');
  }

  orgDrawerTrigger(orgId: string): Locator {
    return this.page.locator(`[data-testid="admin-org-row"][data-org-id="${orgId}"]`);
  }

  async openOrgDrawer(orgId: string): Promise<void> {
    await this.orgDrawerTrigger(orgId).click();
    await this.page.waitForSelector('[data-testid="org-drawer"]', { timeout: 5_000 });
  }

  orgDrawer(): Locator {
    return this.page.locator('[data-testid="org-drawer"]');
  }

  orgDrawerCloseBtn(): Locator {
    return this.page.locator('[data-testid="org-drawer-close"]');
  }

  async closeOrgDrawer(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.page.waitForSelector('[data-testid="org-drawer"]', {
      state: 'hidden',
      timeout: 3_000,
    });
  }

  slaPolicy(orgId: string): Locator {
    return this.page.locator(`[data-testid="org-sla-policy"][data-org-id="${orgId}"]`);
  }
}
