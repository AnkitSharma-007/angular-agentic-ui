import type { Page } from '@playwright/test';

// The app rehydrates a session key from the legacy plaintext slot in
// sessionStorage during APP_INITIALIZER (ApiKeyService.restore). Seeding it
// before load unlocks the shell for UI-only cases without a valid key.
const LEGACY_SESSION_KEY = 'agentic-ui.api-key.session';

export async function seedSessionKey(page: Page, key: string): Promise<void> {
  await page.addInitScript(
    ([slot, k]) => {
      try {
        sessionStorage.setItem(slot as string, k as string);
      } catch {
        /* storage unavailable */
      }
    },
    [LEGACY_SESSION_KEY, key] as const,
  );
}

export function trackConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  return errors;
}

// Console noise that is unrelated to app correctness (dev server, fonts, favicon).
const BENIGN = [
  /favicon/i,
  /Failed to load resource.*fonts/i,
  /\[vite\]/i,
  /net::ERR_.*fonts\.g/i,
];

export function realErrors(errors: string[]): string[] {
  return errors.filter((e) => !BENIGN.some((re) => re.test(e)));
}
