import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { ApiKeyService } from '../../core/services/api-key.service';
import { GeminiService } from '../../core/services/gemini.service';
import { ErrorService } from '../../core/errors/error.service';
import { LoggerService } from '../../core/logging/logger.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { ConnectivityService } from '../../core/connectivity/connectivity.service';
import { AgentEventStore, type ToolCallState } from '../../core/streaming/agent-event.store';
import { ToolRegistry } from '../../core/registry/tool-registry';
import { ReplayService } from '../../core/replay/replay.service';
import { CustomToolsService } from '../../core/custom-tools/custom-tools.service';
import type { CustomToolSpec } from '../../core/custom-tools/custom-tool.types';
import { TokenAccountantService } from '../../core/observability/token-accountant.service';
import { AgentRegistry } from '../../core/agents/agent-registry.service';
import { play, type ReplaySpeed } from '../../core/replay/replay-player';
import type { AgentEvent } from '../../core/streaming/agent-event';
import type { HistoryContent } from '../../core/streaming/raw-history.reducer';
import { toDataUrl, type InlineAttachment } from '../../core/media/attachment.types';
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  downscaleImageToAttachment,
  isImageFile,
} from '../../core/media/image-downscale';
import {
  describeSpeechError,
  isSpeechRecognitionSupported,
  startSpeechRecognition,
  type SpeechController,
} from '../../core/media/speech';
import {
  estimateReplayBytes,
  replaySizeError,
  replaySizeWarning,
} from '../../core/replay/replay-size';
import { isValidReplayPayload } from '../../core/replay/replay.types';
import { OnboardingComponent } from '../onboarding/onboarding';
import { ThoughtComponent } from '../../shared/thought/thought';
import { MarkdownComponent } from '../../shared/markdown/markdown';
import { AgentGraphComponent } from '../../shared/agent-graph/agent-graph';
import { ToolErrorFallbackComponent } from '../../shared/error-boundary/tool-error-fallback';

const REPLAY_SPEEDS: readonly ReplaySpeed[] = [0.5, 1, 2, 4];

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SamplePrompt {
  readonly icon: string;
  readonly label: string;
  readonly text: string;
}

