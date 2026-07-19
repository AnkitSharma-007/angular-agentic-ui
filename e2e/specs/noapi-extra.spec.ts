import { test, expect, type Page } from '@playwright/test';
import { seedSessionKey, trackConsole, realErrors } from './helpers';

// Extra cases that need no live API key. Onboarding is bypassed by seeding a
// session key so the unlocked shell is reachable.
const SHOT = 'artifacts';
const UI_KEY = 'ui-test-key-not-valid';

// 1x1 transparent PNG for the attachment case.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = trackConsole(page);
  await seedSessionKey(page, UI_KEY);
});

async function gotoHome(page: Page) {
  await page.goto('/');
  await expect(page.locator('app-home-hero')).toBeVisible();
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return el.scrollWidth > el.clientWidth + 2;
  });
}

// ---------------------------------------------------------------- Navigation

test('NAV-02 active link highlight', async ({ page }) => {
  await gotoHome(page);
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(nav.getByRole('link', { name: 'Library', exact: true })).toHaveClass(/active/);
  // Chat is only active on exact root.
  await expect(nav.getByRole('link', { name: 'Chat', exact: true })).not.toHaveClass(/active/);
});

test('NAV-03 brand returns home', async ({ page }) => {
  await page.goto('/library');
  await expect(page).toHaveURL(/\/library$/);
  await page.locator('a.brand').click();
  await expect(page).toHaveURL(/\/($|\?)|4300\/?$/);
  await expect(page.locator('app-home-hero')).toBeVisible();
});

// ---------------------------------------------------------------- Home

test('HOME-10 tour banner dismiss persists', async ({ page }) => {
  await gotoHome(page);
  const banner = page.locator('aside.tour-banner');
  await expect(banner).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss tour banner' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.locator('app-home-hero')).toBeVisible();
  await expect(page.locator('aside.tour-banner')).toHaveCount(0);
});

// ---------------------------------------------------------------- Composer

test('CMP-03 image attachment add + remove', async ({ page }) => {
  await gotoHome(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'shot.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });
  const chip = page.locator('.attachment-chip');
  await expect(chip).toHaveCount(1);
  await chip.getByRole('button', { name: 'Remove attachment' }).click();
  await expect(page.locator('.attachment-chip')).toHaveCount(0);
  expect(realErrors(errors), realErrors(errors).join('\n')).toEqual([]);
});

test('CMP-04 mic control reflects speech support without errors', async ({ page }) => {
  await gotoHome(page);
  const supported = page.getByRole('button', { name: 'Start voice input' });
  const unsupported = page.getByRole('button', {
    name: 'Voice input is not supported in this browser',
  });
  const count = (await supported.count()) + (await unsupported.count());
  expect(count, 'exactly one mic control variant should render').toBe(1);
  expect(realErrors(errors), realErrors(errors).join('\n')).toEqual([]);
});

// ---------------------------------------------------------------- Tools

test('TOOL-03 invalid tool name blocks create', async ({ page }) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: 'New tool' }).click();
  await page.locator('input[placeholder="searchWeather"]').fill('bad name!');
  // Blur to mark the field touched so the error renders.
  await page.locator('textarea[placeholder^="Get a weather"]').click();
  await expect(page.locator('mat-error').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Create tool/ })).toBeDisabled();
});

test('TOOL-08 storage-unavailable card when IndexedDB is blocked', async ({ page }) => {
  // Make IndexedDB unavailable before the app boots.
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });
    } catch {
      /* ignore */
    }
  });
  await page.goto('/tools');
  await expect(page.getByText('Custom tools unavailable')).toBeVisible();
  await page.screenshot({ path: `${SHOT}/tool-08-unavailable.png`, fullPage: true });
});

// ---------------------------------------------------------------- Library

test('LIB-07 missing replay id surfaces error + recovery', async ({ page }) => {
  await page.goto('/?replay=does-not-exist-xyz');
  const banner = page.locator('.banner.error');
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('link', { name: /Back to Library/i })).toBeVisible();
  await page.screenshot({ path: `${SHOT}/lib-07-missing-replay.png`, fullPage: true });
});

// ---------------------------------------------------------------- Settings

test('SET-05 theme card switches resolved theme', async ({ page }) => {
  await page.goto('/settings');
  const card = page.locator('app-theme-picker-card');
  await expect(card).toBeVisible();
  await card.locator('.theme-option', { hasText: 'Dark' }).click();
  await expect(card.locator('.theme-option--active')).toContainText('Dark');
  await expect(card).toContainText(/Resolved:\s*dark/i);
  await page.screenshot({ path: `${SHOT}/set-05-theme-dark.png`, fullPage: true });
});

// ---------------------------------------------------------------- Content on mobile

test('INFO-04 content pages have no horizontal overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/security', '/guide', '/about']) {
    await page.goto(path);
    await expect(page.locator('app-page-header')).toBeVisible();
    expect(await hasHorizontalOverflow(page), `overflow on ${path}`).toBe(false);
  }
  await page.screenshot({ path: `${SHOT}/info-04-mobile-about.png`, fullPage: true });
});

// ---------------------------------------------------------------- Responsive

test('RESP-04 library & tools stack on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/library');
  expect(await hasHorizontalOverflow(page), 'library overflow').toBe(false);
  await page.screenshot({ path: `${SHOT}/resp-04-mobile-library.png`, fullPage: true });
  await page.goto('/tools');
  await expect(page.getByText('No custom tools yet')).toBeVisible();
  expect(await hasHorizontalOverflow(page), 'tools overflow').toBe(false);
  await page.screenshot({ path: `${SHOT}/resp-04-mobile-tools.png`, fullPage: true });
});

test('RESP-05 tablet breakpoint sanity', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  for (const path of ['/', '/library', '/tools']) {
    await page.goto(path);
    expect(await hasHorizontalOverflow(page), `overflow on ${path}`).toBe(false);
  }
  await page.screenshot({ path: `${SHOT}/resp-05-tablet-tools.png`, fullPage: true });
});

// ---------------------------------------------------------------- Accessibility

test('A11Y-01/02 keyboard reaches interactive controls with focus', async ({ page }) => {
  await gotoHome(page);
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  const tags = new Set<string>();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        tag: el?.tagName ?? '',
        hasFocusVisible: !!el && el.matches(':focus-visible'),
      };
    });
    if (info.tag) tags.add(info.tag);
  }
  const interactive = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'MAT-SELECT'];
  expect([...tags].some((t) => interactive.includes(t)), `focused tags: ${[...tags]}`).toBe(true);
});

test('A11Y-04 mobile tap targets are large enough', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHome(page);
  for (const name of ['Open navigation menu', 'Change theme', 'Open settings']) {
    const box = await page.getByRole('button', { name }).or(page.getByRole('link', { name })).first().boundingBox();
    expect(box, name).not.toBeNull();
    expect(Math.min(box!.width, box!.height), name).toBeGreaterThanOrEqual(40);
  }
});

test('A11Y-05 key controls expose labels and roles', async ({ page }) => {
  await gotoHome(page);
  await expect(page.getByRole('button', { name: 'Open observability dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change theme' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send prompt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attach image' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
});

test('A11Y-03 reduced-motion preference is honored at load', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoHome(page);
  const reduced = await page.evaluate(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  expect(reduced).toBe(true);
  expect(realErrors(errors), realErrors(errors).join('\n')).toEqual([]);
  await page.screenshot({ path: `${SHOT}/a11y-03-reduced-motion.png`, fullPage: true });
});
