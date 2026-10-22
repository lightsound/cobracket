/**
 * The verdict the two diagnostics gates share.
 *
 * `src/test-setup.ts` wraps every test under `src/` in an in-process capture
 * on happy-dom; `e2e/` captures a scripted Chromium session against the dev
 * server through `captureBrowserArtifact`. Both end with the same
 * `DiagnosticsArtifact`, so what an artifact has to satisfy is written once,
 * here, and the browser gate cannot drift from the happy-dom one — a code the
 * one fails on, the other fails on too.
 *
 * Two questions, because one is not enough. `expectNoDiagnostics` covers all
 * 67 codes at once (each capture decides which thresholds are armed; the
 * verdict is the same whichever are): Solid grades most of them `warn` or
 * `info` and offers no switch to escalate, which is why enforcing them lives
 * in a test rather than a setting. `expectNoSilentHolds` covers what that
 * leaves: the engine emits a hold's code only once the hold outlasts its
 * `holds.infoMs` threshold (100ms), so a shorter unacknowledged hold is real,
 * recorded, and coded nowhere — the attribution tables answer that question
 * without a threshold.
 *
 * A third question comes from beside the artifact: how many sources each
 * scope tracked (`src/scope-widths.ts`). Since Solid 2.0.0-rc.14 no code
 * reports a list whose rows each cost its insert effect a source, the defect
 * both gates were sized to catch, so the verdict counts it itself.
 */
import {
  type DiagnosticCode,
  DiagnosticsAssertionError,
  type DiagnosticsArtifact,
  expectDiagnostic,
  expectNoDiagnostics,
  expectNoSilentHolds,
} from "@solidjs/diagnostics";
import type { ScopeWidth } from "./scope-widths";

/**
 * The most sources one scope may track: the `[WIDE_SCOPE_DEPS]` default
 * before rc.14 raised it to 200, and the number both gates' fixtures are
 * sized above (31 rows). The widest scope in the shipped app tracks 9 — a
 * match card's attribute effect — so a scope at 30 has grown with its data.
 *
 * @public
 */
export const WIDE_SCOPE_SOURCES = 30;

/**
 * What a test declared about its own subject before the artifact is judged.
 * Every field is for a gate's own proofs, which render deliberately broken
 * code; a test about real code declares nothing.
 *
 * @public
 */
export interface GateDeclarations {
  /** Codes the scenario must produce, which are therefore not failures. */
  required?: readonly DiagnosticCode[];
  /** Codes the scenario may produce, without having to. */
  tolerated?: readonly DiagnosticCode[];
  /** The scenario must leave a hold unacknowledged. */
  requiredSilentHold?: boolean;
  /** The scenario must leave a scope at or above `WIDE_SCOPE_SOURCES`. */
  requiredWideScope?: boolean;
}

function assertDiagnostics(artifact: DiagnosticsArtifact, declarations: GateDeclarations): void {
  const required = declarations.required ?? [];
  for (const code of required) expectDiagnostic(artifact, code);
  expectNoDiagnostics(artifact, { allow: [...required, ...(declarations.tolerated ?? [])] });
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

function assertHoldFeedback(artifact: DiagnosticsArtifact, declarations: GateDeclarations): void {
  const finding = silentHoldFinding(artifact);
  if (declarations.requiredSilentHold !== true) {
    if (finding !== undefined) throw finding;
    return;
  }
  if (finding === undefined) {
    throw new Error(
      "expectSilentHold() was declared but the scenario acknowledged every hold it caused.",
    );
  }
}

function assertScopeWidths(scopes: readonly ScopeWidth[], declarations: GateDeclarations): void {
  const wide = scopes
    .filter((scope) => scope.sources >= WIDE_SCOPE_SOURCES)
    .sort((a, b) => b.sources - a.sources);
  if (declarations.requiredWideScope === true) {
    if (wide.length === 0) {
      throw new Error(
        "expectWideScope() was declared but no scope tracked " +
          `${WIDE_SCOPE_SOURCES} sources or more.`,
      );
    }
    return;
  }
  if (wide.length > 0) {
    const named = wide.map((scope) => `${scope.kind} "${scope.name}" (${scope.sources})`);
    throw new Error(
      `Expected no scope to track ${WIDE_SCOPE_SOURCES} sources or more, found ` +
        `${named.join(", ")}. A count that grows with a list is usually a per-row ` +
        "reactive wrapper (a <Show> narrowing each row): join the data in one memo " +
        "above the <For> instead.",
    );
  }
}

/**
 * Fail unless the run is clean: no diagnostic beyond the declared ones (each
 * declared-required one present), no hold the screen never acknowledged, and
 * no scope as wide as `WIDE_SCOPE_SOURCES`, unless declared.
 *
 * @public
 */
export function assertGate(
  artifact: DiagnosticsArtifact,
  scopes: readonly ScopeWidth[],
  declarations: GateDeclarations = {},
): void {
  assertDiagnostics(artifact, declarations);
  assertHoldFeedback(artifact, declarations);
  assertScopeWidths(scopes, declarations);
}