@Component({
  selector: 'app-home',
  imports: [
    FormsModule,
    RouterLink,
    NgComponentOutlet,
    OnboardingComponent,
    ThoughtComponent,
    MarkdownComponent,
    AgentGraphComponent,
    ToolErrorFallbackComponent,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomeComponent implements OnInit {
  protected readonly apiKey = inject(ApiKeyService);
  protected readonly gemini = inject(GeminiService);
  protected readonly store = inject(AgentEventStore);
  protected readonly registry = inject(ToolRegistry);
  protected readonly replays = inject(ReplayService);
  private readonly customTools = inject(CustomToolsService);
  private readonly errors = inject(ErrorService);
  private readonly logger = inject(LoggerService);
  private readonly notifications = inject(NotificationService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly tokenAccountant = inject(TokenAccountantService);
  private readonly agents = inject(AgentRegistry);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  private readonly promptArea = viewChild<ElementRef<HTMLTextAreaElement>>('promptArea');
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly prompt = signal('');
  protected readonly lastPrompt = signal('');
  protected readonly showTourBanner = signal(false);
  protected readonly attachments = signal<readonly InlineAttachment[]>([]);
  protected readonly attachmentError = signal<string | null>(null);
  protected readonly isDraggingOver = signal(false);
  protected readonly maxAttachments = MAX_ATTACHMENTS;

  protected readonly micSupported = isSpeechRecognitionSupported();
  protected readonly isRecording = signal(false);
  protected readonly micError = signal<string | null>(null);
  private speechController: SpeechController | null = null;
  private micBaseText = '';

  protected readonly composerNotice = computed(() => this.attachmentError() ?? this.micError());
  protected readonly phase = this.store.phase;
  protected readonly responseText = this.store.responseText;
  protected readonly toolCalls = this.store.toolCalls;
  protected readonly displayedToolCalls = computed(() =>
    collapseSingletonCards(this.toolCalls(), (name) => this.registry.get(name)?.singleton ?? false),
  );
  protected readonly errorMessage = this.store.error;
  protected readonly stats = this.store.stats;
  protected readonly hasOutput = this.store.hasOutput;
  protected readonly isStreaming = this.store.isStreaming;
  protected readonly isReplaying = this.store.isReplaying;
  protected readonly budgetBreachKind = computed(() => {
    const turn = this.store.currentTurn();
    if (!turn.finishReason?.startsWith('BUDGET_EXCEEDED:')) return null;
    return turn.finishReason.slice('BUDGET_EXCEEDED:'.length);
  });

  protected readonly saveStatus = signal<SaveStatus>('idle');
  protected readonly saveWarning = signal<string | null>(null);
  protected readonly replaySpeed = signal<ReplaySpeed>(1);
  protected readonly speedOptions = REPLAY_SPEEDS;
  protected readonly activeReplayId = signal<string | null>(null);
  // Replay load failure banner with Back-to-Library recovery — separate from streaming errors.
  protected readonly replayLoadError = signal<string | null>(null);
  // Tool modules being retried (spinner + dedupe concurrent clicks).
  protected readonly retryingTools = signal<ReadonlySet<string>>(new Set());
  protected readonly canSave = computed(() => {
    return (
      this.phase() === 'complete' &&
      this.hasOutput() &&
      this.lastPrompt().length > 0 &&
      this.activeReplayId() === null
    );
  });

  protected readonly sendShortcutModifier = isMacPlatform() ? '⌘' : 'Ctrl';

  protected readonly samplePrompts: readonly SamplePrompt[] = [
    {
      icon: 'travel',
      label: 'Plan a weekend',
      text: 'Plan a weekend in Goa for 2 vegetarian travellers leaving Bengaluru on 2026-06-13 and returning 2026-06-15. Suggest flights, a hotel, recommend a few must-do activities, and render the itinerary on a map.',
    },
    {
      icon: 'explore',
      label: 'Activities only',
      text: 'I am already in Goa. Suggest 5 activities for foodies and culture lovers over a 2-day stay.',
    },
    {
      icon: 'compare_arrows',
      label: 'Let me choose',
      text: 'Find flights from Bengaluru to Goa on 2026-06-13 for 1 passenger. Show me the options and let me pick one, then book it for Ankit Sharma and show the trip on a map.',
    },
    {
      icon: 'route',
      label: 'Road trip',
      text: 'Plot a long-weekend road trip from Bengaluru to Coorg via Mysuru and back. Render the route on a map with stops for lunch and a coffee-estate stay.',
    },
  ];

  protected readonly canSend = computed(() => {
    const hasContent = this.prompt().trim().length > 0 || this.attachments().length > 0;
    return this.apiKey.hasKey() && hasContent && !this.isStreaming();
  });

  protected readonly userTurn = this.store.currentUserTurn;
  protected readonly showUserTurn = computed(() => {
    if (this.phase() === 'idle') return false;
    const turn = this.userTurn();
    return turn.text.length > 0 || turn.attachments.length > 0;
  });

  private readonly cancel$ = new Subject<void>();

  ngOnInit(): void {
    this.showTourBanner.set(!hasTourBeenDismissed());
    this.destroyRef.onDestroy(() => this.speechController?.abort());

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const replayId = params.get('replay');
      if (replayId) {
        void this.loadAndReplay(replayId);
        return;
      }
      const prefill = params.get('prompt');
      if (prefill && prefill.trim().length > 0) {
        this.applyPromptPrefill(prefill);
      }
    });
  }

  protected dismissTourBanner(): void {
    this.showTourBanner.set(false);
    markTourDismissed();
  }

  private applyPromptPrefill(text: string): void {
    this.prompt.set(text);
    void this.router.navigate([], {
      queryParams: { prompt: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.focusPromptArea();
  }

  protected onOnboardingReady(): void {
    this.focusPromptArea();
  }

  protected useSamplePrompt(prompt: string): void {
    this.prompt.set(prompt);
    this.focusPromptArea();
  }

  // afterNextRender waits for the textarea DOM; queueMicrotask fires before zoneless CD flushes.
  private focusPromptArea(): void {
    afterNextRender(() => this.promptArea()?.nativeElement.focus(), { injector: this.injector });
  }

  protected cancel(): void {
    this.cancel$.next();
    this.store.markCancelled();
  }

  protected reset(): void {
    this.cancel$.next();
    if (this.isRecording()) this.stopRecording();
    this.inputsCache.clear();
    this.store.reset();
    this.agents.resetForNewTurn();
    this.tokenAccountant.clearLifetime();
    this.tokenAccountant.resetTurn();
    this.saveStatus.set('idle');
    this.saveWarning.set(null);
    this.lastPrompt.set('');
    this.attachments.set([]);
    this.attachmentError.set(null);
    this.micError.set(null);
    this.activeReplayId.set(null);
    this.replayLoadError.set(null);
    this.clearReplayQueryParam();
  }

  protected componentFor(call: ToolCallState) {
    // Touch loadedNames so the template re-renders when lazy descriptors finish loading.
    void this.registry.loadedNames();
    return this.registry.componentFor(call.name);
  }

  // Retry failed lazy module; loadImpl clears/re-flags failedNames; concurrent clicks deduped.
  protected retryToolLoad(name: string): void {
    if (this.retryingTools().has(name)) return;
    this.retryingTools.update((s) => new Set(s).add(name));
    void this.registry
      .loadImpl(name)
      .catch((err) => {
        // Retry button reappears via failedNames; log is diagnostic only, not silent recovery.
        this.logger.debug('Tool module retry failed.', {
          category: 'chunk_load',
          context: { feature: 'home', op: 'retryToolLoad', tool: name },
          error: err,
        });
      })
      .finally(() => {
        this.retryingTools.update((s) => {
          const next = new Set(s);
          next.delete(name);
          return next;
        });
      });
  }

  // NgComponentOutlet re-applies inputs on new references; cache per callId and reuse while fields unchanged.
  private readonly inputsCache = new Map<
    string,
    {
      readonly args: unknown;
      readonly result: unknown;
      readonly status: ToolCallState['status'];
      readonly errorMessage: string | null;
      readonly interruptReason: string | null;
      readonly value: Record<string, unknown>;
    }
  >();

  protected inputsFor(call: ToolCallState): Record<string, unknown> {
    const interruptReason = call.interruptReason ?? null;
    const cached = this.inputsCache.get(call.callId);
    if (
      cached &&
      cached.args === call.args &&
      cached.result === call.result &&
      cached.status === call.status &&
      cached.errorMessage === call.errorMessage &&
      cached.interruptReason === interruptReason
    ) {
      return cached.value;
    }
    const value: Record<string, unknown> = {
      callId: call.callId,
      args: call.args,
      result: call.result,
      status: call.status,
      errorMessage: call.errorMessage,
      interruptReason,
    };
    this.inputsCache.set(call.callId, {
      args: call.args,
      result: call.result,
      status: call.status,
      errorMessage: call.errorMessage,
      interruptReason,
      value,
    });
    return value;
  }

  protected send(): void {
    if (!this.canSend()) return;
    // Fail fast when offline — navigator.onLine is coarse; real failures use the streaming error path.
    if (this.connectivity.offline()) {
      this.notifications.warn("You're offline. Reconnect to the internet and try again.", {
        dedupeKey: 'offline-send',
      });
      return;
    }
    if (this.isRecording()) this.stopRecording();
    this.cancel$.next();
    const text = this.prompt().trim();
    const attachments = this.attachments();
    const turnId = newTurnId();

    this.lastPrompt.set(text);
    this.saveStatus.set('idle');
    this.replayLoadError.set(null);
    if (this.activeReplayId() !== null) {
      this.activeReplayId.set(null);
      this.clearReplayQueryParam();
    }

    this.gemini
      .streamAgentTurn({ text, attachments }, turnId)
      .pipe(takeUntil(this.cancel$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => this.store.pushEvent(event),
        error: (err) => this.onTurnError(err, turnId),
      });

    // Attachments are one-shot — clear them once handed to the turn.
    this.attachments.set([]);
    this.attachmentError.set(null);
    this.micError.set(null);
    this.saveWarning.set(null);
  }

  // Route failures through ErrorService; banner records failure, retryable cases also get a Retry toast.
  private onTurnError(err: unknown, turnId: string): void {
    const appError = this.errors.handle(err, {
      surface: 'none',
      correlationId: turnId,
      context: { feature: 'home', op: 'streamAgentTurn' },
    });
    if (appError.isSilent) return;

    this.store.markError(appError.userMessage);

    if (appError.retryable) {
      this.notifications.error(appError.userMessage, {
        action: { label: 'Retry', handler: () => this.retryLast() },
        dedupeKey: `turn-error:${appError.category}:${appError.code ?? ''}`,
      });
    }
  }

  // Re-runs last prompt via send(); attachments were already cleared on the first send.
  protected retryLast(): void {
    if (this.isStreaming()) return;
    const text = this.lastPrompt();
    if (!text) return;
    this.prompt.set(text);
    this.send();
  }

  protected toggleMic(): void {
    if (this.isStreaming()) return;
    if (this.isRecording()) {
      this.stopRecording();
      return;
    }
    this.micError.set(null);
    this.micBaseText = this.prompt();
    const controller = startSpeechRecognition({
      onTranscript: (transcript) => {
        const base = this.micBaseText.trim();
        this.prompt.set(base ? `${base} ${transcript}` : transcript);
      },
      onError: (error) => {
        this.micError.set(describeSpeechError(error));
        this.isRecording.set(false);
        this.speechController = null;
      },
      onEnd: () => {
        this.isRecording.set(false);
        this.speechController = null;
      },
    });
    if (!controller) {
      this.micError.set('Voice input is not supported in this browser.');
      return;
    }
    this.speechController = controller;
    this.isRecording.set(true);
  }

  private stopRecording(): void {
    this.speechController?.stop();
    this.speechController = null;
    this.isRecording.set(false);
  }

  protected openFilePicker(): void {
    this.fileInput()?.nativeElement.click();
  }

  protected onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      void this.addFiles(Array.from(input.files));
    }
    input.value = '';
  }

  protected onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.some(isImageFile)) {
      event.preventDefault();
      void this.addFiles(files);
    }
  }

  protected onDragOver(event: DragEvent): void {
    if (this.isStreaming()) return;
    event.preventDefault();
    this.isDraggingOver.set(true);
  }

  protected onDragLeave(): void {
    this.isDraggingOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingOver.set(false);
    if (this.isStreaming()) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) void this.addFiles(files);
  }

  protected removeAttachment(id: string): void {
    this.attachments.update((list) => list.filter((a) => a.id !== id));
  }

  protected attachmentPreview(attachment: InlineAttachment): string {
    return toDataUrl(attachment);
  }

  private async addFiles(files: readonly File[]): Promise<void> {
    this.attachmentError.set(null);
    const images = files.filter(isImageFile);
    if (images.length < files.length) {
      this.attachmentError.set('Only image attachments are supported for now.');
    }
    for (const file of images) {
      if (this.attachments().length >= MAX_ATTACHMENTS) {
        this.attachmentError.set(`Up to ${MAX_ATTACHMENTS} images per message.`);
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        this.attachmentError.set('Each image must be under 4 MB.');
        continue;
      }
      try {
        const attachment = await downscaleImageToAttachment(file);
        this.attachments.update((list) => [...list, attachment]);
      } catch {
        this.attachmentError.set('Could not process that image.');
      }
    }
  }

  protected setSpeed(speed: ReplaySpeed): void {
    this.replaySpeed.set(speed);
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) return;
    this.saveStatus.set('saving');
    this.saveWarning.set(null);
    try {
      // Saved run = one prompt + response; snapshot only the latest turn from the store.
      const turnId = this.store.currentTurn().id;
      const allEvents = this.store.events();
      const events = turnId ? allEvents.filter((e) => e.turnId === turnId) : allEvents;

      const allHistory = this.store.rawHistory();
      const rawHistory = sliceCurrentTurnHistory(allHistory);

      // Refuse hard-cap oversize runs rather than hit opaque IndexedDB quota failures.
      const sizeError = replaySizeError(rawHistory);
      if (sizeError) {
        this.saveWarning.set(sizeError);
        this.saveStatus.set('error');
        return;
      }

      // Warn (don't block) on heavy self-contained replays so users expect slow loads.
      this.saveWarning.set(replaySizeWarning(rawHistory));

      const firstTs = events.at(0)?.ts ?? Date.now();
      const lastTs = events.at(-1)?.ts ?? firstTs;

      // Embed custom-tool specs so replay cards render after deletion or on another device.
      const customToolSpecs = this.collectCustomToolSpecs(events);

      await this.replays.save({
        schemaVersion: 1,
        id: newReplayId(),
        title: deriveTitle(this.lastPrompt()),
        savedAt: new Date().toISOString(),
        prompt: this.lastPrompt(),
        model: this.gemini.selectedModel(),
        events,
        rawHistory,
        ...(customToolSpecs.length > 0 ? { customToolSpecs } : {}),
        durationMs: Math.max(0, lastTs - firstTs),
        eventCount: events.length,
        sizeBytes: estimateReplayBytes(rawHistory),
        stats: this.stats(),
      });
      this.saveStatus.set('saved');
    } catch (err) {
      // Classify + log save failures; button stays in retry state while surfacing concrete reason.
      const appError = this.errors.handle(err, {
        surface: 'none',
        context: { feature: 'home', op: 'save' },
      });
      this.saveWarning.set(appError.userMessage);
      this.saveStatus.set('error');
    }
  }

  // Map tool_call events to owned custom-tool specs; skip built-ins.
  private collectCustomToolSpecs(events: readonly AgentEvent[]): readonly CustomToolSpec[] {
    const owned = this.customTools.customToolNames();
    const wanted = new Set<string>();
    for (const event of events) {
      if (event.type === 'tool_call' && owned.has(event.name)) wanted.add(event.name);
    }
    if (wanted.size === 0) return [];
    return this.customTools.specs().filter((s) => wanted.has(s.name));
  }

  protected async restart(): Promise<void> {
    const id = this.activeReplayId();
    if (!id) return;
    await this.loadAndReplay(id);
  }

  private async loadAndReplay(id: string): Promise<void> {
    this.replayLoadError.set(null);
    try {
      const payload = await this.replays.load(id);
      if (!payload) {
        // Missing run: Back-to-Library recovery and drop dead ?replay= param on refresh.
        this.replayLoadError.set(
          "We couldn't find that saved run. It may have been deleted from this browser.",
        );
        this.clearReplayQueryParam();
        return;
      }
      // Validate untrusted stored shape; ensureRegisteredForReplay skips invalid embedded specs.
      if (!isValidReplayPayload(payload)) {
        this.replayLoadError.set(
          "This saved run is corrupted or from an incompatible version and can't be replayed.",
        );
        this.clearReplayQueryParam();
        return;
      }

      this.cancel$.next();
      this.store.reset();
      this.agents.resetForNewTurn();
      this.tokenAccountant.resetTurn();
      this.lastPrompt.set(payload.prompt);
      this.saveStatus.set('idle');
      this.activeReplayId.set(id);

      // Re-register embedded specs before preloading descriptors.
      for (const spec of payload.customToolSpecs ?? []) {
        this.customTools.ensureRegisteredForReplay(spec);
      }

      // Pre-warm lazy descriptors — replay never calls registry.execute().
      await this.preloadToolDescriptors(payload.events);

      const turnId = newTurnId();
      this.store.beginTurn(turnId, 'replaying');
      this.store.loadRawHistory(payload.rawHistory);

      play(payload.events, { speed: () => this.replaySpeed() })
        .pipe(takeUntil(this.cancel$), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (event) => this.handleReplayEvent(event),
          error: (err) => this.store.markError(this.describeReplayError(err, 'play')),
        });
    } catch (err) {
      this.replayLoadError.set(this.describeReplayError(err, 'load'));
      this.clearReplayQueryParam();
    }
  }

  // Classify replay errors via ErrorService; caller owns the banner surface.
  private describeReplayError(err: unknown, op: string): string {
    return this.errors.handle(err, {
      surface: 'none',
      context: { feature: 'home', op: `replay:${op}` },
    }).userMessage;
  }

  private clearReplayQueryParam(): void {
    if (this.route.snapshot.queryParamMap.has('replay')) {
      void this.router.navigate([], { queryParams: {} });
    }
  }

  private async preloadToolDescriptors(events: readonly AgentEvent[]): Promise<void> {
    const toolNames = new Set<string>();
    for (const event of events) {
      if (event.type === 'tool_call' && this.registry.get(event.name)) {
        toolNames.add(event.name);
      }
    }
    if (toolNames.size === 0) return;
    const names = [...toolNames];
    // allSettled so one preload failure doesn't block siblings; failures go to registry.failedNames.
    const results = await Promise.allSettled(names.map((name) => this.registry.loadImpl(name)));
    for (const [i, result] of results.entries()) {
      if (result.status === 'rejected') {
        this.logger.warn('Failed to preload a replay tool descriptor.', {
          category: 'chunk_load',
          context: { feature: 'home', op: 'preloadToolDescriptors', tool: names[i] },
          error: result.reason,
        });
      }
    }
  }

  private handleReplayEvent(event: AgentEvent): void {
    this.store.pushEvent(event);
    // Replay re-issues agent_handoff because the saved log only carries the resulting event.
    if (event.type === 'agent_handoff') {
      this.agents.switchActive({
        turnId: event.turnId,
        toAgentId: event.toAgentId,
        reason: event.reason,
      });
    }
  }
}

