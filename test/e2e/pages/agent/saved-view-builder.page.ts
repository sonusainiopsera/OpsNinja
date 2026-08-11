/**
 * SavedViewBuilderPage — page object for the agent saved-view creation UI.
 */

import { Page, Locator } from '@playwright/test';

export interface SavedViewFilters {
  statuses?: string[];
  priorities?: string[];
  categories?: string[];
  tags?: string[];
  assignmentGroup?: string;
}

export class SavedViewBuilderPage {
  constructor(readonly page: Page) {}

  async waitForLoad(): Promise<void> {
    await this.page.waitForSelector('[data-testid="saved-view-builder"]', { timeout: 8_000 });
  }

  async setName(name: string): Promise<void> {
    await this.page.locator('[data-testid="saved-view-name-input"]').fill(name);
  }

  async addStatusFilter(status: string): Promise<void> {
    await this.page.locator('[data-testid="filter-status-select"]').click();
    await this.page.locator(`[data-testid="status-option-${status}"]`).click();
  }

  async addPriorityFilter(priority: string): Promise<void> {
    await this.page.locator('[data-testid="filter-priority-select"]').click();
    await this.page.locator(`[data-testid="priority-option-${priority}"]`).click();
  }

  async addCategoryFilter(category: string): Promise<void> {
    await this.page.locator('[data-testid="filter-category-input"]').fill(category);
    await this.page.locator(`[data-testid="category-suggestion-${category}"]`).click();
  }

  async addTagFilter(tag: string): Promise<void> {
    await this.page.locator('[data-testid="filter-tag-input"]').fill(tag);
    await this.page.locator(`[data-testid="tag-suggestion-${tag}"]`).click();
  }

  async setAssignmentGroup(group: string): Promise<void> {
    await this.page.locator('[data-testid="filter-assignment-group"]').fill(group);
  }

  async setScope(scope: 'private' | 'shared'): Promise<void> {
    await this.page.locator(`[data-testid="scope-${scope}"]`).click();
  }

  async save(): Promise<string> {
    await this.page.locator('[data-testid="saved-view-save-btn"]').click();
    await this.page.waitForSelector('[data-testid="saved-view-success"]', { timeout: 5_000 });
    const slug = await this.page
      .locator('[data-testid="saved-view-slug"]')
      .getAttribute('data-slug');
    return slug ?? '';
  }

  async pinView(slug: string): Promise<void> {
    await this.page
      .locator(`[data-testid="saved-view-pin-${slug}"]`)
      .click();
    await this.page.waitForSelector(`[data-testid="pinned-view-${slug}"]`, { timeout: 5_000 });
  }

  pinnedViews(): Locator {
    return this.page.locator('[data-testid^="pinned-view-"]');
  }
}
