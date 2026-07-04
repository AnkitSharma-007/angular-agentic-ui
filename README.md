# Atlas: Agents that build their own UI

Atlas is an **agentic UI in Angular** powered by **Gemini**. Tool calls don't return text. They instantiate live Angular components mid-stream, two specialist agents hand off control to each other, and the user is a first-class node in the agent graph with approve, reject, and choose edges.

Around the agent loop sits a production-grade frontend: a live cost-and-context meter, a waterfall observability view, a per-turn budget governor, a no-code custom-tool builder, an IndexedDB replay library, and a passphrase-encrypted Bring-Your-Own-Key store. Every token, every tool call, and every handoff is observable, budgeted, and replayable. Pure frontend SPA, no backend.

It is built to demonstrate a credible **agentic UI runtime** in a real frontend stack, not a notebook or a thin chat wrapper.

---

## The one-paragraph pitch

A travel-assistant app where two specialist agents (**TripPlanner** and **ExperienceCurator**) collaborate to plan a trip end-to-end. The agents stream their reasoning into a "Thinking" panel, invoke typed tools whose **arguments are the props of an Angular component**, pause for human approval on destructive actions (book a flight, pick an option), and hand off to each other when the conversation pivots. The travel domain is the demo; the architecture is reusable for any agentic surface.

---

## Feature highlights

### The architectural ideas

1. **Components as tools.** Each tool ships a [`ToolManifest`](./src/app/core/registry/tool-descriptor.ts) (eager) and a [`ToolDescriptor`](./src/app/core/registry/tool-descriptor.ts) (lazy). The descriptor exposes an Angular component class; the agent loop renders that component via `NgComponentOutlet` while the executor is still running. The same `<app-flight-options-card>` instance is the loading skeleton, the result, and the error state. Its `status` input flips, not its identity.
2. **Streaming agent runtime, end-to-end.** [`GeminiService.streamAgentTurn`](./src/app/core/services/gemini.service.ts) converts the raw Gemini chunk stream into a typed [`AgentEvent`](./src/app/core/streaming/agent-event.ts) sequence (`turn_start`, `thought_delta`, `tool_call`, `interrupt_request`, `tool_result`, `round_complete`, …). The UI subscribes to that stream with no `Zone.js` magic, OnPush + Signals everywhere.
3. **Dual-view state.** The [`AgentEventStore`](./src/app/core/streaming/agent-event.store.ts) keeps an append-only `AgentEvent[]` for the UI **and** a raw Gemini `Content[]` history (with `thoughtSignature` blobs preserved verbatim) for the next API round. Two shapes, one source of truth, never drifts.
4. **Human-in-the-loop interrupts.** Tools marked `interruptive: true` pause the agent loop on a `Promise<InterruptDecision>` resolved by the UI (`InterruptService`). `bookFlight` waits for Approve / Reject; `letUserChoose` lets the user pick a row from a comparison grid; the user's pick is fed back to the model as the tool's response.
5. **Multi-agent handoff with a reactive graph.** [`AgentRegistry`](./src/app/core/agents/agent-registry.service.ts) holds the active agent and a per-turn handoff log. The shared `handoffTo` tool transitions control between agents; the [`<app-agent-graph>`](./src/app/shared/agent-graph/agent-graph.ts) visualises it live.

### The operator-grade surface

6. **Live observability dashboard.** A side drawer ([`ObservabilityDrawerComponent`](./src/app/shared/observability-drawer/observability-drawer.ts)) renders a waterfall of every round and every tool call on a shared time axis, colour-coded by status, with usage / latency / cost / model on each row.
7. **Cost & context meter.** A persistent header pill ([`CostMeterComponent`](./src/app/shared/cost-meter/cost-meter.ts)) shows the live USD spend, token totals, context utilisation, and latency for the current turn. Expandable to a full breakdown by input / output / thinking tokens.
8. **Per-turn budget governor.** [`BudgetService`](./src/app/core/observability/budget.service.ts) enforces user-configurable caps on tokens, rounds, and dollars. The agent loop checks the budget at the start of every round and short-circuits with a `BUDGET_EXCEEDED:<kind>` finish reason if breached.
9. **Custom tool builder.** A no-code form ([`/tools`](./src/app/features/tools/tools.ts)) lets users define a tool (name, description, parameters, JSON response template) and Atlas registers it with the runtime _without a reload_. New tools persist in IndexedDB and are available to the agent on the very next prompt.
10. **Replay library.** Any completed turn can be saved to IndexedDB as a `ReplayPayload`. The [Library](./src/app/features/library/library.ts) lists them; "Play" navigates back to the home page with `?replay=<id>` and the saved `AgentEvent[]` is fed through [`ReplayPlayer`](./src/app/core/replay/replay-player.ts). Same UI, same inter-event timing, no API call.

