import { test, expect, type Page } from '@playwright/test';
import { seedSessionKey, trackConsole } from './helpers';

// Fault-injection cases. ERR-02 needs a live-ish key so a turn actually starts
// (the Gemini request is then hung to force the stall timeout). ERR-03 forces an
// uncaught error and asserts the global handler surfaces it.
const SHOT = 'artifacts';
const KEY = process.env.GEMINI_TEST_KEY ?? 'stall-test-key';

async function gotoHome(page: Page) {
  await seedSessionKey(page, KEY);
  await page.goto('/');
  await expect(page.locator('textarea.composer-input')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  trackConsole(page);
});

// ERR-02: the inter-chunk stall timeout is verified by a unit test
// (agent-loop.spec.ts › 'runAgentTurn — stall timeout'). It can't be driven
// end-to-end here: fully hanging the request makes the SDK's `await streamChunks()`
// (which waits for response headers) never resolve, so the inter-chunk timer is
// never armed; reproducing it would need a mock server that sends 200 headers and
// then withholds the body — which Playwright's route.fulfill cannot keep open.
test.fixme('ERR-02 stalled stream surfaces a retryable timeout error (unit-covered)', () => {});

// ERR-03: an uncaught error is caught by the global handler and surfaced (toast).
test('ERR-03 global error handler surfaces an uncaught error', async ({ page }) => {
  test.setTimeout(30_000);
  await gotoHome(page);
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e-forced-uncaught-error');
    }, 0);
  });
  const toast = page.locator('app-notification-host .toast');
  await expect(toast.first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOT}/err-03-global-handler.png`, fullPage: true });
});
