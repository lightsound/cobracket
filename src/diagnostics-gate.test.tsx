/**
 * Proves the diagnostics gate in `src/test-setup.ts` earns its place, in the
 * two halves it has:
 *
 *   1. the engine reports a real Solid mistake in this environment (happy-dom,
 *      the browser build, attribution on) — not only in a dev browser;
 *   2. an unexpected report fails the test that caused it.
 *
 * (2) cannot be asserted from inside a test the gate is watching — a failing
 * test is the evidence — so it re-runs this very file in a child vitest with
 * `COBRACKET_DIAGNOSTICS_SELFTEST=1`. That flag withholds the expectation in
 * (1) and skips (2), so the child is exactly one broken component with nothing
 * declared, and its exit code is the assertion.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createSignal, flush, For } from "solid-js";
import { render } from "@solidjs/web";
import { expectDiagnostics } from "./test-setup";

const SELFTEST = process.env.COBRACKET_DIAGNOSTICS_SELFTEST === "1";

/** The mistake under test: rows keyed by object identity, refreshed as new objects. */
function UnkeyedRows(props: { rows: { id: number; label: string }[] }) {
  return (
    <ul>
      <For each={props.rows}>{(row) => <li>{row.label}</li>}</For>
    </ul>
  );
}

test("the engine reports a list that threw away row identity", () => {
  // Withheld in the child run: with nothing declared, the gate must fail it.
  if (!SELFTEST) expectDiagnostics("UNSTABLE_LIST_IDENTITY");

  const load = () => [
    { id: 1, label: "a" },
    { id: 2, label: "b" },
    { id: 3, label: "c" },
  ];
  const [rows, setRows] = createSignal(load(), { name: "rows" });
  const host = document.createElement("div");
  document.body.append(host);
  render(() => <UnkeyedRows rows={rows()} />, host);
  flush();

  // The shape the rule is about: the same records arriving as fresh objects,
  // the way a refetch or a subscription payload delivers them.
  setRows(load());
  flush();
  setRows(load());
  flush();

  expect(host.querySelectorAll("li")).toHaveLength(3);
});

test.skipIf(SELFTEST)(
  "an undeclared diagnostic fails the test that caused it",
  () => {
    const child = spawnSync(
      "bun",
      ["x", "vitest", "run", "--project", "src", "src/diagnostics-gate.test.tsx"],
      {
        cwd: join(import.meta.dirname, ".."),
        env: { ...process.env, COBRACKET_DIAGNOSTICS_SELFTEST: "1" },
        encoding: "utf8",
      },
    );
    const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;

    expect(child.status, output).not.toBe(0);
    // The failure has to be the gate's, naming the code, not some other breakage.
    expect(output).toContain("Expected no diagnostics");
    expect(output).toContain("UNSTABLE_LIST_IDENTITY");
  },
  120_000,
);
