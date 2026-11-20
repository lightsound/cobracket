import { isDev, isServer } from "@solidjs/web";
import { attribution } from "solid-js/attribution";
import { exposeScopeWidths } from "./scope-widths";

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

/** @public */
export function initDevDiagnostics(): void {
  if (!isDev || isServer) return;

  if (import.meta.env.VITEST) return;
  // What that gate does need from the page is the scope-width recorder: the
  // count it judges is in the engine's records and in no artifact, and
  // `page.evaluate` cannot reach the app's own copy of Solid
  // (`src/scope-widths.ts`).
  if (import.meta.env.MODE === "e2e") {
    exposeScopeWidths();
    return;
  }

  attribution.enable({ log: false });
}