function newTurnId(): string {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function newReplayId(): string {
  return `replay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function deriveTitle(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, ' ');
  return trimmed.length <= 60 ? trimmed : trimmed.slice(0, 57).trimEnd() + '…';
}

// Raw history from the last user message onward (current turn); falls back to full history.
function sliceCurrentTurnHistory(history: readonly HistoryContent[]): readonly HistoryContent[] {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') return history.slice(i);
  }
  return history;
}

// Collapse singleton tools to one card (latest, preferring non-failed); registry drives which names qualify.
function collapseSingletonCards(
  calls: readonly ToolCallState[],
  isSingleton: (name: string) => boolean,
): readonly ToolCallState[] {
  const winners = new Map<string, ToolCallState>();
  let hasSingleton = false;
  for (const call of calls) {
    if (!isSingleton(call.name)) continue;
    hasSingleton = true;
    const kept = winners.get(call.name);
    if (!kept) {
      winners.set(call.name, call);
      continue;
    }
    const keptFailed = kept.status === 'error' || kept.status === 'rejected';
    const candFailed = call.status === 'error' || call.status === 'rejected';
    if (keptFailed && !candFailed) winners.set(call.name, call);
    else if (keptFailed === candFailed) winners.set(call.name, call);
  }
  if (!hasSingleton) return calls;
  return calls.filter((c) => !isSingleton(c.name) || winners.get(c.name)?.callId === c.callId);
}

const TOUR_DISMISSED_KEY = 'atlas.tour.dismissed';

function hasTourBeenDismissed(): boolean {
  try {
    return localStorage.getItem(TOUR_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function markTourDismissed(): void {
  try {
    localStorage.setItem(TOUR_DISMISSED_KEY, '1');
  } catch {
    // ignore — banner will simply reappear next visit
  }
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}
