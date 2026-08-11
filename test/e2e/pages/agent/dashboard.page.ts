/**
 * DashboardPage — page object for the agent dashboard / KPI overview.
 */

import { Page, Locator } from '@playwright/test';

export class DashboardPage {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/dashboard');
    await this.page.waitForSelector('[data-testid="dashboard"]', { timeout: 10_000 });
  }

  kpiCounter(name: 'open' | 'breached' | 'approaching' | 'resolved-today'): Locator {
    return this.page.locator(`[data-testid="kpi-${name}"]`);
  }

  async getKpiValue(name: 'open' | 'breached' | 'approaching' | 'resolved-today'): Promise<number> {
    const text = await this.kpiCounter(name).textContent();
    return parseInt(text?.trim() ?? '0', 10);
  }

  approachingBreachRows(): Locator {
    return this.page.locator('[data-testid="approaching-breach-row"]');
  }

  realtimeIndicator(): Locator {
    return this.page.locator('[data-testid="realtime-connected"]');
  }

  async waitForRealtimeConnected(timeoutMs = 10_000): Promise<void> {
    await this.page.waitForSelector('[data-testid="realtime-connected"]', { timeout: timeoutMs });
  }
}
