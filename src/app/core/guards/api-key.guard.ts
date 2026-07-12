import { inject } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { ApiKeyService } from '../services/api-key.service';

// Example forward-looking route guard — intentionally NOT wired into
// `app.routes.ts`. The app gates onboarding in-component today (HomeComponent
// renders <app-onboarding> until a key exists), which is the right UX for a
// single-surface SPA. This exists as a ready, tested pattern for when a future
// route needs a hard key gate.
//
// Convention (see docs/error-handling.md): guards must never throw. On a missing
// key this returns a `UrlTree` redirect rather than blocking or erroring, so a
// navigation failure can never leave the app in a broken state.
export const apiKeyGuard: CanActivateFn = (): boolean | UrlTree => {
  const apiKey = inject(ApiKeyService);
  if (apiKey.hasKey()) return true;
  return inject(Router).createUrlTree(['/'], {
    queryParams: { onboarding: 'required' },
  });
};
