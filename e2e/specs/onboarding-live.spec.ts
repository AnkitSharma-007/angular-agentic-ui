import { test, expect, type Page } from '@playwright/test';
import { trackConsole } from './helpers';

// Live onboarding flows. These drive the real setup/unlock UI and call
// gemini.testConnection with the provided key (no agent turns). Skipped when
// no key is present.
const SHOT = 'artifacts';
const KEY = process.env.GEMINI_TEST_KEY ?? '';
const PASSPHRASE = 'Zephyr-Quokka-Lantern-8842';

test.describe('live onboarding (needs API key)', () => {
  test.skip(!KEY, 'GEMINI_TEST_KEY not set — skipping live onboarding cases');

  test.beforeEach(async ({ page }) => {
    trackConsole(page);
  });

  async function verifyKey(page: Page): Promise<void> {
    await page.goto('/');
    await expect(page.locator('app-onboarding-setup-flow')).toBeVisible();
    await page.getByLabel('Gemini API key').fill(KEY);
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('Connection works. You can save.')).toBeVisible({
      timeout: 30_000,
    });
  }

  // ONB-02 + ONB-03 + ERR-05
  test('verify key, session-only save unlocks, not persisted to a new tab', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await verifyKey(page); // ONB-02

    // ONB-03: session-only save unlocks the app.
    const save = page.getByRole('button', { name: 'Continue for this session' });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.locator('app-home-hero')).toBeVisible();
    await page.screenshot({ path: `${SHOT}/onb-03-session-unlocked.png`, fullPage: true });

    // Reload keeps the session (sessionStorage survives a reload in the same tab).
    await page.reload();
    await expect(page.locator('app-home-hero')).toBeVisible();

    // ERR-05: a fresh tab has no session key → back to onboarding (session not persisted to disk).
    const page2 = await context.newPage();
    await page2.goto('/');
    await expect(page2.locator('app-onboarding-setup-flow')).toBeVisible();
    await page2.close();
  });

  // ONB-06
  test('invalid key is rejected and Save stays disabled', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/');
    await expect(page.locator('app-onboarding-setup-flow')).toBeVisible();
    await page.getByLabel('Gemini API key').fill('abc123-not-a-real-key');
    await page.getByRole('button', { name: 'Test connection' }).click();
    const banner = page.locator('app-status-banner');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Connection works. You can save.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue for this session' })).toBeDisabled();
    // Onboarding is gated, so the error must not send users to an unreachable Settings page.
    await expect(banner).not.toContainText(/Open Settings/i);
    await expect(banner).toContainText(/rejected|AI Studio/i);
    await page.screenshot({ path: `${SHOT}/onb-06-invalid-key.png`, fullPage: true });
  });

  // ONB-04 + ONB-07 + ONB-08 + ERR-04
  test('encrypted key: remember, reload → unlock, wrong/right passphrase, forget', async ({
    page,
  }) => {
    test.setTimeout(75_000);
    await verifyKey(page); // ONB-04 pre-req (verified key)

    // ONB-04: remember with a passphrase, save encrypted.
    await page.locator('mat-slide-toggle').click();
    await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
    await page.getByLabel('Confirm passphrase', { exact: true }).fill(PASSPHRASE);
    const saveEnc = page.getByRole('button', { name: 'Save (encrypted)' });
    await expect(saveEnc).toBeEnabled();
    await saveEnc.click();
    await expect(page.locator('app-home-hero')).toBeVisible();

    // ERR-04 / ONB-04: reload shows the unlock flow (key persisted to localStorage).
    await page.reload();
    await expect(page.locator('app-onboarding-unlock-flow')).toBeVisible();
    await page.screenshot({ path: `${SHOT}/onb-04-unlock-flow.png`, fullPage: true });

    // ONB-07: wrong passphrase is rejected.
    await page.getByLabel('Passphrase', { exact: true }).fill('totally-wrong-passphrase');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(
      page.getByText('That passphrase did not unlock the stored key. Try again.'),
    ).toBeVisible({ timeout: 15_000 });

    // ONB-07: correct passphrase unlocks.
    await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.locator('app-home-hero')).toBeVisible();

    // ONB-08: on the unlock screen, two-step "forget" clears the stored key.
    await page.reload();
    await expect(page.locator('app-onboarding-unlock-flow')).toBeVisible();
    await page.getByRole('button', { name: 'Forget saved key' }).click();
    await page.getByRole('button', { name: 'Forget key' }).click();
    await expect(page.locator('app-onboarding-setup-flow')).toBeVisible();
    await page.screenshot({ path: `${SHOT}/onb-08-forgotten.png`, fullPage: true });
  });
});
