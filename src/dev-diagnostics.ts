import { isDev, isServer } from "@solidjs/web";
import { attribution } from "solid-js/attribution";

// Solid's reactivity diagnostics come in two tiers, both dev-build only.
//
// The always-on tier needs no wiring: misplaced reads
// ([STRICT_READ_UNTRACKED]), misplaced writes
// ([REACTIVE_WRITE_IN_OWNED_SCOPE], [FLUSH_IN_ACTION]) and async reads with no
// boundary above them already report themselves in `bun dev`.
//
// The cost and responsiveness tier is opt-in, and this is the opt-in. It is
// what reports [SILENT_HOLD], [UNSTABLE_LIST_IDENTITY],
// [IMMUTABLE_UPDATE_IN_STORE], [ASYNC_WATERFALL], [EFFECT_RELAY_TEAR] and
// [UNSTABLE_MEMO_OUTPUT] — in other words, the runtime evidence for several of
// the Solid 2 hard rules this project already commits to in CLAUDE.md. Without
// it those rules are only ever checked by eye and by `solid2-kit check`, which
// sees tokens rather than behavior.
//
// Every code maps to a documented repair in
// node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md; the first
// console report of each code links there. Never silence a code before
// understanding it — each one is a real defect or a real cost.

/**
 * Turn on Solid's attribution engine in development.
 *
 * Called from `App` rather than at module scope so the wiring is as visible as
 * `initAuth()` next to it. In production this is stripped: `isDev` is a build
 * constant, and `solid-js/attribution` resolves to a ~640-byte no-op twin
 * anyway, so nothing measures and nothing reports.
 *
 * @public
 */
export function initDevDiagnostics(): void {
  if (!isDev || isServer) return;

  // Not under vitest, where the diagnostics gate (`src/test-setup.ts`) has
  // already enabled the engine around the test body and is the one asking it
  // questions. `enable()` is a hold on the one engine every consumer in the
  // page shares (engine 2.0.0-rc.10 on; it returns the release for that
  // hold), and a hold taken while the engine is already on opens a fresh
  // window over the ring buffers and the fold tables — `history(type)`,
  // `costs()`, `feedback()` read from that moment on. So a test that renders
  // `App` — which calls this — would push the hold records the gate's second
  // assertion reads out of its window, for that test only.
  // `dev-diagnostics.test.tsx` proves it: a silent hold recorded before this
  // call survives it, and stops surviving the moment the guard goes.
  //
  // `isDev` is true under vitest (the test build is the dev build — that is
  // what makes the gate possible at all), so it cannot stand in for this.
  // vitest sets the string "true", hence a truthiness check.
  //
  // The browser gate (`e2e/`, served in `--mode e2e`) owns the engine the
  // same way, through the bridge its capture begins, and has the same claim
  // on it: holds combine by the most demanding request per key, so a
  // threshold the gate turns off stays armed while this hold stands beside
  // it — measured: the gate's `fallbackFlashes: false` reported six
  // `[FALLBACK_FLASH]` findings until this hold stood down.
  if (import.meta.env.VITEST || import.meta.env.MODE === "e2e") return;

  // `log: false` because the default prints a why-chain for *every* re-run,
  // which buries the coded findings we actually want. The findings are a
  // separate channel and still report; the per-run trace is available on
  // demand from the browser console via the named exports `costs()` /
  // `feedback()` / `why(source)` from `solid-js/attribution`.
  //
  // Under `bun dev` this is the second hold, not the first: since
  // @solidjs/vite-plugin 3.0.0-next.47 the dev server injects
  // `@solidjs/web/performance-tracks` ahead of the app entry
  // (`performanceTracks`, on by default), and that adapter takes its own
  // hold with the same `log: false`. Options combine by the most demanding
  // request per key, so the two agree, and this hold is what keeps the
  // engine on for the console if that plugin default is ever turned off.
  // The release is dropped on purpose: the hold lasts as long as the page.
  attribution.enable({ log: false });
}
