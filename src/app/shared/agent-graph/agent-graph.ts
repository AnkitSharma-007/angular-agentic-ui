import { Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AgentRegistry } from '../../core/agents/agent-registry.service';

@Component({
  selector: 'app-agent-graph',
  imports: [MatIconModule],
  templateUrl: './agent-graph.html',
  styleUrl: './agent-graph.scss',
})
export class AgentGraphComponent {
  private readonly registry = inject(AgentRegistry);

  protected readonly agents = this.registry.definitions;
  protected readonly activeId = this.registry.activeAgentId;
  protected readonly transitions = this.registry.transitions;

  protected readonly hasHandedOff = computed(() => this.transitions().length > 0);

  protected readonly lastTransition = computed(() => this.transitions().at(-1) ?? null);

  protected isActive(id: string): boolean {
    return this.activeId() === id;
  }
}
