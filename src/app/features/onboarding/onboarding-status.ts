export type OnboardingStatus =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'tested-ok' }
  | { kind: 'saving' }
  | { kind: 'unlocking' }
  | { kind: 'error'; message: string };