### The production basics

11. **BYOK with two storage tiers.** Session-only (cleared on tab close) or AES-GCM encrypted in localStorage behind a PBKDF2-derived key (250 000 iterations). See [`api-key.service.ts`](./src/app/core/services/api-key.service.ts) + [`webcrypto.helpers.ts`](./src/app/core/crypto/webcrypto.helpers.ts).
12. **Lazy everything.** Routes lazy-load. Tool _implementations_ lazy-load (Zod + components stay out of the initial bundle until used). Leaflet (~140 kB) loads only when the itinerary map enters the viewport via `@defer (on viewport)`. Initial gzip transfer is ~143 kB.
13. **Zoneless Angular**, standalone components, Signals-first, OnPush across the board, new control flow (`@if`, `@for`, `@defer`).
14. **Markdown rendering is sanitised by default** (no `bypassSecurityTrustHtml`); model output passes through `marked` (no raw-HTML) and then Angular's `DomSanitizer`.

---

## Architecture at a glance

**Layers**, from `src/app/`:

```
core/                singleton services and types; never any UI
├── services/        ApiKeyService, GeminiService, ThemeService, ModelSelectionService
├── streaming/       AgentEvent, AgentEventStore, chunkToEvents operator, raw-history reducer
├── registry/        ToolRegistry, ToolDescriptor, InterruptService, parallel tool execution
├── observability/   TokenAccountantService, BudgetService, ObservabilityService, pricing
├── agents/          AgentDefinition, AgentRegistry, built-in agent specs
├── custom-tools/    CustomToolsService, IndexedDB-backed user-defined tools
├── replay/          ReplayService (persistence), ReplayPlayer (playback)
├── crypto/          WebCrypto AES-GCM + PBKDF2 helpers
├── storage/         Promise-shaped IndexedDB wrapper
└── errors.ts        Shared SDK-error → human-readable mapper

features/            one folder per route, all lazy-loaded
├── home/            chat + tool-render surface
├── onboarding/      API key entry, test, save (session or encrypted-local)
├── library/         saved replays
├── tools/           custom tool builder
├── settings/        model selection, budgets, theme, key management
├── about/           project overview
└── security/        threat model + crypto choices

shared/              reusable UI
├── header/          app bar with nav + observability + theme + settings
├── footer/          minimal footer
├── thought/         live thought-stream panel
├── markdown/        sanitised Markdown renderer
├── cost-meter/      live cost/token/context pill (eager)
├── observability-drawer/   waterfall + detail panel (eager)
├── agent-graph/     active-agent + handoff visualiser
└── tools/           one folder per tool (manifest + descriptor + component + types)
```

For the agent loop itself, the canonical entry point is [`GeminiService.streamAgentTurn`](./src/app/core/services/gemini.service.ts) → `runAgentLoop` → `streamRound` → `settleRoundToolCalls` → `applyHandoffIfRequested`. Read those five methods top-to-bottom for a complete picture in ~150 lines.

---

## Tech stack

