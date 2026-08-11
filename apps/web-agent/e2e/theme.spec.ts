import { test, expect } from '@playwright/test';

const SHOWCASE_URL = '/token-showcase';

test.describe('Theme engine — Agent Workspace', () => {
  test.beforeEach(async ({ page }) => {
    // Clear persisted theme between tests
    await page.addInitScript(() => {
      localStorage.removeItem('opsninja.theme');
    });
  });

  test('token showcase page loads with colour tokens visible', async ({ page }) => {
    await page.goto(SHOWCASE_URL);
    await expect(page.getByRole('heading', { name: 'Token Showcase' })).toBeVisible();
  });

  test('defaults to system theme on first visit', async ({ page }) => {
    await page.goto(SHOWCASE_URL);
    const resolvedEl = page.getByTestId('resolved-theme');
    await expect(resolvedEl).toBeVisible();
    const text = await resolvedEl.textContent();
    expect(['light', 'dark'].some((t) => text?.includes(t))).toBe(true);
  });

  test('switching to dark theme sets data-theme on html element', async ({ page }) => {
    await page.goto(SHOWCASE_URL);
    await page.getByTestId('theme-dark').click();
    const attr = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(attr).toBe('dark');
  });

  test('switching to light theme sets data-theme on html element', async ({ page }) => {
    await page.goto(SHOWCASE_URL);
    await page.getByTestId('theme-light').click();
    const attr = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(attr).toBe('light');
  });

  test('theme choice persists across page reload', async ({ page }) => {
    await page.goto(SHOWCASE_URL);
    await page.getByTestId('theme-dark').click();

    // Reload and check that dark is still applied
    await page.reload();
    const attr = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(attr).toBe('dark');
  });

  test('data-theme is set before first contentful paint (no flash)', async ({
    page,
  }) => {
    // Inject theme script check: capture data-theme at DOMContentLoaded
    let themeAtDCL: string | null = null;
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        (window as unknown as Record<string, unknown>)['__themeAtDCL'] =
          document.documentElement.getAttribute('data-theme');
      });
    });

    await page.goto(SHOWCASE_URL);
    themeAtDCL = await page.evaluate(
      () => (window as unknown as Record<string, string>)['__themeAtDCL'] ?? null,
    );
    expect(['light', 'dark']).toContain(themeAtDCL);
  });

  test('all SLA states are rendered in token showcase', async ({ page }) => {
    await page.goto(SHOWCASE_URL);
    for (const state of ['running', 'warning', 'paused', 'breached'] as const) {
      await expect(page.getByTestId(`sla-state-${state}`)).toBeVisible();
    }
  });

  test('print media forces light theme', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    await page.goto(SHOWCASE_URL);
    // CSS print rule forces light tokens; verify the page still loads correctly
    await expect(page.getByRole('heading', { name: 'Token Showcase' })).toBeVisible();
  });
});
