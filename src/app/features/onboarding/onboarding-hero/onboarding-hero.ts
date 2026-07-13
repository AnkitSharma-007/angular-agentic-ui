import { Component, input } from '@angular/core';

@Component({
  selector: 'app-onboarding-hero',
  templateUrl: './onboarding-hero.html',
  styleUrl: './onboarding-hero.scss',
})
export class OnboardingHeroComponent {
  readonly eyebrow = input.required<string>();
  readonly titleLead = input.required<string>();
  readonly titleAccent = input.required<string>();
  readonly subtitle = input.required<string>();
}
