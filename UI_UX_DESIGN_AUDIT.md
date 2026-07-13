# Atlas — UI/UX & Visual Design Audit

**Reviewed:** Full application (all routes, shared UI, tool cards, global theme)
**Lens:** Production-ready commercial SaaS product
**Method:** Static audit of implementation (SCSS/HTML/TS + templates). The app was not rendered live, so contrast/visual-weight judgments are inferred from code (hex values, tokens, sizes) and flagged where verification is recommended.
**Tone:** Direct and unsoftened, as requested.

---

## TL;DR verdict

Atlas is a **genuinely impressive engineering demo wearing a good-but-inconsistent design coat.** In dark mode it looks modern and confident — glassmorphism, aurora gradients, a slick composer, thoughtful loading/empty/error states, and a polished onboarding. That's above the average side-project bar.

But judged as a **commercial product**, it is not there yet. Three things hold it back hardest:

1. **It talks like an engineering demo, not a product.** The hero, the always-on cost pill, and inline telemetry ("chunks 12 · parts 30 · signed 4", "streaming pipeline online") expose the machinery to the user. This is the single biggest thing separating it from a premium feel.
2. **There is no real design-token system.** Spacing, radius, and type are magic numbers scattered across ~59 SCSS files (`13.5px`, `11.5px`, `0.8125rem`, radii of 6/8/10/12/14/16/18/20/24px). Brand and semantic colors are hardcoded hex (`#7C5CFF`, `#13D0C9`, `#5cf6c9`…) instead of tokens, which threatens light-theme fidelity and consistency.
3. **Accessibility has real gaps** despite good intentions: sub-44px touch targets, gradient-clipped text that likely fails contrast, and incomplete `prefers-reduced-motion` coverage on some of the most animated components.

**It feels like a strong late-stage MVP / "impressive internal tool," not a shipped premium SaaS.** With a focused polish pass (mostly quick wins) it could jump a full tier.

---

## 1. First impression — "Is there a wow moment?"

**Partial wow, then a wobble.**

The dark-mode landing genuinely lands: the animated gradient headline (`hero.scss:39`), drifting blurred orbs (`hero.scss:66-101`), the "Live · streaming pipeline online" pill, and the frosted composer read as a modern AI product. The streaming experience — thought panel → parallel tool cards with skeletons → live "Atlas is thinking…" equalizer bars (`home.scss:31-56`) → markdown response — is legitimately delightful and is the product's strongest asset.

What undercuts the wow within seconds:

- **The hero is a bordered card inside a 1200px column** (`app.scss:12-19`, `hero.scss:5-17`), not a full-bleed moment. It reads "dashboard section," not "landing." Premium products open with air and scale; this opens boxed-in.
- **A floating "$0.000 · 0 tok" pill sits bottom-right before the user has done anything** (`cost-meter.html:1-22`, always rendered after idle). Leading with a cost counter at zero is an engineer's instinct, not a product's. It signals "this costs money and we're watching" before delivering any value.
- **Copy is developer-facing.** "Agents that build their own UI," "streaming pipeline online," and later "chunks/parts/signed" telemetry (`home.html:50-54, 101-106`) speak to the person who built it, not the person using it.

Net: the _motion and materials_ say premium; the _framing and copy_ say demo.

---

## 2. Prioritized issues (highest impact first)

Severity: **P0** = blocks a premium/production perception · **P1** = clearly hurts polish/consistency/a11y · **P2** = refinement.

### P0-1 — The UI exposes its own internals to end users

**What:** Inline telemetry and infra language surface throughout the primary flow: the streaming indicator prints `chunks {{}} · parts {{}} · signed {{}}` (`home.html:50-54`), a persistent stats pill repeats it after every turn (`home.html:101-106`), the hero eyebrow says "streaming pipeline online" (`hero.html:9`), and a cost/token meter floats over every screen at all times (`app.html:25-27`).
**Why it matters:** Premium SaaS hides the plumbing. Users don't want to see "signed parts" or a token counter they can't act on; it creates cognitive load and a "beta instrument panel" vibe that erodes trust and perceived quality. Cost anxiety on an idle screen actively discourages engagement.
**Fix:** Gate all telemetry behind the observability drawer (which already exists and is excellent). Replace inline "chunks/parts/signed" with a human status ("Planning your trip…", "Booking…"). Hide the cost pill until spend > $0 (or make it opt-in in Settings), and relabel it in plain terms. Rewrite the hero eyebrow to a benefit ("Plan a trip in one message").
**Effort:** Quick win (copy + a few `@if` guards).

### P0-2 — No design-token system for spacing, radius, and type

**What:** The theme sets Material color/typography tokens (`styles.scss:12-21`) but there is **no spacing scale, no radius scale, and no type ramp.** Values are hand-typed everywhere: radii span `6, 8, 10, 12, 14, 16, 18, 20, 24px` across components; font sizes include `10.5px, 11px, 11.5px, 12.5px, 13.5px, 0.6875rem, 0.8125rem, 15px` mixing px and rem; gaps are ad-hoc (`0.4rem, 0.55rem, 0.65rem, 0.75rem, 0.85rem, 0.9rem, 1.25rem`).
**Why it matters:** This is the root cause of most inconsistency below. Without tokens, every screen drifts, dark-mode tuning can't be centralized, and "make it feel cohesive" becomes a whack-a-mole across 59 files. It's the difference between "designed" and "assembled."
**Fix:** Introduce CSS custom properties: `--space-1..8` (4px base), `--radius-sm/md/lg/xl` (e.g. 8/12/16/24), and a type ramp (`--text-xs..2xl` with consistent line-heights). Refactor components to consume them. Pick **one unit** (rem) for type.
**Effort:** Larger overhaul (mechanical but broad).

