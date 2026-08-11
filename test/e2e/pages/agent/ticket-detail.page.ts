/**
 * TicketDetailPage — page object for the agent ticket detail view.
 *
 * Covers: comment authoring, status transitions, SLA timer display,
 * Jira link section, resolve modal trigger and AI summary display.
 */

import { Page, Locator } from '@playwright/test';

export class TicketDetailPage {
  constructor(readonly page: Page) {}

  async waitForLoad(): Promise<void> {
    await this.page.waitForSelector('[data-testid="ticket-detail"]', { timeout: 10_000 });
  }

  // ── Ticket metadata ───────────────────────────────────────────────────────

  subject(): Locator {
    return this.page.locator('[data-testid="ticket-subject"]');
  }

  status(): Locator {
    return this.page.locator('[data-testid="ticket-status"]');
  }

  priority(): Locator {
    return this.page.locator('[data-testid="ticket-priority"]');
  }

  slaTimer(): Locator {
    return this.page.locator('[data-testid="sla-timer"]');
  }

  slaState(): Locator {
    return this.page.locator('[data-sla-state]');
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  async addComment(body: string, visibility: 'public' | 'internal' = 'public'): Promise<void> {
    await this.page.locator('[data-testid="comment-body-input"]').fill(body);
    if (visibility === 'internal') {
      await this.page.locator('[data-testid="comment-visibility-internal"]').click();
    }
    await this.page.locator('[data-testid="comment-submit"]').click();
    await this.page.waitForSelector('[data-testid="comment-list"]', { timeout: 5_000 });
  }

  comments(): Locator {
    return this.page.locator('[data-testid="comment-item"]');
  }

  internalComments(): Locator {
    return this.page.locator('[data-testid="comment-item"][data-visibility="internal"]');
  }

  // ── SLA controls ─────────────────────────────────────────────────────────

  async pauseSla(reason = 'Pending customer input'): Promise<void> {
    await this.page.locator('[data-testid="sla-pause-btn"]').click();
    await this.page.locator('[data-testid="sla-pause-reason"]').fill(reason);
    await this.page.locator('[data-testid="sla-pause-confirm"]').click();
    await this.page.waitForSelector('[data-sla-state="paused"]', { timeout: 5_000 });
  }

  async resumeSla(): Promise<void> {
    await this.page.locator('[data-testid="sla-resume-btn"]').click();
    await this.page.waitForSelector('[data-sla-state="running"]', { timeout: 5_000 });
  }

  // ── Jira integration ──────────────────────────────────────────────────────

  async createJiraIssue(): Promise<string> {
    await this.page.locator('[data-testid="create-jira-issue-btn"]').click();
    await this.page.waitForSelector('[data-testid="jira-link-row"]', { timeout: 15_000 });
    const issueKey = await this.page
      .locator('[data-testid="jira-issue-key"]')
      .first()
      .textContent();
    return issueKey?.trim() ?? '';
  }

  jiraLinkRows(): Locator {
    return this.page.locator('[data-testid="jira-link-row"]');
  }

  jiraLinkedStatus(): Locator {
    return this.page.locator('[data-testid="jira-linked-status"]');
  }

  // ── Resolve flow ──────────────────────────────────────────────────────────

  async openResolveModal(): Promise<void> {
    await this.page.locator('[data-testid="resolve-btn"]').click();
    await this.page.waitForSelector('[data-testid="resolve-modal"]', { timeout: 5_000 });
  }

  resolveModal(): Locator {
    return this.page.locator('[data-testid="resolve-modal"]');
  }

  async confirmResolve(resolutionNote = ''): Promise<void> {
    if (resolutionNote) {
      await this.page.locator('[data-testid="resolve-note-input"]').fill(resolutionNote);
    }
    await this.page.locator('[data-testid="resolve-confirm-btn"]').click();
    // Wait for status to reflect resolved
    await this.page.waitForSelector('[data-testid="ticket-status"][data-status="resolved"]', {
      timeout: 8_000,
    });
  }

  // ── AI synthesis ──────────────────────────────────────────────────────────

  aiSummarySection(): Locator {
    return this.page.locator('[data-testid="ai-summary-section"]');
  }

  aiStatus(): Locator {
    return this.page.locator('[data-testid="ai-status"]');
  }

  aiSummaryText(): Locator {
    return this.page.locator('[data-testid="ai-summary-text"]');
  }

  affectedAreaTags(): Locator {
    return this.page.locator('[data-testid="affected-area-tag"]');
  }
}
