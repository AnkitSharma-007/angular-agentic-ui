import { test, expect, type Page } from '@playwright/test';
import { seedSessionKey, trackConsole } from './helpers';

// Live home/chat + multi-agent cases. Consolidated so a single agent turn
// exercises several test IDs, keeping quota use low.
const SHOT = 'artifacts';
const KEY = process.env.GEMINI_TEST_KEY ?? '';

const LET_ME_CHOOSE =
  'Find flights from Bengaluru to Goa on 2026-06-13 for one passenger. Show me the options, let me pick one, then book it for Ankit Sharma and map the trip.';
// Logistics-only so it stays with the Trip Planner (which owns renderItinerary)
// instead of handing off to the Curator, who lacks the map tool.
const ROUTE_MAP =
  'Render a map of my driving route only: start in Bengaluru, stop in Mysuru, finish in Coorg. Plot just these three waypoints on a map. Do NOT suggest activities, food, hotels, or restaurants, do NOT hand off to another agent, and do NOT create any new tools.';
// Completes reliably (~20-30s) and ends with a markdown summary.
const FLIGHTS_THEN_HANDOFF =
  'My Lisbon hotel is already booked. For my 3-day weekend (June 5-7, 2026; 2 travelers from London Heathrow) just show me a couple of flight options — do NOT book anything and do NOT create any new tools. As soon as you have shown the flight options, hand off to the Experience Curator to recommend a few must-do activities.';

test.describe('live home + agents (needs API key)', () => {
  test.skip(!KEY, 'GEMINI_TEST_KEY not set — skipping live home/agent cases');

  test.beforeEach(async ({ page }) => {
    trackConsole(page);
    await seedSessionKey(page, KEY);
  });

  async function gotoHome(page: Page) {
    await page.goto('/');
    await expect(page.locator('textarea.composer-input')).toBeVisible();
  }

  // CMP-02 (shortcut) + CMP-05 + HOME-11 (concurrent guard) + HOME-09 (markdown) + HOME-06 (clear)
  test('keyboard send, streaming lock, markdown, clear', async ({ page }) => {
    test.setTimeout(150_000);
    await gotoHome(page);
    const textarea = page.locator('textarea.composer-input');
    await textarea.fill(FLIGHTS_THEN_HANDOFF);
    // CMP-02: send via the keyboard shortcut (Ctrl+Enter is bound alongside Cmd+Enter).
    await textarea.press('Control+Enter');

    // CMP-05 / HOME-11: while streaming the composer shows Cancel and no Send (no concurrent send).
    await expect(page.getByRole('button', { name: 'Cancel streaming' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Send prompt' })).toHaveCount(0);

    // HOME-09: response renders formatted markdown (rendered elements, not raw ** / - markup).
    const responseCard = page.locator('mat-card.response-card');
    await expect(responseCard).toBeVisible({ timeout: 150_000 });
    await expect(page.getByRole('button', { name: 'Save conversation' })).toBeVisible({
      timeout: 150_000,
    });
    expect(
      await responseCard.locator('li, strong, em, h1, h2, h3, code, a').count(),
    ).toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOT}/home-09-markdown.png`, fullPage: true });

    // HOME-06: Clear returns to the empty state.
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.locator('app-home-hero')).toBeVisible();
  });

  // AGENT-05 (comparison renders) + AGENT-03 (interactive pick continues) + HOME-12 (layout)
  test('interactive let-me-choose renders options and continues on pick', async ({ page }) => {
    test.setTimeout(240_000);
    await gotoHome(page);
    await page.locator('textarea.composer-input').fill(LET_ME_CHOOSE);
    await page.getByRole('button', { name: 'Send prompt' }).click();

    // AGENT-05: an interactive comparison card renders with selectable options.
    const table = page.locator('app-comparison-table');
    await expect(table).toBeVisible({ timeout: 180_000 });
    const chooseButtons = table.getByRole('button', { name: 'Choose this' });
    expect(await chooseButtons.count()).toBeGreaterThanOrEqual(2);
    // HOME-12: multi-card layout has no horizontal overflow.
    expect(
      await page.evaluate(() => {
        const el = document.scrollingElement || document.documentElement;
        return el.scrollWidth > el.clientWidth + 2;
      }),
    ).toBe(false);
    await page.screenshot({ path: `${SHOT}/agent-05-comparison.png`, fullPage: true });

    // AGENT-03: picking an option is accepted and the loop resumes (option marked chosen).
    await chooseButtons.first().click();
    await expect(table.locator('.option.chosen')).toBeVisible({ timeout: 30_000 });
    // The card leaves the pending state (Choose buttons disappear) once the pick is consumed.
    await expect(table.getByRole('button', { name: 'Choose this' })).toHaveCount(0, {
      timeout: 30_000,
    });
    await page.screenshot({ path: `${SHOT}/agent-03-picked.png`, fullPage: true });
  });

  // AGENT-04 (itinerary map renders)
  test('itinerary map renders for a route prompt', async ({ page }) => {
    test.setTimeout(200_000);
    await gotoHome(page);
    await page.locator('textarea.composer-input').fill(ROUTE_MAP);
    await page.getByRole('button', { name: 'Send prompt' }).click();
    await expect(page.locator('app-itinerary-map')).toBeVisible({ timeout: 180_000 });
    await page.screenshot({ path: `${SHOT}/agent-04-map.png`, fullPage: true });
  });

  // ERR-01 (network failure) + HOME-07 (error banner + retry last prompt)
  test('API failure shows a readable error and retry re-runs', async ({ page }) => {
    test.setTimeout(120_000);
    let blockApi = true;
    await page.route(/generativelanguage|googleapis/, (route) => {
      if (blockApi) route.abort('failed');
      else route.continue();
    });
    await gotoHome(page);
    await page.locator('textarea.composer-input').fill('Say hello in one short sentence.');
    await page.getByRole('button', { name: 'Send prompt' }).click();

    const errorBanner = page.locator('.banner.error');
    await expect(errorBanner).toBeVisible({ timeout: 45_000 });
    const retry = page.getByRole('button', { name: 'Retry last prompt' });
    await expect(retry).toBeVisible();
    await page.screenshot({ path: `${SHOT}/err-01-error-banner.png`, fullPage: true });

    // HOME-07: with the network restored, Retry re-runs the same prompt.
    blockApi = false;
    await retry.click();
    await expect(page.getByRole('button', { name: 'Cancel streaming' })).toBeVisible({
      timeout: 30_000,
    });
    // Stop to conserve quota — the retry path is what we're verifying.
    await page.getByRole('button', { name: 'Cancel streaming' }).dispatchEvent('click');
    await expect(page.getByText('Stream cancelled.')).toBeVisible({ timeout: 15_000 });
  });
});
