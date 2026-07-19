import { test, expect } from '@playwright/test';
import { trackConsole, realErrors } from './helpers';

// These run WITHOUT seeding a key, so the app stays gated behind onboarding.
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = trackConsole(page);
});

test('ONB-01 first-run setup screen appears (gated)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('app-onboarding')).toBeVisible();
  await expect(page.locator('app-onboarding-setup-flow')).toBeVisible();
  // Chat UI must not be reachable yet.
  await expect(page.locator('app-home-hero')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/onb-01-setup.png', fullPage: true });
  expect(realErrors(errors), realErrors(errors).join('\n')).toEqual([]);
});

test('ONB-05 passphrase validation blocks weak secret', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('app-onboarding-setup-flow')).toBeVisible();
  // Paste a key and turn on "Remember" to require a passphrase.
  await page.getByLabel('Gemini API key').fill('AIza-fake-key-for-ui');
  await page.getByRole('switch').first().click();
  // Type a too-short passphrase and blur to trigger validation.
  const pass = page.getByLabel('Passphrase', { exact: true });
  await pass.fill('short');
  await pass.blur();
  await expect(page.locator('mat-error', { hasText: /Use at least \d+ characters/i })).toBeVisible();
  await page.screenshot({ path: 'artifacts/onb-05-validation.png', fullPage: true });
});
