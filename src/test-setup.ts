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
 * channel as the core ones, so `expectNoDiagnostics` covers all 36 codes at
 * once. It is not the whole story, though: the engine emits a hold's code only
 * once the hold outlasts a duration threshold, so a *short* unacknowledged
 * hold is real, recorded, and coded nowhere. `expectNoSilentHolds` asks that
 * question of the attribution tables instead, where no threshold applies.
 *
 * One boundary is worth knowing: the capture opens in `beforeEach`, so code at
 * a test file's module scope runs before it and is not gated. That is where a
 * file's fixtures and one-off setup live (`setLocale("en")`), never a render —
 * put anything reactive inside a test.
 *
 * Note the environment matters as much as the gate: under `environment: node`
 * the `node` export condition resolves Solid's *server* build, where writes
 * are inert (`[SERVER_WRITE]`), effects never run and the attribution tables
 * stay empty — a green test proving nothing. The `src` project runs on
 * happy-dom for that reason, not because every test touches the DOM.
 */
import { afterEach, beforeEach } from "vite-plus/test";
import { type Element, flush } from "solid-js";
import { render } from "@solidjs/web";
import {
  captureArtifact,
  type CaptureResult,
  type DiagnosticCode,
  DiagnosticsAssertionError,
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
 *
 * `owner` is the test the open capture belongs to. Nothing should be able to
 * consume another test's capture, and a test whose capture is missing has run
 * ungated — both are failures, not conditions to work around.
 */
let endScenario: (() => void) | undefined;
let capture: Promise<CaptureResult<void>> | undefined;
let owner: string | undefined;
/** Codes this test must produce, which are therefore not failures. */
/** Dispose functions for the roots this test mounted, newest last. */
const roots: (() => void)[] = [];
let required: DiagnosticCode[] = [];
/** Codes this test may produce, without having to. */
let tolerated: DiagnosticCode[] = [];
let requiredSilentHold = false;

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
  required.push(...codes);
}

/**
 * The same declaration for a silent hold, which below the engine's `holds`
 * threshold (100ms) has no code to name. Requires the current test to leave a
 * hold unacknowledged, and tolerates it.
 *
 * `SILENT_HOLD` and `LONG_HOLD` become tolerated rather than required, because
 * which side of the threshold a fixture's timer lands on is wall-clock luck: a
 * loaded CI runner would otherwise turn the same unacknowledged hold from a
 * budget finding into a coded one and fail the declaring test.
 *
 * @public
 */
export function expectSilentHold(): void {
  requiredSilentHold = true;
  tolerated.push("SILENT_HOLD", "LONG_HOLD");
}

/**
 * Render into a fresh host, and hand the root's disposal to the gate.
 *
 * `render` returns a dispose function, and a test that drops it leaves a live
 * reactive root behind for the rest of the file: later writes to anything that
 * root still subscribes to re-run it, and the finding lands in whichever test
 * happens to be open. Reproduced — a test that only writes a module-level
 * signal was failed by an unkeyed list a *previous* test had mounted. That is
 * the misattribution the overlap guard refuses, arriving by another door, so
 * it is refused in the same place rather than left to per-file discipline.
 *
 * @public
 */
export function mount(component: () => Element): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  roots.push(render(component, host));
  flush();
  return host;
}

/**
 * The gate's own overlap report. A teardown that finds a missing or foreign
 * capture has nothing it may assert on, and saying so is the only safe move:
 * inheriting another test's findings blames the wrong test, and skipping the
 * assertions lets this one through ungated.
 */
function ungatedError(name: string, pending: unknown, openedBy: string | undefined): Error {
  const why = pending === undefined ? "missing" : `owned by ${openedBy ?? "?"}`;
  return new Error(
    `"${name}" ran outside the Solid diagnostics gate (capture ${why}). ` +
      `Tests under src/ must run sequentially.`,
  );
}

function assertDiagnostics(artifact: DiagnosticsArtifact): void {
  for (const code of required) expectDiagnostic(artifact, code);
  expectNoDiagnostics(artifact, { allow: [...required, ...tolerated] });
}

/**
 * The package's own computation answers both directions, so the positive case
 * cannot drift from the negative one by reading the artifact by hand. Narrowed
 * to its assertion error: anything else is a bug in the harness, not a finding.
 */
function silentHoldFinding(artifact: DiagnosticsArtifact): DiagnosticsAssertionError | undefined {
  try {
    expectNoSilentHolds(artifact);
    return undefined;
  } catch (error) {
    if (error instanceof DiagnosticsAssertionError) return error;
    throw error;
  }
}

function assertHoldFeedback(artifact: DiagnosticsArtifact): void {
  const finding = silentHoldFinding(artifact);
  if (!requiredSilentHold) {
    if (finding !== undefined) throw finding;
    return;
  }
  if (finding === undefined) {
    throw new Error(
      "expectSilentHold() was declared but the scenario acknowledged every hold it caused.",
    );
  }
}

beforeEach((context) => {
  // Both channels are process-global singletons, so two captures cannot be
  // told apart: with `test.concurrent` a diagnostic raised by one test lands
  // in whichever artifact happens to be open, failing the wrong test while
  // the culprit passes (measured, not assumed). Refuse the overlap rather
  // than misattribute it.
  if (capture !== undefined) {
    throw new Error(
      `The Solid diagnostics gate cannot separate overlapping tests (${owner ?? "?"} is ` +
        `still open): the diagnostics channel and the attribution engine are ` +
        `process-global. Run tests under src/ sequentially — no \`test.concurrent\`, ` +
        `no \`describe.concurrent\`.`,
    );
  }
  owner = context.task.id;
  required = [];
  tolerated = [];
  requiredSilentHold = false;
  capture = captureArtifact<void>(
    () =>
      new Promise<void>((resolve) => {
        endScenario = resolve;
      }),
    { scenario: context.task.name },
  );
});

afterEach(async (context) => {
  // Before the scenario closes, so teardown work is attributed to the test
  // that caused it — and so nothing this test mounted can reach the next one.
  for (const dispose of roots.splice(0).reverse()) dispose();
  flush();

  const pending = capture;
  const openedBy = owner;
  endScenario?.();
  endScenario = undefined;
  capture = undefined;
  owner = undefined;

  // Never assert on a capture this test did not open.
  if (pending === undefined || openedBy !== context.task.id) {
    throw ungatedError(context.task.name, pending, openedBy);
  }

  // Always await, even on the failure path: the capture's `finally` is what
  // reads the attribution tables and disables the engine again. Leaving it
  // pending would leak the engine into the next test.
  const { artifact } = await pending;
  assertDiagnostics(artifact);
  assertHoldFeedback(artifact);
});
