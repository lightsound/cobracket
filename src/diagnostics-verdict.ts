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
 * 36 codes at once: Solid grades most of them `warn` or `info` and offers no
 * switch to escalate, which is why enforcing them lives in a test rather than
 * a setting. `expectNoSilentHolds` covers what that leaves: the engine emits a
 * hold's code only once the hold outlasts its `holds.infoMs` threshold
 * (100ms), so a shorter unacknowledged hold is real, recorded, and coded
 * nowhere — the attribution tables answer that question without a threshold.
 */
import {
  type DiagnosticCode,
  DiagnosticsAssertionError,
  type DiagnosticsArtifact,
  expectDiagnostic,
  expectNoDiagnostics,
  expectNoSilentHolds,
} from "@solidjs/diagnostics";

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

/**
 * Fail unless the artifact is clean: no diagnostic beyond the declared ones
 * (each declared-required one present), and no hold the screen never
 * acknowledged, unless one was declared.
 *
 * @public
 */
export function assertGate(
  artifact: DiagnosticsArtifact,
  declarations: GateDeclarations = {},
): void {
  assertDiagnostics(artifact, declarations);
  assertHoldFeedback(artifact, declarations);
}
