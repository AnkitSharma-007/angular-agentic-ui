import { Service, computed, effect, signal } from '@angular/core';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'agentic-ui.theme-preference';

@Service()
export class ThemeService {
  private readonly _preference = signal<ThemePreference>(this.readInitial());
  private readonly _systemPrefersDark = signal<boolean>(this.readSystemPrefersDark());

  readonly preference = this._preference.asReadonly();

  readonly resolvedTheme = computed<'light' | 'dark'>(() => {
    const pref = this._preference();
    if (pref === 'light' || pref === 'dark') return pref;
    return this._systemPrefersDark() ? 'dark' : 'light';
  });

  constructor() {
    // Track the *resolved* theme so an OS scheme change under "system" also re-applies.
    effect(() => {
      this.applyToDocument(this.resolvedTheme());
    });

    if (typeof window !== 'undefined' && window.matchMedia) {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', (event) => {
        // The effect above reacts to this via resolvedTheme() — no manual re-apply needed.
        this._systemPrefersDark.set(event.matches);
      });
    }
  }

  set(preference: ThemePreference): void {
    this._preference.set(preference);
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      /* localStorage unavailable */
    }
  }

  cycle(): void {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(this._preference()) + 1) % order.length];
    this.set(next);
  }

  private readInitial(): ThemePreference {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
    } catch {
      /* localStorage unavailable */
    }
    return 'system';
  }

  private readSystemPrefersDark(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // Always resolve to a concrete light/dark class — even under "system" — so
  // theme-scoped tokens (e.g. --app-shadow-color) retune instead of stranding the
  // :root default when the OS is light.
  private applyToDocument(theme: 'light' | 'dark'): void {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    html.classList.toggle('theme-light', theme === 'light');
    html.classList.toggle('theme-dark', theme === 'dark');
    this.applyThemeColor(theme);
  }

  // Keep the mobile browser chrome bar (<meta name="theme-color">) in sync with the
  // resolved theme; a hardcoded dark value otherwise strands a dark chrome bar over a
  // light UI. Reads the actual resolved surface colour so it always matches the theme.
  private applyThemeColor(theme: 'light' | 'dark'): void {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!(meta instanceof HTMLMetaElement)) return;
    const surface = document.body ? getComputedStyle(document.body).backgroundColor : '';
    const fallback = theme === 'dark' ? '#0b0d12' : '#f7f5fb';
    meta.content = surface && surface !== 'rgba(0, 0, 0, 0)' ? surface : fallback;
  }
}
