import { describe, expect, it } from 'vitest';
import {
  ApiError,
  AppError,
  AuthError,
  BusinessError,
  ClientError,
  GENERIC_USER_MESSAGE,
  NetworkError,
  StorageError,
  ValidationError,
  isAppError,
} from './app-error';

describe('AppError', () => {
  it('is an Error subclass with category-driven defaults', () => {
    const err = new AppError({ category: 'network' });
    expect(err).toBeInstanceOf(Error);
    expect(isAppError(err)).toBe(true);
    expect(err.category).toBe('network');
    expect(err.severity).toBe('error');
    expect(err.recoverable).toBe(true);
    expect(err.retryable).toBe(true);
    expect(err.userMessage).toBe(GENERIC_USER_MESSAGE);
  });

  it('defaults to the unknown category when none is given', () => {
    const err = new AppError();
    expect(err.category).toBe('unknown');
    expect(err.recoverable).toBe(false);
    expect(err.retryable).toBe(false);
  });

  it('uses technicalMessage as the Error message and falls back to userMessage', () => {
    expect(new AppError({ technicalMessage: 'tech' }).message).toBe('tech');
    expect(new AppError({ userMessage: 'friendly' }).message).toBe('friendly');
  });

  it('lets explicit options override the category defaults', () => {
    const err = new AppError({ category: 'network', retryable: false, severity: 'warn' });
    expect(err.retryable).toBe(false);
    expect(err.severity).toBe('warn');
  });

  it('preserves the cause', () => {
    const cause = new Error('root');
    expect(new AppError({ cause }).cause).toBe(cause);
  });

  it('marks abort errors as silent', () => {
    expect(new AppError({ category: 'abort' }).isSilent).toBe(true);
    expect(new AppError({ category: 'network' }).isSilent).toBe(false);
  });

  it('enrich() fills correlationId/context without clobbering existing values', () => {
    const err = new AppError({ correlationId: 'first', context: { a: 1 } });
    err.enrich({ correlationId: 'second', context: { b: 2 } });
    expect(err.correlationId).toBe('first');
    expect(err.context).toEqual({ a: 1, b: 2 });
  });

  it('markHandled() flips the handled flag', () => {
    const err = new AppError();
    expect(err.handled).toBe(false);
    expect(err.markHandled().handled).toBe(true);
  });
});

describe('AppError subclasses', () => {
  const cases: ReadonlyArray<readonly [string, AppError, string]> = [
    ['NetworkError', new NetworkError(), 'network'],
    ['ApiError', new ApiError(), 'api'],
    ['ValidationError', new ValidationError(), 'validation'],
    ['AuthError', new AuthError(), 'auth'],
    ['BusinessError', new BusinessError(), 'business'],
    ['ClientError', new ClientError(), 'client'],
    ['StorageError', new StorageError(), 'storage'],
  ];

  for (const [name, err, category] of cases) {
    it(`${name} sets a stable name and fixed category`, () => {
      expect(err).toBeInstanceOf(AppError);
      expect(err.name).toBe(name);
      expect(err.category).toBe(category);
    });
  }
});
