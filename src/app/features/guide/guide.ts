import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';

import { APP_CONFIG } from '../../core/app-config';
import { PageHeaderComponent } from '../../shared/page-header/page-header';

interface GuideStep {
  readonly index: number;
  readonly title: string;
  readonly demonstrates: string;
  readonly details: readonly string[];
  readonly prompt?: string;
  readonly action?: { readonly label: string; readonly link: string };
  readonly watchFor?: string;
}

interface DeepDive {
  readonly icon: string;
  readonly title: string;
  readonly body: string;
  readonly link: string;
  readonly cta: string;
}

@Component({
  selector: 'app-guide',
  imports: [RouterLink, MatCardModule, MatButtonModule, PageHeaderComponent],
  templateUrl: './guide.html',
  styleUrl: './guide.scss',
})
export class GuideComponent {
  protected readonly config = APP_CONFIG;

  protected readonly steps: readonly GuideStep[] = [
    {
      index: 1,
      title: 'Plan a weekend',
      demonstrates:
        'The full agent loop, with parallel tool calls, human-in-the-loop approval, and a Leaflet map mounted lazily.',
      details: [
        'The Thinking panel fills in real time as the model reasons.',
        'Flight and hotel searches fire in parallel; their cards land independently as each settles.',
        'A comparison card pauses the loop and asks you to pick a flight.',
        'The booking card pauses again on Approve / Reject. Approve and watch it flip pending → running → confirmed.',
        'Finally, the trip map mounts a Leaflet view (check the network tab for the lazy chunk).',
      ],
      prompt:
        'Plan a weekend in Goa for 2 vegetarian travellers leaving Bengaluru on 2026-06-13 and returning 2026-06-15. Suggest flights, a hotel, recommend a few must-do activities, and render the itinerary on a map.',
      watchFor: 'Tool cards with skeleton loaders, the agent graph, and the cost pill in the header.',
    },
    {
      index: 2,
      title: 'Open the Observability dashboard',
      demonstrates:
        'Per-round and per-tool waterfall, latency, and token attribution. The agent loop made visible.',
      details: [
        'Click the monitoring icon (top-right of the header).',
        'Each round and each tool call is a row in the waterfall.',
        'Click any row for the detail panel: arguments, result, duration, token cost.',
      ],
      action: { label: 'Open the dashboard from the chat page', link: '/' },
      watchFor: 'The breakdown of where time and tokens actually go inside a turn.',
    },
    {
      index: 3,
      title: 'Expand the Cost Meter',
      demonstrates:
        'Live pricing, model-specific rates, and context-window utilisation for a serverless BYOK app.',
      details: [
        'Click the cost pill in the header (e.g. $0.012 · 1.2k).',
        'See input / output / thinking tokens broken out separately, plus the context window meter.',
        'All math is client-side; no telemetry leaves the browser.',
      ],
      action: { label: 'Back to chat', link: '/' },
    },
    {
      index: 4,
      title: 'Hand off to a second agent',
      demonstrates:
        'Multi-agent orchestration. The agent graph animates as control transfers between specialists.',
      details: [
        'The Trip Planner recognises that the request is about activities and hands off to the Experience Curator.',
        'The agent-graph header above the response animates to the new active node.',
        'The Experience Curator then searches activities under its own system prompt and tool surface.',
      ],
      prompt:
        'I am already in Goa. Suggest 5 activities for foodies and culture lovers over a 2-day stay.',
      watchFor: 'The agent graph nodes lighting up as control moves.',
    },
    {
      index: 5,
      title: 'Save the run',
      demonstrates: 'Deterministic replay. Every turn can be persisted and re-emitted with original timing.',
      details: [
        'Click Save at the bottom of any completed turn.',
        'Navigate to the Library page, where the run appears with title, duration, and event count.',
      ],
      action: { label: 'Open the Library', link: '/library' },
    },
    {
      index: 6,
      title: 'Replay it',
      demonstrates: 'Byte-identical playback from IndexedDB. No API calls, no tokens, same UI.',
      details: [
        'In the Library, click Replay on the saved row.',
        'The home page reloads with no network call. Events re-emit at the original cadence.',
        'Try 2× or 4× speed from the replay banner to fast-forward.',
      ],
      action: { label: 'Open the Library', link: '/library' },
    },
    {
      index: 7,
      title: 'Build a custom tool',
      demonstrates:
        'A no-code tool spec becomes a real function declaration the agent can call, with the same lifecycle as built-in tools.',
      details: [
        'Open the Tools page and click Load example.',
        'Save the searchWeather tool.',
        'Return to chat and ask: "What\'s the weather in Goa on 2026-06-15?".',
        'The agent picks up the custom tool, calls it, and renders the response in a generic card.',
      ],
      action: { label: 'Open the Tool builder', link: '/tools' },
    },
    {
      index: 8,
      title: 'Set a budget',
      demonstrates:
        'Token, round, and cost ceilings enforced inside the agent loop. The turn terminates cleanly the moment a cap is hit.',
      details: [
        'Open Settings and apply the Tight budget preset (3 rounds, 10k tokens, $0.02).',
        'Send a complex prompt back on the chat page.',
        'When the cap fires, the loop ends and a banner shows which limit was hit (tokens, rounds, or cost).',
      ],
      action: { label: 'Open Settings', link: '/settings' },
      prompt:
        'Plan a weekend in Goa for 2 vegetarian travellers leaving Bengaluru on 2026-06-13 and returning 2026-06-15. Suggest flights, a hotel, recommend a few must-do activities, and render the itinerary on a map.',
    },
  ];

  protected readonly deepDives: readonly DeepDive[] = [
    {
      icon: 'tune',
      title: 'Settings',
      body: 'Pick a Gemini model, set budget caps, and try the Tight / Demo / Generous presets.',
      link: '/settings',
      cta: 'Open Settings',
    },
    {
      icon: 'handyman',
      title: 'Tool builder',
      body: 'Author a custom tool with parameters and a response template. No code.',
      link: '/tools',
      cta: 'Open Tool builder',
    },
    {
      icon: 'video_library',
      title: 'Library',
      body: 'Saved runs persist in IndexedDB. Replay any one with original timing.',
      link: '/library',
      cta: 'Open Library',
    },
    {
      icon: 'shield_with_heart',
      title: 'Security',
      body: 'See how the BYOK key is held: AES-GCM + PBKDF2, two storage tiers, zero server.',
      link: '/security',
      cta: 'Read the model',
    },
  ];
}