### P0-3 — Hardcoded hex colors instead of tokens (light-theme + consistency risk)

**What:** Brand and data-viz colors are hardcoded, not theme-driven: the aurora background uses literal `#7c5cff`/`#13d0c9` (`styles.scss:59,64`); the hero/brand gradient uses `#7C5CFF/#3F8CFF/#13D0C9` (`hero.scss:40-46`, `header.html:6-8`); the cost meter's token bars are literal `#5cf6c9, #07c3e6, #9560fa, #c87bff, #ffae5c, #ff6ec7` (`cost-meter.scss:235-243`); the observability waterfall (`observability-drawer.scss:254-275`) and danger states (`#ff5c5c/#ff2a8d`) are hardcoded; the drawer backdrop is a literal `rgba(8,10,22,.55)` (`observability-drawer.scss:12`).
**Why it matters:** These colors were tuned for the dark aurora. In **light mode** (a first-class, shipped option) neon-on-white gradients and a near-black backdrop can look garish or wrong, and the "system" theme path doesn't retune `--app-shadow-color` at all (`styles.scss:23` stays put). It also means the palette can't be rebranded from one place.
**Fix:** Promote brand hues to `--brand-1/2/3` tokens with light/dark variants; derive data-viz colors from tokens or define an explicit, theme-aware chart palette; use `color-mix` over `--mat-sys-*` for overlays/backdrops. Verify every hardcoded-color surface in light mode.
**Effort:** Medium overhaul.

### P1-4 — Touch targets below the 44×44 minimum

**What:** Interactive controls are small: send button 38px, dropping to **34px on mobile** (`prompt-composer.scss:141-143, 362-366`); attach/mic buttons 30px (`:292-300`); attachment remove 22px (`:252-254`); waterfall rows and cost-pill segments are dense.
**Why it matters:** WCAG 2.5.5/2.5.8 and every mobile HIG want ~44px. The send button is _the_ primary action and it's smallest on the device where fingers are biggest. This reads as "web app squeezed onto mobile," not "mobile-considered product," and causes real mis-taps.
**Fix:** Enforce a 44px min hit area (padding or invisible tap area) for all icon buttons; bump the mobile send button up, not down.
**Effort:** Quick win.

### P1-5 — Gradient-clipped text likely fails contrast and overuses a trend

**What:** Several key labels are gradient text with `color: transparent`: cost panel headline (`cost-meter.scss:147-153`), observability drawer title (`observability-drawer.scss:69-76`), hero accent (`hero.scss:39-52`).
**Why it matters:** Gradient text has no single measurable contrast ratio and the light end of these gradients (e.g. cyan `#13D0C9`) on a light surface commonly falls under 4.5:1 — a WCAG 1.4.3 failure. It's also becoming a dated "2021 AI startup" cliché when applied to functional labels rather than one hero moment.
**Fix:** Reserve gradient text for the single hero headline. Render functional titles ("Live LLM cost", "Observability") in solid `--mat-sys-on-surface`. If keeping a gradient, add a solid-color fallback and verify contrast at both gradient ends in both themes.
**Effort:** Quick win.

### P1-6 — Incomplete `prefers-reduced-motion` coverage on high-motion UI

**What:** Coverage is partial. Guarded: hero orbs, composer, brand mark, pulse-dot (`styles.scss:327`). **Unguarded:** the cost meter's `pill-pulse`/`danger-pulse`/`panel-in` (no reduced-motion block in `cost-meter.scss` at all), the observability drawer's `error-pulse` (`observability-drawer.scss:278`), and the home "thinking" equalizer bars (`home.scss:53`).
**Why it matters:** WCAG 2.3.3. Infinite pulsing/oscillating elements are exactly what motion-sensitive and vestibular users need stopped. Partial coverage is arguably worse than none because it looks handled but isn't.
**Fix:** Add a global `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; } }` safety net, then keep the targeted rules for nuance.
**Effort:** Quick win.

### P1-7 — Layout is desktop-first and boxed; no strong content rhythm

**What:** Everything lives in a centered max-width column (1200 app / 980 library / 880 settings / 600 onboarding). Breakpoints are ad-hoc and inconsistent across files: `480, 520, 560, 600, 620, 640, 720, 760, 920px`. There's no shared breakpoint system.
**Why it matters:** Inconsistent breakpoints mean components reflow at different widths, producing awkward "in-between" states on tablets. The uniformly boxed layout is safe but flat — there's little use of full-bleed sections, asymmetry, or scale changes to create hierarchy and drama.
**Fix:** Define 3–4 canonical breakpoints as tokens/mixins and refactor to them. Let the hero (and maybe the observability drawer) break the column for a more intentional rhythm.
**Effort:** Medium.

### P1-8 — `theme-color` and system-mode shadows are wrong in light theme

**What:** `<meta name="theme-color" content="#0b0d12">` is hardcoded dark in both index files (`index.html:13`, `index.prod.html:45`). In "system" theme, `--app-shadow-color` never updates because the retune only happens on explicit `.theme-light/.theme-dark` classes (`styles.scss:26-34`).
**Why it matters:** On mobile, a light-themed app with a black browser chrome bar looks broken/unfinished. System-mode users on a dark OS get mistuned shadows. These are the small tells that separate "shipped" from "demo."
**Fix:** Update `theme-color` dynamically from `ThemeService`; make the system path resolve to a concrete light/dark class (or set shadow tokens off `color-scheme`).
**Effort:** Quick win.

