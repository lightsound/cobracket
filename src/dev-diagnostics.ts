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

  // `log: false` because the default prints a why-chain for *every* re-run,
  // which buries the coded findings we actually want. The findings are a
  // separate channel and still report; the per-run trace is available on
  // demand from the browser console via `attribution.costs()` /
  // `attribution.feedback()` / `attribution.why(source)`.
  attribution.enable({ log: false });
}
