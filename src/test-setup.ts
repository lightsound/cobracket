/**
 * Turns every Solid diagnostic into a test failure.
 *
 * Solid fixes each diagnostic's severity itself (`info` / `warn` / `error`)
 * and offers no switch to escalate them, so "treat them as errors" cannot be
 * an application setting — the supported place to enforce it is a test. This
 * file is that enforcement, wired as `setupFiles` for the `src` project so it
 * applies to every test under `src/` without any per-test ceremony: a test
 * written by someone who has never heard of the attribution engine is gated
 * anyway.
 *
 * The whole test body runs inside one `captureArtifact` scenario, with
 * attribution enabled — that is what produces the attribution-tier codes
 * (`SILENT_HOLD`, `UNSTABLE_LIST_IDENTITY`, `IMMUTABLE_UPDATE_IN_STORE`,
 * `ASYNC_WATERFALL`, ...) in the first place; they reach the same diagnostics
 * channel as the core ones, so a single `expectNoDiagnostics` covers all 36
 * codes.
 *
 * Note the environment matters as much as the gate: under `environment: node`
 * the `node` export condition resolves Solid's *server* build, where writes
 * are inert (`[SERVER_WRITE]`), effects never run and the attribution tables
 * stay empty — a green test proving nothing. The `src` project runs on
 * happy-dom for that reason, not because every test touches the DOM.
 */
import { afterEach, beforeEach } from "vite-plus/test";
import {
  captureArtifact,
  type CaptureResult,
  type DiagnosticCode,
  type DiagnosticsArtifact,
  expectDiagnostic,
  expectNoDiagnostics,
  expectNoSilentHolds,
} from "@solidjs/diagnostics";

/**
 * `captureArtifact` is scenario-shaped (it runs a function), but a global gate
 * has to span `beforeEach` → test body → `afterEach`. Holding the scenario
 * open on a promise the teardown resolves is how one becomes the other, and
 * keeps this on the package's public API instead of driving the underlying
 * `OBSERVE.diagnostics` channel by hand.
 */
let endScenario: (() => void) | undefined;
let capture: Promise<CaptureResult<void>> | undefined;
let expected: DiagnosticCode[] = [];
let expectedSilentHold = false;

/**
 * Declare that the current test's subject *is* a diagnostic: each code must be
 * reported, and reporting it is not a failure. Required, not merely tolerated —
 * a test that stops provoking the code it was written to provoke fails, so this
 * cannot decay into a silent mute.
 *
 * Only for the gate's own proofs, which render deliberately broken components.
 * Never reach for it to quiet a finding about real code: every code maps to a
 * repair in `node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md`.
 *
 * @public
 */
export function expectDiagnostics(...codes: DiagnosticCode[]): void {
  expected.push(...codes);
}

/**
 * The same declaration for a silent hold, which has no code to name below the
 * engine's console threshold. Requires the current test to produce one, and
 * tolerates it.
 *
 * @public
 */
export function expectSilentHold(): void {
  expectedSilentHold = true;
}

/** How many holds the scenario left unacknowledged, at any duration. */
function silentHolds(artifact: DiagnosticsArtifact): number {
  return (artifact.attribution?.feedback.sources ?? []).reduce(
    (total, source) => total + source.silent,
    0,
  );
}

beforeEach(() => {
  // Both channels are process-global singletons, so two captures cannot be
  // told apart: with `test.concurrent` a diagnostic raised by one test lands
  // in whichever artifact happens to be open, failing the wrong test while
  // the culprit passes (measured, not assumed). Refuse the overlap rather
  // than misattribute it.
  if (capture !== undefined) {
    throw new Error(
      "The Solid diagnostics gate cannot separate overlapping tests: the " +
        "diagnostics channel and the attribution engine are process-global. " +
        "Run tests under src/ sequentially — no `test.concurrent`, no " +
        "`describe.concurrent`.",
    );
  }
  expected = [];
  expectedSilentHold = false;
  capture = captureArtifact<void>(
    () =>
      new Promise<void>((resolve) => {
        endScenario = resolve;
      }),
    { scenario: "test" },
  );
});

afterEach(async () => {
  endScenario?.();
  const pending = capture;
  endScenario = undefined;
  capture = undefined;
  if (!pending) return;
  // Always await, even on the failure path: the capture's `finally` is what
  // reads the attribution tables and disables the engine again. Leaving it
  // pending would leak the engine into the next test.
  const { artifact } = await pending;
  for (const code of expected) expectDiagnostic(artifact, code);
  expectNoDiagnostics(artifact, { allow: expected });
  if (expectedSilentHold) {
    if (silentHolds(artifact) === 0) {
      throw new Error(
        "expectSilentHold() was declared but the scenario acknowledged every hold it caused.",
      );
    }
    return;
  }
  // Not covered by the assertion above: SILENT_HOLD only reaches the
  // diagnostics channel once a hold outlasts the engine's console threshold
  // (holds.infoMs, 100ms), so a shorter one is recorded as silent in the
  // attribution tables and reported nowhere. Measured: a 41ms hold with no
  // acknowledgement produced `silent: 1` and no diagnostic. This is the
  // budget's own question, and its answer is zero.
  expectNoSilentHolds(artifact);
});
