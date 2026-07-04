import { Service, computed, signal } from '@angular/core';
import { BUILT_IN_AGENTS, DEFAULT_AGENT_ID } from './agent-definitions';
import type { AgentDefinition } from './agent.types';

export interface AgentTransition {
  readonly turnId: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly reason: string;
  readonly ts: number;
}

@Service()
export class AgentRegistry {
  private readonly _definitions = signal<readonly AgentDefinition[]>(BUILT_IN_AGENTS);
  private readonly _activeAgentId = signal<string>(DEFAULT_AGENT_ID);
  private readonly _transitions = signal<readonly AgentTransition[]>([]);

  readonly definitions = this._definitions.asReadonly();
  readonly activeAgentId = this._activeAgentId.asReadonly();
  readonly transitions = this._transitions.asReadonly();

  readonly activeAgent = computed<AgentDefinition>(() => {
    const id = this._activeAgentId();
    return this._definitions().find((a) => a.id === id) ?? this._definitions()[0];
  });

  resetForNewTurn(): void {
    this._activeAgentId.set(DEFAULT_AGENT_ID);
    this._transitions.set([]);
  }

  get(id: string): AgentDefinition | undefined {
    return this._definitions().find((a) => a.id === id);
  }

  switchActive(input: {
    readonly turnId: string;
    readonly toAgentId: string;
    readonly reason: string;
  }): AgentTransition | null {
    const from = this._activeAgentId();
    if (from === input.toAgentId) return null;
    if (!this.get(input.toAgentId)) return null;

    const transition: AgentTransition = {
      turnId: input.turnId,
      fromAgentId: from,
      toAgentId: input.toAgentId,
      reason: input.reason,
      ts: Date.now(),
    };
    this._activeAgentId.set(input.toAgentId);
    this._transitions.update((list) => [...list, transition]);
    return transition;
  }
}
