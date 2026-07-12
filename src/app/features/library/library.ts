import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { ReplayService } from '../../core/replay/replay.service';
import type { ReplaySummary } from '../../core/replay/replay.types';
import { REPLAY_WARN_BYTES } from '../../core/replay/replay-size';
import { PageHeaderComponent } from '../../shared/page-header/page-header';

@Component({
  selector: 'app-library',
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    PageHeaderComponent,
  ],
  templateUrl: './library.html',
  styleUrl: './library.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryComponent implements OnInit {
  private readonly replays = inject(ReplayService);
  private readonly router = inject(Router);

  protected readonly summaries = this.replays.summaries;
  protected readonly loaded = this.replays.loaded;
  protected readonly unavailable = this.replays.unavailable;
  protected readonly lastError = this.replays.lastError;
  protected readonly refreshFailed = computed(
    () =>
      this.loaded() &&
      this.summaries().length === 0 &&
      !this.unavailable() &&
      this.lastError() !== null,
  );
  protected readonly isEmpty = computed(
    () =>
      this.loaded() &&
      this.summaries().length === 0 &&
      !this.unavailable() &&
      !this.refreshFailed(),
  );
  // Surfaces a delete/clear failure when no broader error banner applies.
  protected readonly operationError = computed(
    () =>
      this.lastError() !== null &&
      !this.unavailable() &&
      !this.refreshFailed(),
  );

  protected readonly confirmingClear = signal(false);
  protected readonly confirmingDelete = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.replays.refresh();
  }

  protected play(summary: ReplaySummary): void {
    void this.router.navigate(['/'], { queryParams: { replay: summary.id } });
  }

  protected async deleteOne(summary: ReplaySummary, event: Event): Promise<void> {
    event.stopPropagation();
    if (this.confirmingDelete() !== summary.id) {
      this.confirmingDelete.set(summary.id);
      return;
    }
    // The service writes `lastError` and rethrows; swallow so the confirm
    // flag still resets. The banner picks up `lastError` via `operationError`.
    try {
      await this.replays.delete(summary.id);
    } catch {
      /* surfaced via operationError banner */
    } finally {
      this.confirmingDelete.set(null);
    }
  }

  protected cancelDelete(event: Event): void {
    event.stopPropagation();
    this.confirmingDelete.set(null);
  }

  protected async clearAll(): Promise<void> {
    if (!this.confirmingClear()) {
      this.confirmingClear.set(true);
      return;
    }
    try {
      await this.replays.clear();
    } catch {
      /* surfaced via operationError banner */
    } finally {
      this.confirmingClear.set(false);
    }
  }

  protected cancelClear(): void {
    this.confirmingClear.set(false);
  }

  protected dismissError(): void {
    this.replays.clearError();
  }

  protected formatDuration(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)} s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds - minutes * 60);
    return `${minutes}m ${remainder}s`;
  }

  protected formatSavedAt(iso: string): string {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  }

  protected formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  }

  // A run past the save-time soft cap is flagged so users know it may load
  // slowly before they hit Replay (L10).
  protected isLargeReplay(bytes: number | undefined): boolean {
    return bytes !== undefined && bytes > REPLAY_WARN_BYTES;
  }
}
