import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withNavigationErrorHandler,
  withViewTransitions,
  type NavigationError,
} from '@angular/router';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';

import { routes } from './app.routes';
import { provideTools } from './core/registry/register-tools';
import { ApiKeyService } from './core/services/api-key.service';
import { GlobalErrorHandler } from './core/errors/global-error-handler';
import { ErrorService } from './core/errors/error.service';
import { LOG_SINKS, ConsoleLogSink, RingBufferLogSink } from './core/logging/log-sink';

export const appConfig: ApplicationConfig = {
  providers: [
    // Route window `error` / `unhandledrejection` events through our ErrorHandler.
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions(),
      // Lazy-route chunk loads can fail on a stale deploy or a network blip.
      // ErrorService classifies these as chunk-load errors and routes them to
      // the shell boundary with a reload prompt.
      withNavigationErrorHandler((event: NavigationError) => {
        inject(ErrorService).handle(event.error, {
          context: { source: 'navigation', url: event.url },
        });
      }),
    ),
    provideTools(),
    // Await session-key rehydration before first render so the app already knows
    // whether a key is present (the KEK/envelope decrypt is async).
    provideAppInitializer(() => inject(ApiKeyService).restore()),
    // Global error backstop + logging destinations.
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    { provide: LOG_SINKS, useClass: ConsoleLogSink, multi: true },
    { provide: LOG_SINKS, useExisting: RingBufferLogSink, multi: true },
    {
      provide: MAT_ICON_DEFAULT_OPTIONS,
      useValue: { fontSet: 'material-symbols-outlined' },
    },
  ],
};
