import {
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AgentEventStore } from '../../core/streaming/agent-event.store';
import { MarkdownComponent } from '../markdown/markdown';

@Component({
  selector: 'app-thought',
  imports: [MatExpansionModule, MatProgressBarModule, MarkdownComponent],
  templateUrl: './thought.html',
  styleUrl: './thought.scss',
})
export class ThoughtComponent {
  private readonly store = inject(AgentEventStore);

  protected readonly text = this.store.thoughtText;
  protected readonly phase = this.store.phase;

  protected readonly hasContent = computed(() => this.text().length > 0);
  protected readonly isLive = computed(() => {
    const turn = this.store.currentTurn();
    return this.phase() === 'streaming' && !turn.finishReason;
  });
  protected readonly charCount = computed(() => this.text().length);

  // Auto-open once per turn; manual toggles win after that.
  protected readonly expanded = signal(false);

  constructor() {
    let lastAutoOpenedTurn = '';
    effect(() => {
      const turn = this.store.currentTurn();
      if (!turn.id) {
        lastAutoOpenedTurn = '';
        return;
      }
      if (this.hasContent() && turn.id !== lastAutoOpenedTurn) {
        this.expanded.set(true);
        lastAutoOpenedTurn = turn.id;
      }
    });
  }
}
