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
    effect(() => {
      this.applyToDocument(this._preference());
    });

    if (typeof window !== 'undefined' && window.matchMedia) {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', (event) => {
        this._systemPrefersDark.set(event.matches);
        if (this._preference() === 'system') {
          this.applyToDocument('system');
        }
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

  private applyToDocument(preference: ThemePreference): void {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    html.classList.remove('theme-light', 'theme-dark');
    if (preference === 'light') html.classList.add('theme-light');
    if (preference === 'dark') html.classList.add('theme-dark');
  }
}
