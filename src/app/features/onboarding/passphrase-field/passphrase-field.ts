import { Component, input, model, output } from '@angular/core';
import { FormField, type Field } from '@angular/forms/signals';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-passphrase-field',
  imports: [FormField, MatFormFieldModule, MatInputModule, MatIconModule, MatButtonModule],
  templateUrl: './passphrase-field.html',
  styleUrl: './passphrase-field.scss',
})
export class PassphraseFieldComponent {
  readonly field = input.required<Field<string>>();
  readonly label = input.required<string>();
  readonly autocomplete = input.required<string>();
  readonly placeholder = input('');
  readonly hasToggle = input(true);
  readonly error = input<string | null>(null);
  readonly show = model(false);
  readonly enter = output<void>();
}
