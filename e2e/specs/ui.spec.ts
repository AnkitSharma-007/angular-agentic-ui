import { test, expect, type Page } from '@playwright/test';
import { seedSessionKey, trackConsole, realErrors } from './helpers';

const SHOT = 'artifacts';
const UI_KEY = 'ui-test-key-not-valid';

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = trackConsole(page);
  await seedSessionKey(page, UI_KEY);
});

async function gotoHome(page: Page) {
  await page.goto('/');
  await expect(page.locator('app-home-hero')).toBeVisible();
}

// ---------------------------------------------------------------- Navigation

test('NAV-01 primary nav routes load', async ({ page }) => {
  await gotoHome(page);
  const nav = page.getByRole('navigation', { name: 'Primary' });

  await nav.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page).toHaveTitle(/Library/);

  await nav.getByRole('link', { name: 'Tools', exact: true }).click();
  await expect(page).toHaveURL(/\/tools$/);

  await nav.getByRole('link', { name: 'Guide', exact: true }).click();
  await expect(page).toHaveURL(/\/guide$/);

  await nav.getByRole('link', { name: 'About', exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);

  await nav.getByRole('link', { name: 'Security', exact: true }).click();
  await expect(page).toHaveURL(/\/security$/);

  await page.getByRole('link', { name: 'Open settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);

  await nav.getByRole('link', { name: 'Chat', exact: true }).click();
  await expect(page).toHaveURL(/\/$|4300\/$/);

  expect(realErrors(errors), realErrors(errors).join('\n')).toEqual([]);
});

test('NAV-04 deep-link direct load', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.locator('app-model-picker-card')).toBeVisible();
  await expect(page).toHaveTitle(/Settings/);
});

test('NAV-05 unknown route shows 404', async ({ page }) => {
  await page.goto('/does-not-exist-xyz');
  await expect(page).toHaveTitle(/Not found/);
  await page.screenshot({ path: `${SHOT}/nav-05-404.png`, fullPage: true });
});

// ---------------------------------------------------------------- Home

test('HOME-01 empty state hero + sample prompts', async ({ page }) => {
  await gotoHome(page);
  const cards = page.locator('button.sample-card');
  await expect(cards).toHaveCount(4);
  await expect(page.getByRole('link', { name: /Saved conversations/ })).toBeVisible();
  await page.screenshot({ path: `${SHOT}/home-01-empty.png`, fullPage: true });
  expect(realErrors(errors), realErrors(errors).join('\n')).toEqual([]);
});

test('HOME-02 sample prompt populates composer', async ({ page }) => {
  await gotoHome(page);
  const first = page.locator('button.sample-card').first();
  const label = (await first.locator('.sample-text').innerText()).trim();
  await first.click();
  const textarea = page.locator('textarea.composer-input');
  await expect(textarea).toHaveValue(label);
});

// ---------------------------------------------------------------- Library

test('LIB-01 empty library state', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByText('No saved conversations yet')).toBeVisible();
  await page.screenshot({ path: `${SHOT}/lib-01-empty.png`, fullPage: true });
  expect(realErrors(errors), realErrors(errors).join('\n')).toEqual([]);
});

// ---------------------------------------------------------------- Tools (custom tool builder)

test('TOOL-01 empty state + load example', async ({ page }) => {
  await page.goto('/tools');
  await expect(page.getByText('No custom tools yet')).toBeVisible();
  await page.getByRole('button', { name: /Load example/ }).click();
  // Example populates a name into the builder form.
  const name = page.locator('input[placeholder="searchWeather"]');
  await expect(name).not.toHaveValue('');
  await page.screenshot({ path: `${SHOT}/tool-01-example.png`, fullPage: true });
});

test('TOOL-02 create a custom tool', async ({ page }) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: 'New tool' }).click();
  await page.locator('input[placeholder="searchWeather"]').fill('searchWeatherQa');
  await page
    .locator('textarea[placeholder^="Get a weather"]')
    .fill('QA test tool that returns a canned forecast.');
  await page.locator('textarea').last().fill('{"forecast": "sunny"}');
  await expect(page.getByText('Valid JSON')).toBeVisible();
  await page.getByRole('button', { name: /Create tool/ }).click();
  await expect(page.locator('code.item-name', { hasText: 'searchWeatherQa' })).toBeVisible();
  await page.screenshot({ path: `${SHOT}/tool-02-created.png`, fullPage: true });
});

