import { test, expect, type Page } from '@playwright/test';
import { seedSessionKey, trackConsole, realErrors } from './helpers';

// Live agent cases. These drive real Gemini calls, so the key is read from an
// env var (never committed). Skipped automatically when the key is absent.
const SHOT = 'artifacts';
const KEY = process.env.GEMINI_TEST_KEY ?? '';

test.describe('live agent (needs API key)', () => {
  test.skip(!KEY, 'GEMINI_TEST_KEY not set — skipping live agent cases');

  let errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors = trackConsole(page);
    await seedSessionKey(page, KEY);
  });

  async function submitPrompt(page: Page, text: string): Promise<void> {
    await page.goto('/');
    const textarea = page.locator('textarea.composer-input');
    await expect(textarea).toBeVisible();
    await textarea.fill(text);
    await page.getByRole('button', { name: 'Send prompt' }).click();
  }

  // AGENT-01/02 + REG-01 (handoff) + HOME-03 (streaming) + OBS-01/03 + HOME-05 (save) + LIB-02/03
  test('handoff round-trip: planner hands off, curator responds, save + replay', async ({
    page,
  }) => {
    test.setTimeout(360_000);
    await submitPrompt(
      page,
      'My Lisbon hotel is already booked. For my 3-day weekend (June 5-7, 2026; 2 travelers from London Heathrow) just show me a couple of flight options — do NOT book anything and do NOT create any new tools. As soon as you have shown the flight options, hand off to the Experience Curator to recommend a few must-do activities.',
    );

    // HOME-03: streaming lifecycle brings up the live agent graph.
    await expect(page.locator('app-agent-graph')).toBeVisible({ timeout: 45_000 });

    // AGENT-02 / REG-01: a hand-off to the Experience Curator is emitted…
    await expect(page.locator('app-handoff-notice')).toBeVisible({ timeout: 180_000 });

    // REG-01 core proof: the Curator actually acts after the hand-off (findActivities renders).
    await expect(page.locator('app-activity-list')).toBeVisible({ timeout: 180_000 });

    // Turn reaches a terminal 'complete' phase (Save button only shows when canSave()).
    const saveBtn = page.getByRole('button', { name: 'Save conversation' });
    await expect(saveBtn).toBeVisible({ timeout: 180_000 });
    await expect(page.locator('mat-card.response-card')).toBeVisible();
    await page.screenshot({ path: `${SHOT}/api-a-handoff.png`, fullPage: true });

    // OBS-01/03: observability drawer shows the four summary metrics + a waterfall.
    await page.getByRole('button', { name: 'Open observability dashboard' }).click();
    await expect(page.locator('aside.drawer.open')).toBeVisible();
    await expect(page.locator('aside.drawer section.summary app-metric')).toHaveCount(4);
    expect(await page.locator('aside.drawer .wf-rows .wf-row').count()).toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOT}/api-b-observability.png` });
    await page.keyboard.press('Escape');
    await expect(page.locator('aside.drawer')).not.toHaveClass(/open/);

    // HOME-05: persist the conversation.
    await saveBtn.click();
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 30_000 });

    // LIB-02: it appears in the library with a step count.
    await page.getByRole('link', { name: 'View in Library' }).click();
    await expect(page).toHaveURL(/\/library$/);
    const item = page.locator('app-replay-list-item').first();
    await expect(item).toBeVisible();
    await expect(item.getByText(/\d+ steps/)).toBeVisible();
    await page.screenshot({ path: `${SHOT}/api-c-library.png`, fullPage: true });

    // LIB-03: replay it.
    await item.getByRole('button', { name: 'Replay' }).click();
    await expect(page).toHaveURL(/\/(?:$|\?)|4300\/?$/);
    await expect(page.locator('app-replay-banner')).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${SHOT}/api-d-replay.png`, fullPage: true });
  });

  // HOME-04: cancel mid-stream.
  test('cancel mid-stream shows cancelled banner', async ({ page }) => {
    test.setTimeout(120_000);
    await submitPrompt(
      page,
      'Write a detailed six-paragraph essay about the history of cartography and mapmaking.',
    );
    const cancelBtn = page.getByRole('button', { name: 'Cancel streaming' });
    await expect(cancelBtn).toBeVisible({ timeout: 45_000 });
    await page.screenshot({ path: `${SHOT}/api-e-precancel.png`, fullPage: true });
    // The fixed-position cost-meter pill overlaps the composer's cancel button and
    // intercepts pointer events, so dispatch the click straight to the control.
    await cancelBtn.dispatchEvent('click');
    await expect(page.getByText('Stream cancelled.')).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${SHOT}/api-e-cancel.png`, fullPage: true });
  });

  // HOME-08: budget guard halts the run and surfaces the breach banner.
  test('budget breach halts the run', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('atlas:budget', JSON.stringify({ maxRounds: 1 }));
      } catch {
        /* storage unavailable */
      }
    });
    await submitPrompt(
      page,
      'Plan a weekend in Tokyo for 2 travelers, flying from San Francisco (SFO), departing Friday June 12 and returning Sunday June 14, 2026. Choose sensible options yourself without asking me to confirm — find flights and a hotel, then suggest a few activities.',
    );
    await expect(page.locator('.banner.budget-breach')).toBeVisible({ timeout: 150_000 });
    await expect(page.getByText('Budget reached.')).toBeVisible();
    await page.screenshot({ path: `${SHOT}/api-f-budget.png`, fullPage: true });
  });

  // RESP-02 / REG-02 / REG-03: agent graph stacks vertically on a phone during a live run.
  test('mobile agent graph stacks during a live run', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await submitPrompt(page, 'Plan a weekend in Rome with flights, a hotel, and activities.');
    const graph = page.locator('app-agent-graph');
    await expect(graph).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(4000);
    await graph.screenshot({ path: `${SHOT}/api-g-mobile-graph.png` });
    await page.screenshot({ path: `${SHOT}/api-g-mobile-full.png`, fullPage: true });
    const cancelBtn = page.getByRole('button', { name: 'Cancel streaming' });
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
    }
  });

  test.afterEach(() => {
    // Surface non-benign console errors for the report (not a hard gate for live runs).
    const real = realErrors(errors);
    if (real.length) {
      console.log('\n[console errors during test]\n' + real.join('\n'));
    }
  });
});
