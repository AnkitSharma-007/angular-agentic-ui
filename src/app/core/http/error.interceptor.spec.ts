import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { errorInterceptor } from './error.interceptor';
import { AppError } from '../errors/app-error';

describe('errorInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  it('normalizes an HTTP failure into a typed AppError before it reaches the caller', async () => {
    const caught = new Promise<unknown>((resolve) => {
      http.get('/api/thing').subscribe({
        next: () => resolve(new Error('expected an error')),
        error: (err) => resolve(err),
      });
    });

    controller.expectOne('/api/thing').flush('nope', {
      status: 500,
      statusText: 'Internal Server Error',
    });

    const err = await caught;
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).category).toBe('api');
    expect((err as AppError).context).toMatchObject({
      source: 'http',
      method: 'GET',
      url: '/api/thing',
    });
  });

  it('classifies a connection failure (status 0) as a retryable network error', async () => {
    const caught = new Promise<unknown>((resolve) => {
      http.get('/api/offline').subscribe({
        next: () => resolve(new Error('expected an error')),
        error: (err) => resolve(err),
      });
    });

    controller
      .expectOne('/api/offline')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    const err = await caught;
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).category).toBe('network');
    expect((err as AppError).retryable).toBe(true);
  });

  afterEach(() => {
    controller.verify();
  });
});
