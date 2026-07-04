import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolSynthesisSettings } from './tool-synthesis.settings';

const STORAGE_KEY = 'atlas:tool-synthesis';

describe('ToolSynthesisSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  afterEach(() => localStorage.clear());

  it('defaults to enabled when nothing is persisted', () => {
    const settings = TestBed.inject(ToolSynthesisSettings);
    expect(settings.enabled()).toBe(true);
  });

  it('persists an explicit disable across a fresh instance', () => {
    const settings = TestBed.inject(ToolSynthesisSettings);
    settings.setEnabled(false);
    expect(settings.enabled()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');

    // A new injector should read the persisted value, not the ON default.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const reloaded = TestBed.inject(ToolSynthesisSettings);
    expect(reloaded.enabled()).toBe(false);
  });

  it('toggles between states', () => {
    const settings = TestBed.inject(ToolSynthesisSettings);
    expect(settings.enabled()).toBe(true);
    settings.toggle();
    expect(settings.enabled()).toBe(false);
    settings.toggle();
    expect(settings.enabled()).toBe(true);
  });
});
