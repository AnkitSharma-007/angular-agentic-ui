import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OnboardingComponent } from './onboarding';

describe('OnboardingComponent', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideAnimationsAsync()],
    });
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('renders the setup flow when there is no locked key blob', async () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('app-onboarding-setup-flow')).not.toBeNull();
    expect(el.querySelector('app-onboarding-unlock-flow')).toBeNull();
  });
});
