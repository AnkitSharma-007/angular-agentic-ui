import { type EnvironmentProviders, provideAppInitializer, inject } from '@angular/core';
import { ToolRegistry } from './tool-registry';
import type { ToolManifest } from './tool-descriptor';
import { CustomToolsService } from '../custom-tools/custom-tools.service';

// Import each built-in manifest lazily so its (verbose) Gemini declaration
// schema stays out of the initial `main` chunk — the metadata is only needed
// once the first agent turn builds the tool list. The app initializer already
// awaits async work (IndexedDB rehydration below), so resolving these small
// modules in parallel adds no perceptible startup cost while trimming the
// initial bundle (H12).
const BUILT_IN_MANIFEST_LOADERS: ReadonlyArray<() => Promise<ToolManifest>> = [
  () =>
    import('../../shared/tools/booking-confirmation-card/booking-confirmation-card.manifest').then(
      (m) => m.bookingConfirmationCardManifest,
    ),
  () =>
    import('../../shared/tools/comparison-table/comparison-table.manifest').then(
      (m) => m.comparisonTableManifest,
    ),
  () =>
    import('../../shared/tools/flight-options-card/flight-options-card.manifest').then(
      (m) => m.flightOptionsCardManifest,
    ),
  () =>
    import('../../shared/tools/hotel-options-card/hotel-options-card.manifest').then(
      (m) => m.hotelOptionsCardManifest,
    ),
  () =>
    import('../../shared/tools/itinerary-map/itinerary-map.manifest').then(
      (m) => m.itineraryMapManifest,
    ),
  () =>
    import('../../shared/tools/activity-list/find-activities.manifest').then(
      (m) => m.findActivitiesManifest,
    ),
  () =>
    import('../../shared/tools/handoff-tool/handoff-tool.manifest').then(
      (m) => m.handoffToManifest,
    ),
  () =>
    import('../../shared/tools/propose-tool/propose-tool.manifest').then(
      (m) => m.proposeToolManifest,
    ),
];

export function provideTools(): EnvironmentProviders {
  return provideAppInitializer(async () => {
    const registry = inject(ToolRegistry);
    const customTools = inject(CustomToolsService);

    const manifests = await Promise.all(
      BUILT_IN_MANIFEST_LOADERS.map((load) => load()),
    );
    for (const manifest of manifests) {
      registry.register(manifest);
    }

    // Await IndexedDB rehydration so the first agent turn sees custom tools
    // (startup race, H6). Built-ins are registered first, so `load()` never
    // shadows them.
    await customTools.load();
  });
}