| Concern           | Choice                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Framework         | **Angular** (standalone, zoneless, Signals, new control flow)                                                            |
| UI kit            | **Angular Material** (token-based theming, light/dark/system)                                                            |
| LLM               | **Gemini** via [`@google/genai`](https://www.npmjs.com/package/@google/genai) (streaming; tier picker in Settings)       |
| Reactive state    | **Signals** for component state, **RxJS** for streams                                                                    |
| Schema validation | **Zod** (lazy-loaded, kept out of the initial bundle)                                                                    |
| Map rendering     | **Leaflet** (lazy-loaded via `@defer (on viewport)`)                                                                     |
| Markdown          | **marked** with `DomSanitizer`                                                                                           |
| Persistence       | **IndexedDB** (replays, custom tools); **localStorage** (budgets, encrypted key blob); **sessionStorage** (session keys) |
| Crypto            | **WebCrypto** (AES-GCM + PBKDF2-SHA256, 250k iterations)                                                                 |
| Test runner       | **Vitest** via Angular's `@angular/build:unit-test` builder                                                              |
| Mock IDB in tests | **fake-indexeddb**                                                                                                       |
| Build             | **esbuild + Vite** (Angular's `@angular/build` toolchain)                                                                |

The full dependency manifest lives in [`package.json`](./package.json).

---

## Run it locally

Atlas is a pure frontend SPA. You bring your own Gemini API key; nothing about the app talks to any other server.

### Prerequisites

| Tool               | Tested with                             | Why                                                    |
| ------------------ | --------------------------------------- | ------------------------------------------------------ |
| **Node.js**        | current LTS (`v20.x` or `v22.x` tested) | required by Angular CLI                                |
| **npm**            | `10.8+`                                 | shipped with current LTS Node                          |
| **Modern browser** | Chrome / Edge / Safari / Firefox latest | needs `crypto.subtle` and modern IndexedDB             |
| **Gemini API key** | free tier is enough                     | grab one from <https://aistudio.google.com/app/apikey> |

### Install

From this directory (the `app/` folder of the project):

```bash
npm install
```

`npm install` may take 60–90 seconds on a cold cache; you should see no peer-dep warnings on a current LTS Node.

### Start the dev server

```bash
npm start
# or, if you prefer:
ng serve
```

Open **<http://localhost:4200>**.

The first time the app loads, it routes you to an onboarding screen:

1. Paste your Gemini API key.
2. _(Optional)_ Click **Test connection**. Atlas issues a single fast "say ok" call to Gemini and reports the round-trip status.
3. Choose where to store the key:
   - **For this session only** (default, safest, lives in `sessionStorage` until tab close).
   - **Remember on this device**: you set a passphrase, the key is AES-GCM encrypted with a PBKDF2-derived key and stored in `localStorage`. On the next visit you re-enter the passphrase to unlock.
4. Click **Continue** and you land on the chat surface.

### Build a production bundle

```bash
npm run build
# Output: dist/agentic-ui-angular/
```

Hosting is out of scope. Drop the `dist/` artefact on any static host (Vercel, Netlify, GitHub Pages, S3+CloudFront). No server-side state.

### Run the test suite

```bash
npm test -- --watch=false
```

Expected: **46 test files / 296 tests passing** in a few seconds.

Coverage runs through the same Vitest runner and writes a full HTML report under `coverage/`:

```bash
npm run test:coverage
```

Current numbers hover in the **low-to-mid seventies** across lines, statements, branches, and functions. The pure runtime (agent loop, streaming primitives, tool registry, observability, persistence, crypto) sits well above that; the larger feature-page templates and the `GeminiService` SDK-adapter layer pull the headline number down.

The suite covers the deterministic, pure parts of the runtime that would be costly to regress, plus smoke tests for every tool component and feature page:

- **Agent loop**: `agent-loop.spec.ts` and `agent-turn.integration.spec.ts` exercise the full multi-round flow (thinking → tool call → settle → handoff → finish) against a mocked Gemini stream.
- **Streaming primitives**: `to-agent-event.operator.spec.ts`, `agent-event.store.spec.ts`, `raw-history.reducer.spec.ts`, `agent-stream.spec.ts`.
- **Tool runtime**: `tool-registry.spec.ts`, `tool-execution.spec.ts`, `interrupt.service.spec.ts`.
- **Persistence & security**: `indexeddb.helpers.spec.ts`, `webcrypto.helpers.spec.ts`, `api-key.service.spec.ts`, `replay.service.spec.ts`, `replay-player.spec.ts`.
- **Observability**: `budget.service.spec.ts`, `token-accountant.service.spec.ts`, `observability.service.spec.ts`, `observability-drawer.service.spec.ts`.
- **Agents & custom tools**: `agent-registry.service.spec.ts`, `custom-tools.service.spec.ts`, `custom-tool.types.spec.ts`.
- **UI surfaces**: smoke specs for every tool card (flights, hotels, comparison, booking, activities, custom, handoff), the cost meter, agent graph, markdown / thought renderers, header / footer, and feature pages (about, security, library, onboarding, settings, tools).

---

## Using the app

Once you're past onboarding, the home page has three regions:

```
+-----------------------------------------------------------------------------+
| Header [ Chat | Library | Tools | About | Security ]   $0.012  ⚙  observe  |
+-----------------------------------------------------------------------------+
|                                                                             |
|  Hero copy + 4 sample prompts                                               |
|                                                                             |
|  [ Thinking ▾ ]  ← live thought-summary stream                              |
|                                                                             |
|  [ Tool call cards (NgComponentOutlet) ]                                    |
|     · Flights · Hotels · Comparison · Booking · Itinerary · Activities ·    |
|     · Handoff notice · Custom-tool card ·                                   |
|                                                                             |
|  [ Response (Markdown) ]                                                    |
|                                                                             |
|  +-----------------------------------------------------------------+        |
|  | Prompt textarea                                          [Send] |        |
|  +-----------------------------------------------------------------+        |
|                                                                             |
+-----------------------------------------------------------------------------+
```

### A suggested tour (≈4 minutes, hits every feature)

1. **Sample prompt: "Plan a weekend"** (top-left card). Click → click **Send**.
   - You'll see the **Thinking** panel fill in real time.
   - **`searchFlights`** and **`searchHotels`** kick off in **parallel**; their cards appear with skeleton loaders, then settle independently (flights first, then hotels, on different mock latencies).
   - The agent then calls **`letUserChoose`**. Pick any flight.
   - Then **`bookFlight`**. The card pauses on **Approve / Reject**. Approve. Watch the card flip from pending → running → confirmed.
   - Finally **`renderItinerary`** mounts a Leaflet map (lazy-loaded chunk; check the network tab).
2. **Open the Observability drawer** (top-right `monitoring` icon). You'll see a waterfall row per round and per tool call. Click any row for the detail panel.
3. **Expand the Cost Meter** (header pill, e.g. `$0.012 · 1.2k`). Pricing breakdown by input / output / thinking tokens, plus the live context-window utilisation.
4. **Hand off to the second agent.** Use the **"Activities only"** sample prompt. The model calls `handoffTo` with `specialist: "experienceCurator"`. The agent-graph header above the cards animates to the new active node and `findActivities` runs under ExperienceCurator.
5. **Save the run.** Click **Save** at the bottom of the response card. Navigate to **Library**.
6. **Replay it.** Click **Replay** on the saved row. The home page reloads with no API call: same UI, same timing, deterministic.
7. **Build a custom tool.** Go to **Tools** → click **Load example**. Save the `searchWeather` tool. Return to **Chat**. Ask _"What's the weather in Goa on 2026-06-15?"_ and the agent picks up your tool, with the response rendering in a generic custom-tool card.
8. **Set a budget.** Go to **Settings** → apply the **Tight** budget preset (3 rounds, 10k tokens, $0.02). Send a complex prompt. When the cap is hit, the turn ends with `BUDGET_EXCEEDED:tokens` (or rounds / cost) and a banner shows which limit fired.

### The four sample prompts (also visible in the app)

| Card            | Demonstrates                                                                     |
| --------------- | -------------------------------------------------------------------------------- |
| Plan a weekend  | Multi-tool agent loop, parallel execution, HITL approval, Leaflet `@defer`       |
| Activities only | Agent handoff, second specialist, dynamic system prompt + tool gating            |
| Let me choose   | `letUserChoose` interactive selection, downstream tool reading the picked option |
| Road trip       | Pure `renderItinerary` showcase, multi-waypoint route on the map                 |

---

## Where the interesting code lives

If you have ten minutes to read code, read these in order:

1. **[`core/services/gemini.service.ts`](./src/app/core/services/gemini.service.ts)**: the agent loop. `streamAgentTurn` → `runAgentLoop` → `streamRound` → `settleRoundToolCalls` → `applyHandoffIfRequested`.
2. **[`core/streaming/to-agent-event.operator.ts`](./src/app/core/streaming/to-agent-event.operator.ts)**: the pure function that turns Gemini chunks into typed events. Heavily unit-tested.
3. **[`core/streaming/agent-event.store.ts`](./src/app/core/streaming/agent-event.store.ts)**: the dual-view state container.
4. **[`core/registry/tool-registry.ts`](./src/app/core/registry/tool-registry.ts)** + **[`core/registry/tool-execution.ts`](./src/app/core/registry/tool-execution.ts)**: eager manifests, lazy descriptors, parallel-as-they-settle tool execution.
5. **[`core/registry/interrupt.service.ts`](./src/app/core/registry/interrupt.service.ts)**: bridges the agent loop's `Promise<InterruptDecision>` with UI signals.
6. **[`shared/tools/booking-confirmation-card/`](./src/app/shared/tools/booking-confirmation-card)**: the cleanest example of a four-state HITL tool component (`pending_approval` → `running` → `complete` / `rejected`).
7. **[`core/observability/`](./src/app/core/observability)**: `TokenAccountantService`, `BudgetService`, `ObservabilityService`, `pricing.ts`. All under 100 lines each.
8. **[`core/custom-tools/`](./src/app/core/custom-tools)**: how a no-code tool spec becomes a registry entry: `custom-tool.types.ts` → `custom-tool-declaration.ts` (eager, zero-dep) → `custom-tool-descriptor.ts` (lazy, Zod + component).
9. **[`core/crypto/webcrypto.helpers.ts`](./src/app/core/crypto/webcrypto.helpers.ts)** + **[`core/services/api-key.service.ts`](./src/app/core/services/api-key.service.ts)**: AES-GCM envelope, PBKDF2, two storage tiers.
10. **[`core/replay/replay-player.ts`](./src/app/core/replay/replay-player.ts)**: observable that re-emits a saved event sequence with the original inter-event timing (clamped + speed-scaled).

---

## Security model

| Concern                          | How Atlas handles it                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API key is never sent to our servers | There is no backend, proxy, or telemetry server. The key is read directly into `GoogleGenAI({ apiKey })` and sent only to Google's Gemini API from your browser.                                                              |
| Default storage (session tier)   | The key is AES-GCM-encrypted with a random **non-extractable** per-session key (KEK). Only the ciphertext lives in `sessionStorage` (cleared on tab close); the KEK is a `CryptoKey` handle in IndexedDB whose raw bytes can never be read back. The plaintext key is never at rest, and XSS can't exfiltrate the KEK. Survives a reload within the session. |
| Persistent storage               | AES-GCM-256 with a PBKDF2-SHA256-derived key (250 000 iterations). Salt + IV are random per encryption. The passphrase is never persisted.                                                                               |
| Wrong passphrase                 | `DecryptionFailedError`: the UI shows a generic "passphrase did not unlock" message; no oracle for brute force.                                                                                                          |
| Markdown XSS                     | Two-layer defence: `marked` renders raw HTML as inert escaped text (never parsed) and drops links with an unsafe scheme (`javascript:`/`data:`…), and the output still passes through Angular's built-in `DomSanitizer` via `[innerHTML]`. We intentionally do **not** call `bypassSecurityTrustHtml`. |
| Tool args                        | Every tool descriptor declares a Zod schema. The registry refuses to invoke an executor with invalid args, surfacing a typed `tool_result` error event the agent can recover from.                                       |
| Replay payloads                  | Stored only in the user's local IndexedDB; never uploaded. The Library has explicit per-row delete and a "Delete all" button.                                                                                            |
| CSP                              | The HTML response sets a strict-default CSP suitable for this SPA; only `aistudio.google.com` and `generativelanguage.googleapis.com` are reached on the network tab during a normal session.                            |

The in-app **Security** route walks through the same threat model with the actual constants visible.

---

## Known limitations / what's mocked

Atlas is a frontend application. The model **is real**, but the tool _backends_ are not. To keep the app reliable and zero-cost to run:

- `searchFlights`, `searchHotels`, `bookFlight`, `renderItinerary`, `findActivities` return **deterministic mock data** keyed off their args (same args → same response). Latencies are simulated to make parallel-as-they-settle visible.
- `bookFlight` does **not** book a real flight; it returns a confirmation payload with a synthesised booking ref.
- There is no auth, no multi-user state, no server-rendered surface. The whole app is a static SPA.
- Token prices in [`core/observability/pricing.ts`](./src/app/core/observability/pricing.ts) follow the public Gemini pricing page at the time of writing; update the table to match current pricing.

Switching any tool to a real backend is a one-file change: replace the `execute` function in the descriptor. The component, declaration, and schema stay identical.

---

## Troubleshooting

| Symptom                                                          | Likely cause                                                                                                  | Fix                                                                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Authentication failed. Your API key may be invalid or expired." | No key, expired session, or revoked/invalid key (all auth failures funnel through the same humanised message) | Open **Settings** → **Forget saved key** to re-onboard. If the key itself is bad, generate a new one in [AI Studio](https://aistudio.google.com/app/apikey).                      |
| `429 / rate.?limit / quota`                                      | Free-tier RPM exceeded                                                                                        | Wait a minute, or switch model in **Settings**.                                                                                                                                   |
| "passphrase did not unlock the stored key"                       | Wrong passphrase                                                                                              | Re-enter, or click **Forget saved key** to re-onboard from scratch.                                                                                                               |
| Cards say "running" forever                                      | Browser blocked the request (e.g. corp proxy)                                                                 | Check the network tab; the request to `generativelanguage.googleapis.com` should be visible.                                                                                      |
| Map never appears                                                | Browser blocked OSM tiles                                                                                     | Open the network tab while the itinerary card is in view; `tile.openstreetmap.org` must be reachable.                                                                             |
| `IndexedDB blocked` in Library / Tools                           | Private-browsing mode or storage quota                                                                        | The app gracefully degrades: the **Library** and **Tools** pages render an inline "storage unavailable" banner instead of the editor or list, but the chat surface keeps working. |
