import {
  Component,
  DestroyRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';

import { ApiKeyService } from '../../core/services/api-key.service';
import { GeminiService } from '../../core/services/gemini.service';
import { ErrorService } from '../../core/errors/error.service';
import { LoggerService } from '../../core/logging/logger.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { ConnectivityService } from '../../core/connectivity/connectivity.service';
import { AgentEventStore } from '../../core/streaming/agent-event.store';
import { ToolRegistry } from '../../core/registry/tool-registry';
import { ReplayService } from '../../core/replay/replay.service';
import { CustomToolsService } from '../../core/custom-tools/custom-tools.service';
import type { CustomToolSpec } from '../../core/custom-tools/custom-tool.types';
import { TokenAccountantService } from '../../core/observability/token-accountant.service';
import { AgentRegistry } from '../../core/agents/agent-registry.service';
import { play, type ReplaySpeed } from '../../core/replay/replay-player';
import type { AgentEvent } from '../../core/streaming/agent-event';
import type { HistoryContent } from '../../core/streaming/raw-history.reducer';
import type { InlineAttachment } from '../../core/media/attachment.types';
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
import { prefixedId } from '../../core/utils/id';
import { OnboardingComponent } from '../onboarding/onboarding';
import { ThoughtComponent } from '../../shared/thought/thought';
import { MarkdownComponent } from '../../shared/markdown/markdown';
import { AgentGraphComponent } from '../../shared/agent-graph/agent-graph';
import { HomeHeroComponent } from './hero/hero';
import { TourBannerComponent } from './tour-banner/tour-banner';
import { SamplePromptsComponent } from './sample-prompts/sample-prompts';
import { UserTurnComponent } from './user-turn/user-turn';
import { ReplayBannerComponent } from './replay-banner/replay-banner';
import { ToolCallListComponent } from './tool-call-list/tool-call-list';
import { PromptComposerComponent } from './prompt-composer/prompt-composer';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

@Component({
  selector: 'app-home',
  imports: [
    RouterLink,
    OnboardingComponent,
    ThoughtComponent,
    MarkdownComponent,
    AgentGraphComponent,
    HomeHeroComponent,
    TourBannerComponent,
    SamplePromptsComponent,
    UserTurnComponent,
    ReplayBannerComponent,
    ToolCallListComponent,
    PromptComposerComponent,
    MatCardModule,
    MatButtonModule,
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

  private readonly composer = viewChild(PromptComposerComponent);

  protected readonly prompt = signal('');
  protected readonly lastPrompt = signal('');
  protected readonly attachments = signal<readonly InlineAttachment[]>([]);
  protected readonly attachmentError = signal<string | null>(null);

  protected readonly micSupported = isSpeechRecognitionSupported();
  protected readonly isRecording = signal(false);
  protected readonly micError = signal<string | null>(null);
  private speechController: SpeechController | null = null;
  private micBaseText = '';

  protected readonly composerNotice = computed(() => this.attachmentError() ?? this.micError());
  protected readonly phase = this.store.phase;
  protected readonly responseText = this.store.responseText;
  protected readonly toolCalls = this.store.toolCalls;
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
  protected readonly activeReplayId = signal<string | null>(null);
  // Replay load failure banner with Back-to-Library recovery — separate from streaming errors.
  protected readonly replayLoadError = signal<string | null>(null);
  protected readonly canSave = computed(() => {
    return (
      this.phase() === 'complete' &&
      this.hasOutput() &&
      this.lastPrompt().length > 0 &&
      this.activeReplayId() === null
    );
  });

  protected readonly sendShortcutModifier = isMacPlatform() ? '⌘' : 'Ctrl';

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

  // Human-readable "what's happening" line for the initial thinking state — keeps
  // raw stream telemetry (chunks/parts) out of the primary flow (it lives in the
  // observability drawer). Reads from the active agent so handoffs update the copy.
  protected readonly streamingStatus = computed(() => {
    switch (this.agents.activeAgentId()) {
      case 'tripPlanner':
        return 'Planning your trip…';
      case 'experienceCurator':
        return 'Curating experiences…';
      default:
        return 'Working on it…';
    }
  });

  private readonly cancel$ = new Subject<void>();

  ngOnInit(): void {
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

  // afterNextRender waits for the composer's textarea to render before focusing it.
  private focusPromptArea(): void {
    afterNextRender(() => this.composer()?.focusInput(), { injector: this.injector });
  }

  protected cancel(): void {
    this.cancel$.next();
    this.store.markCancelled();
  }

  protected reset(): void {
    this.cancel$.next();
    if (this.isRecording()) this.stopRecording();
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
    const turnId = prefixedId('turn');

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

  protected removeAttachment(id: string): void {
    this.attachments.update((list) => list.filter((a) => a.id !== id));
  }

  protected async addFiles(files: readonly File[]): Promise<void> {
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
        id: prefixedId('replay'),
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
          "We couldn't find that saved conversation. It may have been deleted from this browser.",
        );
        this.clearReplayQueryParam();
        return;
      }
      // Validate untrusted stored shape; ensureRegisteredForReplay skips invalid embedded specs.
      if (!isValidReplayPayload(payload)) {
        this.replayLoadError.set(
          "This saved conversation is corrupted or from an incompatible version and can't be replayed.",
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

      const turnId = prefixedId('turn');
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

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}
