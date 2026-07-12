import { beforeEach, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { provideRouter } from '@angular/router';
import { apiKeyGuard } from './api-key.guard';
import { ApiKeyService } from '../services/api-key.service';

function runGuard(): boolean | UrlTree {
  return TestBed.runInInjectionContext(() =>
    apiKeyGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  ) as boolean | UrlTree;
}

describe('apiKeyGuard', () => {
  const hasKey = signal(false);

  beforeEach(() => {
    hasKey.set(false);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ApiKeyService, useValue: { hasKey } },
      ],
    });
  });

  it('allows activation when a key is present', () => {
    hasKey.set(true);
    expect(runGuard()).toBe(true);
  });

  it('redirects (UrlTree) instead of throwing when no key is present', () => {
    const result = runGuard();
    expect(result).toBeInstanceOf(UrlTree);
    expect((result as UrlTree).toString()).toContain('onboarding=required');
  });
});