### P1-9 — Two divergent status/badge vocabularies

**What:** Global tool status chips use `--mat-sys-*-container` tokens (`styles.scss:188-220`), but there's an odd double-definition where `.tool-status.pending` is set to _tertiary-container_ at 200-203 and then re-declared to _secondary-container_ at 266-269 (and `.rejected` twice). Meanwhile the observability drawer invents its own kind chips (`.detail-kind.kind-round/kind-tool`, `observability-drawer.scss:322-341`) and cost meter invents its own metric styling. Same concepts, three visual languages.
**Why it matters:** Component inconsistency across screens is a top signal of "assembled by area, not designed as a system." The duplicate/overridden `.tool-status` rules are also a latent bug (specificity roulette).
**Fix:** One badge/chip component + token set reused everywhere. Delete the duplicate `.tool-status` blocks.
**Effort:** Quick win (dedupe) + Medium (unify chips).

### P2-10 — Maintainability smells that will cause future drift

**What:** Duplicated keyframes across files (`grad-shift` in hero/page-header/onboarding-hero; `response-in` in home + user-turn; `pulse-dot`/`.eyebrow` re-declared in onboarding-hero); two different skeleton shimmer systems; `::ng-deep` in `thought.scss`.
**Why it matters:** Not user-visible today, but guarantees the visual language keeps diverging as the app grows. Compounds P0-2/P0-3.
**Fix:** Centralize keyframes and shared classes; single shimmer mixin (already exists — `_mixins.scss:14`).
**Effort:** Quick win.

### P2-11 — Micro-typography and density inconsistencies

**What:** Fractional font sizes (`13.5px`, `11.5px`, `12.5px`, `10.5px`) and heavy reliance on `--mat-sys-on-surface-variant` at 11–12px for a lot of secondary text. Mono is used liberally for labels/metrics — characterful, but at 10.5–11px it's small.
**Why it matters:** Fractional px sizes betray "eyeballed" rather than "scaled" type. Tiny mono secondary text pushes contrast/readability limits, especially for low-vision users.
**Fix:** Adopt the type ramp from P0-2; set a 12px floor for body-adjacent text; reserve mono for genuinely tabular data.
**Effort:** Follows P0-2.

---

## 3. Category-by-category assessment

### Visual quality & first impression

Strong in dark mode; boxed and telemetry-heavy in framing. Materials (glass, gradients, orbs) are current and well-executed. The lack of a full-bleed moment and the always-on instrumentation cap the ceiling. **Above-average, not premium.**

### Design consistency

The weakest dimension. Color is split between Material tokens (good) and hardcoded neon (risky); spacing/radius/type are un-tokenized; three badge vocabularies; duplicated rules. Iconography is the bright spot — Material Symbols Outlined everywhere via `MAT_ICON_DEFAULT_OPTIONS` (`app.config.ts:52-55`) is genuinely consistent. **Cohesive within a screen, drifting across screens.**

### Layout hierarchy & information architecture

IA is sensible: Chat / Library / Tools / Guide / About / Security in the nav; Settings tucked behind a gear (reasonable). Hierarchy _within_ the streaming view is good (user turn → thought → tools → response). But the boxed column and flat spacing rhythm mean pages rely on cards-in-a-stack rather than deliberate hierarchy. Onboarding IA is excellent. **Solid, unspectacular.**

### Component consistency across screens

Mixed. Tool cards share the global `.tool-*` vocabulary (good). But cost meter, observability drawer, and settings cards each reinvent metrics/badges/section headers. A shared primitive set (Card, SectionHeader, Metric, Badge, Bar) is missing. **Needs a component system pass.**

### Modern design patterns — current or outdated?

Mostly current: glassmorphism, `@defer`, view transitions, signals-driven reactivity, skeletons, command-bar-style composer. Two dated tells: **gradient text on functional labels** and **neon-on-dark data viz** that doesn't adapt to light. Overall **feels 2024–2025, not stale** — but trend-chasing in spots.

### Branding, personality & visual identity

Has a real identity: the "A" chevron mark (`header.html:3-15`), violet→cyan aurora, mono accents, "Atlas" naming. That's more personality than most MVPs. The problem is the identity is **inconsistently applied** (hardcoded vs token) and the **voice is engineer, not brand.** Distinctive but not yet disciplined.

### Responsiveness (mobile & desktop)

Desktop is polished. Mobile is _handled_ but not _designed_: nav collapses to a hamburger below 720px, cost meter re-docks below the header on phones (`cost-meter.scss:453-471`, a nice touch), safe-area insets respected. Undermined by sub-44px targets and ad-hoc breakpoints causing awkward tablet widths. **Adaptive, not mobile-first.**

### Accessibility