test('TOOL-05/06 edit then two-step delete', async ({ page }) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: 'New tool' }).click();
  await page.locator('input[placeholder="searchWeather"]').fill('editMe');
  await page.locator('textarea[placeholder^="Get a weather"]').fill('Original description.');
  await page.locator('textarea').last().fill('{"ok": true}');
  await page.getByRole('button', { name: /Create tool/ }).click();
  await expect(page.locator('code.item-name', { hasText: 'editMe' })).toBeVisible();

  // Edit
  await page.locator('button.item-main', { hasText: 'editMe' }).click();
  await page.locator('textarea[placeholder^="Get a weather"]').fill('Edited description.');
  await page.getByRole('button', { name: /Save changes/ }).click();

  // Two-step delete
  await page.locator('li.list-item', { hasText: 'editMe' }).getByRole('button', { name: 'Delete tool' }).click();
  await page.getByRole('button', { name: /Confirm delete editMe/ }).click();
  await expect(page.locator('code.item-name', { hasText: 'editMe' })).toHaveCount(0);
});

test('CMP-01 char count and send enablement', async ({ page }) => {
  await gotoHome(page);
  const textarea = page.locator('textarea.composer-input');
  const sendBtn = page.locator('button.send-btn');
  await expect(sendBtn).toBeDisabled();
  await textarea.fill('Hello world');
  await expect(page.locator('.char-count')).toHaveText(/11 characters/);
  await expect(sendBtn).toBeEnabled();
  await textarea.fill('');
  await expect(sendBtn).toBeDisabled();
});

test('TOOL-04 invalid JSON blocks save', async ({ page }) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: 'New tool' }).click();
  await page.locator('input[placeholder="searchWeather"]').fill('brokenTool');
  await page.locator('textarea').last().fill('{ not valid json ');
  await expect(page.getByText('Invalid JSON')).toBeVisible();
  const createBtn = page.getByRole('button', { name: /Create tool/ });
  await expect(createBtn).toBeDisabled();
});

// ---------------------------------------------------------------- Settings

test('SET-0x settings cards render', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.locator('app-model-picker-card')).toBeVisible();
  await expect(page.locator('app-api-key-status-card')).toBeVisible();
  await expect(page.locator('app-budget-controls-card')).toBeVisible();
  await expect(page.locator('app-tool-synthesis-card')).toBeVisible();
  await page.screenshot({ path: `${SHOT}/set-cards.png`, fullPage: true });
  expect(realErrors(errors), realErrors(errors).join('\n')).toEqual([]);
});

// ---------------------------------------------------------------- Content pages

test('INFO-01 security page + checklist wrapping', async ({ page }) => {
  await page.goto('/security');
  const items = page.locator('ul.check-list li');
  expect(await items.count()).toBeGreaterThan(3);
  await expect(page.getByText('Pure frontend. No backend.')).toBeVisible();
  await page.screenshot({ path: `${SHOT}/info-01-security.png`, fullPage: true });
});

test('INFO-02/03 guide and about render', async ({ page }) => {
  await page.goto('/guide');
  await expect(page.locator('app-page-header')).toBeVisible();
  await page.screenshot({ path: `${SHOT}/info-02-guide.png`, fullPage: true });
  await page.goto('/about');
  await expect(page.locator('app-page-header')).toBeVisible();
  await page.screenshot({ path: `${SHOT}/info-03-about.png`, fullPage: true });
});

// ---------------------------------------------------------------- Observability (REG-06 / OBS-02)

test('OBS-02 observability drawer opens without focus error', async ({ page }) => {
  await gotoHome(page);
  await page.getByRole('button', { name: 'Open observability dashboard' }).click();
  const closeBtn = page.locator('aside.drawer button.close-btn');
  await expect(closeBtn).toBeVisible();
  await expect(closeBtn).toBeFocused();
  await page.screenshot({ path: `${SHOT}/obs-02-drawer.png` });
  const focusErrs = errors.filter((e) => /focus/i.test(e));
  expect(focusErrs, focusErrs.join('\n')).toEqual([]);
  // Close with Escape.
  await page.keyboard.press('Escape');
  await expect(page.locator('aside.drawer')).not.toHaveClass(/open/);
});

// ---------------------------------------------------------------- Theme

test('SET-06 theme menu switches to dark', async ({ page }) => {
  await gotoHome(page);
  await page.getByRole('button', { name: 'Change theme' }).click();
  const items = page.getByRole('menuitem');
  expect(await items.count()).toBeGreaterThanOrEqual(2);
  await page.getByRole('menuitem', { name: /Dark/i }).click();
  await page.screenshot({ path: `${SHOT}/set-06-dark.png`, fullPage: true });
});

// ---------------------------------------------------------------- Responsive (REG-07 / RESP-01)

test('RESP-01 mobile hamburger menu icon alignment', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHome(page);
  const toggle = page.getByRole('button', { name: 'Open navigation menu' });
  await expect(toggle).toBeVisible();
  await toggle.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const items = page.getByRole('menuitem');
  expect(await items.count()).toBeGreaterThanOrEqual(5);
  await menu.screenshot({ path: `${SHOT}/resp-01-mobile-menu.png` });
});

test('RESP-03 mobile home layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHome(page);
  await expect(page.locator('button.sample-card').first()).toBeVisible();
  await page.screenshot({ path: `${SHOT}/resp-03-mobile-home.png`, fullPage: true });
});
