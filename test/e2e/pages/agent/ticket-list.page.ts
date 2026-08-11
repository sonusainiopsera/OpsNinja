/**
 * TicketListPage — page object for the agent ticket queue (/queue).
 *
 * All raw selectors are encapsulated here. Spec files only call typed methods
 * so a UI refactor touches one layer, not every test.
 */

import { Page, Locator, expect } from '@playwright/test';

export class TicketListPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto('/queue');
    await this.page.waitForSelector('[data-testid="ticket-list"]', { timeout: 10_000 });
  }

  ticketRows(): Locator {
    return this.page.locator('[data-testid="ticket-row"]');
  }

  ticketRowById(id: string): Locator {
    return this.page.locator(`[data-testid="ticket-row"][data-ticket-id="${id}"]`);
  }

  slaStateCell(ticketId: string): Locator {
    return this.page.locator(`[data-testid="ticket-row"][data-ticket-id="${ticketId}"] [data-sla-state]`);
  }

  async ticketCount(): Promise<number> {
    return this.ticketRows().count();
  }

  async openTicket(id: string): Promise<void> {
    await this.ticketRowById(id).click();
    await this.page.waitForSelector('[data-testid="ticket-detail"]', { timeout: 8_000 });
  }

  /** Navigate to saved-view builder. */
  async openSavedViewBuilder(): Promise<void> {
    await this.page.locator('[data-testid="saved-view-builder-open"]').click();
    await this.page.waitForSelector('[data-testid="saved-view-builder"]', { timeout: 5_000 });
  }

  /** Apply a saved view by slug. */
  async applySavedView(slug: string): Promise<void> {
    await this.page.locator(`[data-testid="saved-view-${slug}"]`).click();
    await this.page.waitForSelector('[data-testid="ticket-list"]', { timeout: 8_000 });
  }

  /** Assert the queue renders the exact set of ticket IDs. */
  async assertQueueContains(expectedIds: Set<string>): Promise<void> {
    const rows = this.ticketRows();
    const count = await rows.count();
    const renderedIds = new Set<string>();
    for (let i = 0; i < count; i++) {
      const id = await rows.nth(i).getAttribute('data-ticket-id');
      if (id) renderedIds.add(id);
    }
    for (const id of expectedIds) {
      expect(renderedIds.has(id), `Expected ticket ${id} in queue`).toBe(true);
    }
    expect(renderedIds.size).toBe(expectedIds.size);
  }

  /** Dashboard KPI counter locators. */
  kpiCounter(name: 'open' | 'breached' | 'approaching'): Locator {
    return this.page.locator(`[data-testid="kpi-${name}"]`);
  }
}
