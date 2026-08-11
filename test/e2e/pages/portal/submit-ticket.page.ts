/**
 * PortalSubmitTicketPage — page object for the customer portal ticket submission form.
 */

import { Page, Locator } from '@playwright/test';

export class PortalSubmitTicketPage {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/tickets/new');
    await this.page.waitForSelector('[data-testid="submit-ticket-form"]', { timeout: 10_000 });
  }

  async fillSubject(subject: string): Promise<void> {
    await this.page.locator('[data-testid="ticket-subject-input"]').fill(subject);
  }

  async fillBody(body: string): Promise<void> {
    await this.page.locator('[data-testid="ticket-body-input"]').fill(body);
  }

  async selectCategory(path: string[]): Promise<void> {
    // Category picker may be a multi-level dropdown — click each level
    for (const segment of path) {
      await this.page.locator(`[data-testid="category-option"][data-value="${segment}"]`).click();
    }
  }

  async setPriority(priority: 'P1' | 'P2' | 'P3' | 'P4'): Promise<void> {
    await this.page.locator(`[data-testid="priority-option-${priority}"]`).click();
  }

  async submit(): Promise<string> {
    await this.page.locator('[data-testid="submit-ticket-btn"]').click();
    // Wait for success confirmation and extract the created ticket ID
    await this.page.waitForSelector('[data-testid="ticket-created-confirmation"]', {
      timeout: 10_000,
    });
    const ticketId = await this.page
      .locator('[data-testid="created-ticket-id"]')
      .getAttribute('data-ticket-id');
    return ticketId ?? '';
  }

  submitButton(): Locator {
    return this.page.locator('[data-testid="submit-ticket-btn"]');
  }

  errorBanner(): Locator {
    return this.page.locator('[data-testid="submit-error-banner"]');
  }

  successConfirmation(): Locator {
    return this.page.locator('[data-testid="ticket-created-confirmation"]');
  }

  // ── Keyboard navigation helpers ──────────────────────────────────────────

  async tabToSubmit(): Promise<void> {
    // Tab from body input through any remaining fields to the submit button
    let iterations = 0;
    while (iterations < 20) {
      await this.page.keyboard.press('Tab');
      const focused = await this.page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (focused === 'submit-ticket-btn') break;
      iterations++;
    }
  }
}
