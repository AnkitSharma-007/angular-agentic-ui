import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ProposeToolCardComponent } from './propose-tool-card';
import { InterruptService } from '../../../core/registry/interrupt.service';
import { CustomToolsService } from '../../../core/custom-tools/custom-tools.service';
import { ToolRegistry } from '../../../core/registry/tool-registry';
import type { ProposeToolArgs } from './propose-tool.types';

const DRAFT: ProposeToolArgs = {
  name: 'searchWeather',
  description: 'Get a weather forecast for a city.',
  parameters: [{ name: 'city', type: 'string', description: 'City name.', required: true }],
  responseTemplate: '{"city": {{city}}, "tempC": 27}',
};

function createCard(args: ProposeToolArgs, status = 'pending_approval') {
  const fixture = TestBed.createComponent(ProposeToolCardComponent);
  fixture.componentRef.setInput('callId', 'c1');
  fixture.componentRef.setInput('args', args);
  fixture.componentRef.setInput('status', status);
  return fixture;
}

describe('ProposeToolCardComponent', () => {
  let interrupts: InterruptService;
  let customTools: CustomToolsService;
  let registry: ToolRegistry;

  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideAnimationsAsync()],
    });
    interrupts = TestBed.inject(InterruptService);
    customTools = TestBed.inject(CustomToolsService);
    registry = TestBed.inject(ToolRegistry);
  });

  it('renders the pending review with the proposed name and actions', async () => {
    const fixture = createCard(DRAFT);
    await fixture.whenStable();
    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('New tool proposed');
    expect(text).toContain('searchWeather');
    expect(text).toContain('Approve & register');
    expect(text).toContain('awaiting approval');
  });

  it('approve() registers a callable tool and resolves the interrupt via select', async () => {
    const decide = vi.spyOn(interrupts, 'decide');
    void interrupts.pendingDecision('c1', new AbortController().signal);

    const fixture = createCard(DRAFT);
    await fixture.whenStable();

    await (fixture.componentInstance as unknown as { approve: () => Promise<void> }).approve();

    expect(registry.get('searchWeather')).toBeDefined();
    expect(customTools.count()).toBe(1);
    expect(decide).toHaveBeenCalledWith('c1', {
      kind: 'select',
      selection: { registered: true, name: 'searchWeather', description: DRAFT.description },
    });
  });

  it('blocks approval on a name collision with an existing tool', async () => {
    await customTools.save({
      id: 'existing',
      name: 'searchWeather',
      description: 'pre-existing',
      parameters: [],
      responseTemplate: '{}',
      createdAt: 1,
      updatedAt: 1,
    });
    const decide = vi.spyOn(interrupts, 'decide');

    const fixture = createCard(DRAFT);
    await fixture.whenStable();

    const inst = fixture.componentInstance as unknown as {
      canApprove: () => boolean;
      nameError: () => string | null;
      approve: () => Promise<void>;
    };
    expect(inst.canApprove()).toBe(false);
    expect(inst.nameError()).toMatch(/already exists/i);

    await inst.approve();
    expect(decide).not.toHaveBeenCalled();
  });

  it('blocks approval when the response template is not valid JSON', async () => {
    const fixture = createCard({ ...DRAFT, responseTemplate: '{"broken": }' });
    await fixture.whenStable();
    const inst = fixture.componentInstance as unknown as { canApprove: () => boolean };
    expect(inst.canApprove()).toBe(false);
  });

  it('confirmReject() forwards a trimmed note', async () => {
    const decide = vi.spyOn(interrupts, 'decide');
    void interrupts.pendingDecision('c1', new AbortController().signal);

    const fixture = createCard(DRAFT);
    await fixture.whenStable();

    const inst = fixture.componentInstance as unknown as {
      rejectionNote: { set: (v: string) => void };
      confirmReject: () => void;
    };
    inst.rejectionNote.set('  prefer a different shape  ');
    inst.confirmReject();
    expect(decide).toHaveBeenCalledWith('c1', {
      kind: 'reject',
      note: 'prefer a different shape',
    });
  });

  it('renders the registered (complete) state from the selection result', async () => {
    const fixture = createCard(DRAFT, 'complete');
    fixture.componentRef.setInput('result', {
      selected: { registered: true, name: 'searchWeather', description: DRAFT.description },
    });
    await fixture.whenStable();
    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('registered');
    expect(text).toContain('searchWeather');
  });
});
