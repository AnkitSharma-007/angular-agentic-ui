import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

// Interim fallback when a tool module fails to load; runtime throws inside rendered tools still reach the global ErrorHandler.
@Component({
  selector: 'app-tool-error-fallback',
  imports: [MatButtonModule],
  templateUrl: './tool-error-fallback.html',
  styleUrl: './tool-error-fallback.scss',
})
export class ToolErrorFallbackComponent {
  readonly toolName = input.required<string>();
  readonly retrying = input(false);
  readonly retry = output<void>();
}
