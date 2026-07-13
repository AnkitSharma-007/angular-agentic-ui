import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

interface SamplePrompt {
  readonly icon: string;
  readonly label: string;
  readonly text: string;
}

const SAMPLE_PROMPTS: readonly SamplePrompt[] = [
  {
    icon: 'travel',
    label: 'Plan a weekend',
    text: 'Plan a weekend in Goa for two vegetarian travellers, flying from Bengaluru on 2026-06-13 and back on 2026-06-15. Find flights and a hotel, suggest a few must-do activities, and map out the trip.',
  },
  {
    icon: 'explore',
    label: 'Activities only',
    text: "I'm already in Goa — suggest five activities for food and culture lovers over a two-day stay.",
  },
  {
    icon: 'compare_arrows',
    label: 'Let me choose',
    text: 'Find flights from Bengaluru to Goa on 2026-06-13 for one passenger. Show me the options, let me pick one, then book it for Ankit Sharma and map the trip.',
  },
  {
    icon: 'route',
    label: 'Road trip',
    text: 'Plan a long-weekend road trip from Bengaluru to Coorg via Mysuru and back, with stops for lunch and a coffee-estate stay. Show the route on a map.',
  },
];

@Component({
  selector: 'app-sample-prompts',
  imports: [RouterLink, MatButtonModule],
  templateUrl: './sample-prompts.html',
  styleUrl: './sample-prompts.scss',
})
export class SamplePromptsComponent {
  readonly savedCount = input(0);
  readonly select = output<string>();

  protected readonly samplePrompts = SAMPLE_PROMPTS;
}
