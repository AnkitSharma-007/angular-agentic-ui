import { Component, computed, input } from '@angular/core';

import { scorePassphrase } from '../../../core/crypto/passphrase-strength';

@Component({
  selector: 'app-passphrase-strength-meter',
  templateUrl: './passphrase-strength-meter.html',
  styleUrl: './passphrase-strength-meter.scss',
})
export class PassphraseStrengthMeterComponent {
  readonly passphrase = input.required<string>();

  protected readonly strength = computed(() => scorePassphrase(this.passphrase()));
}
