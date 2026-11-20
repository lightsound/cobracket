import {
  type DiagnosticCode,
  DiagnosticsAssertionError,
  type DiagnosticsArtifact,
  expectDiagnostic,
  expectNoDiagnostics,
  expectNoSilentHolds,
} from "@solidjs/diagnostics";
import type { ScopeWidth } from "./scope-widths";

/** @public */
export const WIDE_SCOPE_SOURCES = 30;

/** @public */
export interface GateDeclarations {
  required?: readonly DiagnosticCode[];
  tolerated?: readonly DiagnosticCode[];
  requiredSilentHold?: boolean;
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

/** @public */
export function assertGate(
  artifact: DiagnosticsArtifact,
  scopes: readonly ScopeWidth[],
  declarations: GateDeclarations = {},
): void {
  assertDiagnostics(artifact, declarations);
  assertHoldFeedback(artifact, declarations);
  assertScopeWidths(scopes, declarations);
}