Genuine effort — global `:focus-visible` ring with a documented rationale for keeping it on native buttons (`styles.scss:133-151`), extensive `aria-*`/`role`/`aria-live`, `aria-modal` + focus trap on the cost panel (`cost-meter.html:24-32`). But: small touch targets, gradient-text contrast risk, partial reduced-motion, tiny mono text, and success states that rely on `.theme-dark` class overrides rather than `color-scheme` (won't apply in system-dark). **Better than typical, still short of AA-clean.**

### States (empty / loading / error / success)

The standout strength. Skeleton loaders (`flight-options-card.html:52-65`), a live thinking indicator, per-tool error fallbacks with retry, four distinct HITL card states, distinct error/cancelled/budget banners (`home.html:70-99`), rich empty states (Library, observability drawer), and multi-state save button (`home.html:118-135`). This is production-grade thinking. **Excellent.**

### Micro-interactions & perceived quality

Lots of care: button lift on hover, brand-mark spring rotation, staggered card entrances (`--i` delays), composer focus ring + streaming shimmer, gradient send button. Perceived quality is high _while interacting_. The risk is over-animation (multiple infinite pulses on screen at once) and the reduced-motion gaps. **Delightful, slightly overdone.**

---

## 4. Quick wins vs. larger overhauls

| Quick wins (hours–days, high ROI)                                        | Larger overhauls (days–weeks)                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Hide/relabel telemetry & idle cost pill (P0-1)                           | Introduce spacing/radius/type token system (P0-2)                        |
| Global reduced-motion safety net (P1-6)                                  | Migrate hardcoded hex → brand/chart tokens; verify light mode (P0-3)     |
| Enforce 44px touch targets; bigger mobile send (P1-4)                    | Unify badge/metric/section primitives into a component set (P1-9)        |
| Solidify gradient-text labels; keep one hero gradient (P1-5)             | Canonical breakpoint system + intentional full-bleed layout (P1-7)       |
| Dynamic `theme-color`; fix system-mode shadows (P1-8)                    | Rewrite product voice/copy across hero, guide, empty states (P0-1 depth) |
| Delete duplicate `.tool-status` rules; centralize keyframes (P1-9/P2-10) | Full light-theme design QA pass                                          |

---

## 5. Comparison to modern SaaS & production-readiness

Against best-in-class AI/dev SaaS (Linear, Vercel, Stripe, Raycast, ChatGPT/Claude web):

- **Motion & materials:** competitive with the pack in dark mode.
- **States & feedback:** at or above the bar — genuinely better than many shipped products.
- **Design-system discipline:** clearly below. Linear/Stripe run on rigid token systems; Atlas runs on magic numbers.
- **Product voice & restraint:** below. The best products hide cost/telemetry and speak to outcomes; Atlas leads with instrumentation.
- **Light mode & responsiveness parity:** below — light mode is under-QA'd and mobile is adapted rather than designed.

**Is it production-ready?** As a **developer-facing demo or internal tool: yes, comfortably.** As a **commercial consumer/prosumer SaaS: not yet.** It would ship as "impressive beta." The gap is closable mostly with quick wins plus one tokenization overhaul — this is a matter of discipline and restraint, not a rebuild.

---

## 6. Scores (out of 10)

| Dimension                  |  Score  | One-line justification                                                                                           |
| -------------------------- | :-----: | ---------------------------------------------------------------------------------------------------------------- |
| **Visual Design**          | **7.0** | Confident, modern dark-mode aesthetic; boxed layout, gradient overuse, and un-QA'd light mode cap it.            |
| **User Experience**        | **6.5** | Best-in-class states and a delightful streaming flow, undercut by exposed telemetry and engineer-facing framing. |
| **Consistency**            | **5.5** | Great iconography; but no tokens, hardcoded colors, duplicated rules, and 3 badge vocabularies.                  |
| **Accessibility**          | **5.5** | Strong focus/ARIA foundation; fails on touch targets, gradient-text contrast, partial reduced-motion.            |
| **Overall Product Polish** | **6.5** | Reads as a high-end MVP / impressive internal tool, not a shipped premium product.                               |

**Weighted overall: ~6.2/10** — "strong MVP, one disciplined pass away from a real tier jump."

---

## 7. Candid assessment

**Would users trust this product based on its design?**
Developers and prosumers: yes — the polish and especially the transparency (observability, budgets, security page) build trust with a technical audience. Mainstream users: partially — an idle cost counter and "signed parts" telemetry read as "unfinished lab tool" and can _reduce_ trust for non-technical users who don't understand what they're seeing.

**Does it feel premium or like an MVP?**
Premium _in flashes_ (streaming, onboarding, micro-interactions), MVP _in the seams_ (magic-number spacing, hardcoded colors, tiny targets, exposed internals, light-mode risk). Overall: **a very good MVP that occasionally looks premium**, not a premium product with a few rough edges.

**What would prevent it from being featured as a high-quality product?**

1. Developer-facing copy/telemetry bleeding into the primary UX.
2. Visible inconsistency (spacing/radius/color drift) under any scrutiny.
3. Light mode not being held to the same bar as dark.
4. Accessibility gaps a reviewer would catch in minutes (targets, contrast, motion).

**What specific changes would elevate it to a world-class experience?**

1. **Adopt a token system** (space/radius/type/color) and refactor to it — this alone removes most inconsistency.
2. **Hide the machinery.** Move telemetry into the (already great) observability drawer; make the cost meter opt-in and value-first; rewrite copy toward user outcomes.
3. **Give light mode a real design pass** and tokenize every hardcoded color so both themes are first-class.
4. **Close the a11y gaps** (44px targets, solid/contrast-safe text, complete reduced-motion).
5. **Introduce one intentional full-bleed hero moment** and a canonical responsive grid so the layout feels composed, not boxed.
6. **Consolidate components** (Card/Badge/Metric/SectionHeader/Bar) so every screen speaks one visual language.

Do #1–#4 (mostly quick wins) and Atlas moves from ~6.2 to ~8/10 — genuinely featurable. Add #5–#6 for world-class.

---

## 8. Preferred implementation sequence

Ordered into **independently shippable phases** — each leaves the app fully working and maps to **one commit**. Sequencing logic: land low-risk, high-trust **quick wins first** (fast, visible ROI), then lay the **token foundation**, then do the **overhauls that depend on it**, and finish with **polish**.

**Ground rules for every phase**

- The app must build and pass tests at the end of each phase: `npm test -- --watch=false` (expected: all specs green) + `npm run build`.
- Manually verify in **light, dark, and system themes** and with **`prefers-reduced-motion` on** before committing (especially theme/motion phases).
- Keep phases scoped — don't smuggle later-phase work into an earlier commit.
- These are AI-assisted changes, so per repo convention each commit message carries the `Includes-AI-Code: true` trailer.

### Sequence at a glance

| Phase |   Status    | Theme                                   | Issues                           | Type      |   Risk   | Suggested commit                                                                   |
| :---: | :---------: | --------------------------------------- | -------------------------------- | --------- | :------: | ---------------------------------------------------------------------------------- |
|   1   | ✅ **Done** | Accessibility & motion safety net       | P1-4, P1-6                       | Quick win |   Low    | `fix(a11y): reduced-motion safety net + 44px touch targets`                        |
|   2   | ✅ **Done** | Hide the machinery / product voice-lite | P0-1 (mechanical)                | Quick win |   Low    | `refactor(ux): move telemetry into observability drawer, lead with product voice`  |
|   3   | ✅ **Done** | Theme correctness & style cleanup       | P1-5, P1-8, P1-9 (dedupe), P2-10 | Quick win |   Low    | `fix(theme): sync theme-color, fix system shadows, solidify labels, dedupe styles` |
|   4   | ✅ **Done** | Design-token foundation                 | P0-2                             | Overhaul  |   Med    | `refactor(styles): introduce spacing/radius/type design tokens`                    |
|   5   | ⬜ Pending  | Color tokenization + light-mode pass    | P0-3                             | Overhaul  | Med-High | `refactor(theme): tokenize brand/chart colors + light-mode design pass`            |
|   6   | ⬜ Pending  | Component consolidation                 | P1-9 (full)                      | Overhaul  |   Med    | `refactor(ui): consolidate badge/metric/section/bar primitives`                    |
|   7   | ⬜ Pending  | Layout rhythm & responsive system       | P1-7                             | Overhaul  |   Med    | `refactor(layout): canonical breakpoints + intentional hero layout`                |
|   8   | ⬜ Pending  | Voice/copy + type-ramp application      | P0-1 (depth), P2-11              | Polish    |   Low    | `polish(content): outcome-focused copy + consistent type ramp`                     |

> Phases 1–3 are safe to ship on their own and already move the needle on trust/polish. If you only have time for one push, do 1–3. Phases 4–5 are the real "designed, not assembled" jump. 6–8 are elevation to world-class.

---

### Phase 1 — Accessibility & motion safety net — ✅ Done (2026-07-13)

**Goal:** Remove the accessibility gaps a reviewer catches in minutes. No visual redesign.
**Addresses:** P1-6 (reduced-motion), P1-4 (touch targets).

> **Implemented (2026-07-13):**
>
> - Added a global `@media (prefers-reduced-motion: reduce)` safety net in `src/styles.scss` that neutralises animations/transitions app-wide (catches the previously-unguarded cost-meter pulses, observability waterfall `error-pulse`, and home "thinking" bars), while retaining the targeted `.pulse-dot` rule.
> - `prompt-composer.scss`: primary **send** button 38→**44px** (and removed the mobile shrink to 34px, so it stays 44px on phones); **attach/mic** buttons 30→**40px** with a transparent `::after` extending the tap area to **44px**; **attachment-remove** 22→**28px** with the same 44px `::after` tap expander. Composer-hints spacing keeps adjacent tap areas from overlapping.
> - Confirmed Angular Material icon buttons (header, cost-meter, observability drawer) already ship a 48px MDC touch target — no change needed.
> - **Validation:** `npm test -- --watch=false` → 619/619 passing; `npm run build` → clean, styles bundle 14.23 kB (within budget).
> - **Not committed** (per your workflow, you commit each phase).
>   **Scope:**

- Add a global reduced-motion safety net in `src/styles.scss` (`*, ::before, ::after { animation-duration:.001ms!important; animation-iteration-count:1!important; transition-duration:.001ms!important; }` inside the media query), keeping existing targeted rules.
- Enforce ≥44px hit area on icon buttons: `prompt-composer.scss` send (bump mobile **up**, not down), attach/mic (30px), attachment-remove (22px); audit cost-meter/header/observability icon buttons.
  **Acceptance:** With reduced-motion on, no infinite pulse/oscillation anywhere (verify cost-meter, observability drawer, home "thinking" bars). Every interactive control has a ≥44px tap target on mobile.
  **Validate:** Tests + build; DevTools device toolbar for target sizes; OS reduced-motion toggle.
  **Commit:**

```
fix(a11y): reduced-motion safety net and 44px touch targets

Includes-AI-Code: true
```

### Phase 2 — Hide the machinery / product voice-lite — ✅ Done (2026-07-13)

**Goal:** Stop the primary flow from reading like an instrument panel. Template/copy only.
**Addresses:** P0-1 (mechanical portion; deep copy rewrite is Phase 8).

> **Implemented (2026-07-13):**
>
> - Streaming indicator: replaced `Atlas is thinking… / chunks·parts·signed` with an agent-aware human status (`streamingStatus()` → "Planning your trip…" / "Curating experiences…") plus a reassuring subline (`home.ts`, `home.html`).
> - Removed the post-run `chunks · parts · signed` stats line from the home view entirely (`home.html`).
> - Relocated the raw stream telemetry into the observability drawer as a subtle "Stream · N chunks · N parts · N signed" caption (drawer now injects `AgentEventStore`; `observability-drawer.ts/.html/.scss`).
> - Floating cost pill is now gated behind a `visible()` computed — hidden until streaming or real spend exists, so a first-time user never sees a `$0.000` chip (`cost-meter.ts/.html`).
> - Hero eyebrow: "Live · streaming pipeline online" → "Live · AI that shows its work" (`hero.html`).
> - Updated two cost-meter specs to the new hidden-until-active contract.
> - **Validation:** `npm test` → 619/619 passing; `npm run build` → clean.
> - **Note:** Deep copy/voice rewrite (headline, subtitle, tone) is deliberately deferred to Phase 8.
>   **Scope:**

- Remove inline `chunks/parts/signed` from the default view (`home.html:50-54, 101-106`); replace the streaming indicator with human status text ("Planning your trip…"). Keep the raw stats available inside the observability drawer only.
- Hide the floating cost pill until `turnCost > 0` (or add a Settings toggle) — `app.html` / `cost-meter`.
- Rewrite the hero eyebrow from "streaming pipeline online" to a benefit-led line (`hero.html:9`).
  **Acceptance:** A first-time user sees no dev telemetry and no `$0.000` pill before acting; the drawer still shows full stats.
  **Validate:** Manual walkthrough of idle → send → complete; confirm observability drawer still has the numbers.
  **Commit:**

```
refactor(ux): move telemetry into observability drawer and lead with product voice

Includes-AI-Code: true
```

### Phase 3 — Theme correctness & style cleanup — ✅ Done (2026-07-13)

**Goal:** Fix small correctness tells and delete latent style bugs. Low risk, no new system yet.
**Addresses:** P1-8 (theme-color/system shadows), P1-5 (gradient text), P1-9 dedupe, P2-10 (keyframes).

> **Implemented (2026-07-13):**
>
> - `ThemeService` now resolves **system** preference to a concrete `theme-light`/`theme-dark` class (via `resolvedTheme()`), so `--app-shadow-color` (and `color-scheme`) retune correctly under system mode instead of stranding the `:root` default (`theme.service.ts`).
> - `<meta name="theme-color">` is now driven from `ThemeService` — it reads the resolved body surface colour and updates on every theme change, so the mobile chrome bar matches light/dark instead of a hardcoded `#0b0d12`.
> - Converted gradient-clipped **functional** labels to solid `--mat-sys-on-surface`: cost-meter `.panel-cost` and observability-drawer `.title`. Display headlines (main hero, onboarding hero, page-header titles) keep the brand gradient — gradient text is now reserved for hero/title moments, not data.
> - Deleted the duplicate/overriding `.tool-status.rejected`/`.tool-status.pending` blocks in `styles.scss`; the status pills now render from a single source, and **pending** is once again visually distinct from **running** (the stray override had made them identical).
> - Centralised shared keyframes (`grad-shift`, `response-in`) into `styles.scss` and removed the duplicate copies from `hero.scss`, `onboarding-hero.scss`, `page-header.scss`, `home.scss`, `user-turn.scss`. Removed the re-declared `.eyebrow`/`.pulse-dot` (+ duplicate `pulse-dot` keyframe) from `onboarding-hero.scss`, which now inherits the global versions.
> - **Validation:** `npm test` → 619/619 passing; `npm run build` → clean; theme spec unaffected.
> - **Note:** `index*.html` keeps `#0b0d12` as the pre-JS fallback (dark-first loading); ThemeService corrects it on init. Broad hex→token color work is Phase 5.
>   **Scope:**

- Drive `<meta name="theme-color">` from `ThemeService`; make system mode resolve to a concrete light/dark class so `--app-shadow-color` retunes (`index*.html`, `theme.service.ts`, `styles.scss:26-34`).
- Convert gradient-clipped **functional** labels to solid contrast-safe color (`cost-meter.scss:147-153`, `observability-drawer.scss:69-76`); keep exactly one hero gradient.
- Delete duplicate/overridden `.tool-status` blocks (`styles.scss:200-220` vs `261-269`).
- Centralize duplicated keyframes (`grad-shift`, `response-in`, `pulse-dot`) and the re-declared `.eyebrow` in onboarding-hero.
  **Acceptance:** Light-themed mobile shows a light browser chrome bar; no `color: transparent` on functional labels; single source for shared keyframes; `.tool-status` states render deterministically.
  **Validate:** Tests + build; check mobile chrome color in light/dark; contrast-check the delabeled titles.
  **Commit:**

```
fix(theme): sync theme-color, fix system shadows, solidify functional labels, dedupe styles

Includes-AI-Code: true
```

### Phase 4 — Design-token foundation — ✅ Done (2026-07-13)

**Goal:** Introduce the token system. **Intentionally visually neutral** — this commit should not change the look.
**Addresses:** P0-2.

> **Implemented (2026-07-13):**
>
> - Added `src/styles/_tokens.scss` (documented at the top): spacing `--space-1..8` (4px base), radius `--radius-sm/md/lg/xl` (8/12/16/24), a rem-based type ramp `--text-xs..2xl`, and `--leading-tight/snug/normal/relaxed`. Wired globally via `@use './styles/tokens'` in `styles.scss` (verified emitted into `:root` in the compiled CSS).
> - Pilot-adopted the tokens in `app.scss`, `home.scss`, `hero.scss`, and `_mixins.scss` — **only where the token value is an exact equivalent** of the literal it replaced (e.g. `1.5rem→var(--space-5)`, `16px→var(--radius-lg)`, `14px→var(--text-sm)`, `1.6→var(--leading-relaxed)`).
> - **Neutrality:** guaranteed by exact-value equivalence rather than screenshots (no live render here). Token values were confirmed identical to the replaced literals; at the default 16px root the rem type tokens equal the prior px values. (At a non-default browser font size the rem tokens will scale — the intended accessibility win, not a regression.)
> - **Validation:** `npm run build` → clean + tokens present in `:root`; `npm test` → 619/619 passing.
> - **Note:** Colour tokens are deliberately excluded here — brand/chart hex→token work + light-mode pass is Phase 5.
>   **Scope:**

- Add `src/styles/_tokens.scss`: `--space-1..8` (4px base), `--radius-sm/md/lg/xl` (8/12/16/24), a type ramp (`--text-xs..2xl` + line-heights). Standardize on **rem** for type.
- Pilot-adopt tokens in a small, representative set (`app.scss`, `home.scss`, `hero.scss`, `_mixins.scss`) to prove them and set conventions.
- Document the tokens briefly (top of `_tokens.scss` or a short note in the README/style guide).
  **Acceptance:** Tokens defined + documented; pilot components consume them; **no visible diff** vs Phase 3.
  **Validate:** Side-by-side screenshots before/after on pilot screens to confirm no regression; tests + build.
  **Commit:**

```
refactor(styles): introduce spacing/radius/type design tokens

Includes-AI-Code: true
```

### Phase 5 — Color tokenization + light-mode pass — ✅ Done (2026-07-13)

**Goal:** Make both themes first-class; kill hardcoded hex. Highest theme-fidelity payoff.
**Addresses:** P0-3.

> **Implemented (2026-07-13):**
>
> - Added a colour layer to `src/styles/_tokens.scss`: brand hues `--brand-1/2/3` (violet/teal/blue), a data-viz palette `--viz-input/-end`, `--viz-output/-end`, `--viz-thinking/-end`, `--viz-danger/-end` (start→end gradient stops), and agent-accent tokens `--accent-curator-1/2`. Base (`:root`) values **equal the previously-hardcoded hexes**, so dark mode is byte-identical.
> - **Light-mode pass:** added an `html.theme-light` override that deepens the palest data-viz series (`--viz-input`/`--viz-input-end` mint→cyan) so legend dots/bars stay legible on a light surface; brand hues and mid-tone series read fine on both themes and are shared. (Values flagged in-file for visual fine-tuning.)
> - **Replaced raw hex with tokens across the app:** `styles.scss` (aurora), `hero.scss` (gradient + orbs), `header.html` (logo SVG gradient stops via CSP-safe inline `style`), `cost-meter.scss` + `observability-drawer.scss` (all data-viz bars/dots/danger), and brand hues in `guide/deep-dive-card/guide-step-card/storage-state-card/settings-card/about/security/tools/page-header/onboarding-hero`. Curator agent-accent hex in `activity-list.scss` → `--accent-curator-*`.
> - **Validation:** `npm run build` → clean; tokens confirmed emitted (`--brand-1`, `--viz-*`, `--accent-curator-1` in `:root`, plus the `html.theme-light` `--viz-input` override) in the compiled CSS. `npm test` → 619/619 passing.
> - **Scoped out (intentional):** _semantic_ status/categorical colours are **not** brand/chart and remain literals for a separate pass — success greens (`security`, `api-key-status-card`, `status-banner`), passphrase-strength levels, itinerary-map marker categories + `#fff` marker borders, and the `#000` dialog scrim. The `tools.scss` tertiary **fallback** was mapped to `var(--viz-output)` (identical value).
> - **⚠ Light-mode QA is still yours to eyeball:** no live render here. Do a click-through in light/dark/system and confirm the deepened `--viz-input` pair + all tokenized surfaces read well; tell me if any hue needs nudging.
>   **Scope:**

- Promote brand hues to `--brand-1/2/3` with light/dark values; define a theme-aware chart palette for token/waterfall visualizations.
- Replace raw hex in `styles.scss` (aurora), `hero.scss`, `header` SVG, `cost-meter.scss` (token bars/danger), `observability-drawer.scss` (backdrop/waterfall), agent accents.
- Full light-theme QA of every surface touched here + Phases 1–4.
  **Acceptance:** No raw hex in component SCSS except the brand/chart token definitions; light, dark, and system all look intentional.
  **Validate:** Full click-through in all three themes; contrast-check data-viz legends in light mode.
  **Commit:**

```
refactor(theme): tokenize brand and chart colors; light-mode design pass

Includes-AI-Code: true
```

### Phase 6 — Component consolidation — ✅ Done (2026-07-13)

**Goal:** One visual language for repeated concepts across screens.
**Addresses:** P1-9 (full).

> **Implemented (2026-07-13) — "light harmonization" (user-chosen scope):**
> - Extracted three shared presentational primitives under `src/app/shared/ui/`:
>   - `app-metric` — label + value stat. Inputs: `label`, `value`, `icon`, `size` (sm/md/lg), `appearance` (plain/tile), `bordered`, `tone` (default/ok), `mono`, `full`.
>   - `app-section-head` — uppercase subsection label with optional `meta` string and a projected trailing action (link/button/hint).
>   - `app-meter` — determinate track+fill (0..1, clamped) with `warn`/`danger` state tints; decorative (`aria-hidden`).
>   - Each ships a spec (`+8` tests → 627 total).
> - **Migrated consumers:** cost-meter (3 metrics, all 4 section headers, context + 3 budget bars), observability drawer (4 summary metrics, token-usage label), settings **api-key card** (2 status tiles → `app-metric` tile/bordered with icon + `ok` tone), and tool-card section labels (custom-tool ×2, propose-tool ×2). Removed the now-dead bespoke CSS from each.
> - **Harmonization:** unified trivial drift (metric label → 11px/600/0.07em uppercase; section label → 12px/600/0.06em) while keeping meaningful variants as inputs (value size sm/md/lg, mono vs sans, plain vs tile, `ok` tone). Added a `--status-success` token (dark `#5cd58a` / light `#1f8a4b`) so the api-key "ok" green is themed, removing the last hex from that card.
> - **Left intentionally on existing global CSS:** the status pill (`.tool-status`) and tool-card header (`.tool-header-row`) are already consolidated globally in `styles.scss` and shared across all 7 tool cards — no change needed. Bespoke, layout-coupled surfaces (waterfall header/bars, comparison overlay badge, agent-chip, detail-grid, `.preview-head`) were left as-is to avoid flattening intentional character.
> - **Validation:** `npm run build` clean (no `NG8113` unused-import warnings); `npm test` → 627/627 passing; lints clean.
> - **⚠ Visual QA is yours:** no live render here. The harmonized metric/section labels and the settings status tiles shift by a hair — click through the cost meter, observability drawer, and Settings → API key in light/dark and confirm; I can nudge any size/spacing.
> **Scope:**

- Extract shared primitives — `Badge/Chip`, `Metric`, `SectionHeader`, `Bar` — and refactor cost-meter, observability drawer, settings cards, and tool cards to use them (built on Phase 4/5 tokens).
  **Acceptance:** Cost meter, drawer, settings, and tool cards render badges/metrics/section headers from the same components; visual parity or improvement.
  **Validate:** Tests + build; visual regression on each consumer.
  **Commit:**

```
refactor(ui): consolidate badge/metric/section/bar primitives into shared components

Includes-AI-Code: true
```

### Phase 7 — Layout rhythm & responsive system

**Goal:** Composed, not boxed; consistent reflow.
**Addresses:** P1-7.
**Scope:**

- Define 3–4 canonical breakpoints as mixins/tokens; refactor scattered `480/520/560/600/620/640/720/760/920` queries to them.
- Introduce one intentional full-bleed hero moment; fix awkward tablet widths.
  **Acceptance:** Components reflow at shared breakpoints; hero reads as a landing moment; tablet range has no orphaned in-between layouts.
  **Validate:** Resize sweep 360→1440px; tests + build.
  **Commit:**

```
refactor(layout): canonical breakpoints and intentional hero layout

Includes-AI-Code: true
```

### Phase 8 — Voice/copy + type-ramp application

**Goal:** Final elevation — outcome-focused language and disciplined type.
**Addresses:** P0-1 (depth), P2-11.
**Scope:**

- Rewrite copy toward user outcomes across guide content, sample prompts, empty states, onboarding.
- Apply the type ramp app-wide; set a 12px floor for body-adjacent text; reserve mono for genuinely tabular data.
  **Acceptance:** No engineer-facing jargon in default UX; type sizes all come from the ramp; no fractional-px font sizes remain.
  **Validate:** Content review pass; tests + build.
  **Commit:**

```
polish(content): outcome-focused copy and consistent type ramp

Includes-AI-Code: true
```

---

## Appendix — key evidence (file:line)

- Theme tokens & missing scales: `src/styles.scss:12-24`; shadow only retuned on explicit classes `:26-34`.
- Hardcoded brand/data colors: `src/styles.scss:59,64`; `hero.scss:40-46`; `header.html:6-8`; `cost-meter.scss:235-243, 334-336`; `observability-drawer.scss:12, 254-275`.
- Telemetry in primary UX: `home.html:50-54, 101-106`; hero eyebrow `hero.html:9`; always-on pill `app.html:25-27` + `cost-meter.html:1-22`.
- Touch targets: `prompt-composer.scss:141-143, 292-300, 252-254, 362-366`.
- Gradient text: `cost-meter.scss:147-153`; `observability-drawer.scss:69-76`; `hero.scss:39-52`.
- Reduced-motion gaps: no block in `cost-meter.scss`; `observability-drawer.scss:278`; `home.scss:53`. (Present: `styles.scss:327`, `hero.scss:113`, `prompt-composer.scss:378`.)
- Duplicate/overridden status rules: `styles.scss:200-220` vs `261-269`.
- `theme-color` hardcoded: `index.html:13`, `index.prod.html:45`.
- Strong states (credit where due): `flight-options-card.html:34-112`; `home.html:70-157`; `observability-drawer.scss:84-114`.
- A11y foundation (credit): `styles.scss:133-151`; `cost-meter.html:24-32`.
