import { test, expect, type Page } from '@playwright/test';
import { seedSessionKey, trackConsole } from './helpers';

// Live settings / custom-tool / library-replay cases.
const SHOT = 'artifacts';
const KEY = process.env.GEMINI_TEST_KEY ?? '';
const SHORT_TURN =
  'My Lisbon hotel is already booked. For my 3-day weekend (June 5-7, 2026; 2 travelers from London Heathrow) just show me a couple of flight options — do NOT book anything and do NOT create any new tools, then give a one-line summary.';

test.describe('live settings/tools/library (needs API key)', () => {
  test.skip(!KEY, 'GEMINI_TEST_KEY not set — skipping live settings/tools/library cases');

  test.beforeEach(async ({ page }) => {
    trackConsole(page);
    await seedSessionKey(page, KEY);
  });

  async function homeReady(page: Page) {
    await expect(page.locator('textarea.composer-input')).toBeVisible();
  }

  // SET-01: chosen model is used for subsequent turns (verified on the wire).
  test('SET-01 selected model is used on the next turn', async ({ page }) => {
    test.setTimeout(90_000);
    let captured = '';
    await page.route(/generativelanguage|googleapis/, (route) => {
      const req = route.request();
      if (!captured && /models\//.test(req.url())) {
        captured = `${req.url()} ${req.postData() ?? ''}`;
      }
      route.continue();
    });

    await page.goto('/settings');
    await page.locator('app-model-picker-card mat-select').click();
    await page.getByRole('option', { name: /Flash-Lite/ }).click();
    await expect(page.locator('app-model-picker-card mat-select')).toContainText('Flash-Lite');

    // Navigate within the SPA (a full reload would reset the in-memory selection).
    await page.getByRole('link', { name: 'Chat', exact: true }).click();
    await homeReady(page);
    await page.locator('textarea.composer-input').fill('Say hello in one short sentence.');
    await page.getByRole('button', { name: 'Send prompt' }).click();

    await expect(page.getByRole('button', { name: 'Cancel streaming' })).toBeVisible({
      timeout: 30_000,
    });
    expect(captured, captured).toContain('gemini-3.1-flash-lite');
    await page.getByRole('button', { name: 'Cancel streaming' }).dispatchEvent('click');
  });

  // TOOL-07: the agent calls a user-defined custom tool.
  test('TOOL-07 agent invokes a custom tool', async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto('/tools');
    await page.getByRole('button', { name: 'New tool' }).click();
    await page.getByRole('button', { name: 'Load example' }).click();
    await expect(page.locator('input[placeholder="searchWeather"]')).toHaveValue('searchWeather');
    await page.getByRole('button', { name: 'Create tool' }).click();
    await expect(page.locator('.saved-badge')).toBeVisible();

    await page.getByRole('link', { name: 'Chat', exact: true }).click();
    await homeReady(page);
    await page
      .locator('textarea.composer-input')
      .fill(
        'Use your searchWeather tool to get the weather forecast for Goa on 2026-06-13. Do not create any new tools.',
      );
    await page.getByRole('button', { name: 'Send prompt' }).click();
    await expect(page.locator('app-custom-tool-card')).toBeVisible({ timeout: 120_000 });
    await page.screenshot({ path: `${SHOT}/tool-07-custom-tool-call.png`, fullPage: true });
  });

  // LIB-04 (speed) + LIB-05 (stop/restart) + LIB-06 (two-step delete)
  test('LIB-04/05/06 replay speed, stop/restart, delete', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    await homeReady(page);
    await page.locator('textarea.composer-input').fill(SHORT_TURN);
    await page.getByRole('button', { name: 'Send prompt' }).click();
    const save = page.getByRole('button', { name: 'Save conversation' });
    await expect(save).toBeVisible({ timeout: 150_000 });
    await save.click();
    // Wait for the write to commit ("Saved" is set only after the IndexedDB put resolves).
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 15_000 });

    // Regression: the saved-conversations badge must hydrate on a fresh home load,
    // not only after the Library route runs its own refresh.
    await page.reload();
    await expect(page.locator('app-home-hero')).toBeVisible();
    await expect(page.locator('.library-count')).toHaveText('1');

    // Open the library and start a replay.
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(page.locator('app-replay-list-item')).toHaveCount(1);
    await page.getByRole('button', { name: 'Replay' }).click();

    const banner = page.locator('.replay-banner');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner.getByText('Replaying saved conversation')).toBeVisible();

    // LIB-04: change the replay speed.
    const pills = banner.locator('.speed-pill');
    const fastest = pills.nth((await pills.count()) - 1);
    await fastest.click();
    await expect(fastest).toHaveClass(/active/);

    // LIB-05: stop, then restart.
    await banner.getByRole('button', { name: 'Stop' }).click();
    await expect(banner.getByText('Replay stopped')).toBeVisible({ timeout: 10_000 });
    await banner.getByRole('button', { name: 'Restart' }).click();
    await expect(banner.getByText(/Replaying saved conversation|Replay complete/)).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({ path: `${SHOT}/lib-05-replay-controls.png`, fullPage: true });

    // LIB-06: two-step delete from the library.
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(page.locator('app-replay-list-item')).toHaveCount(1);
    await page.getByRole('button', { name: 'Delete saved conversation' }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('No saved conversations yet')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOT}/lib-06-deleted.png`, fullPage: true });
  });
});
