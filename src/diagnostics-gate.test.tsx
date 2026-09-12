/**
 * Proves the diagnostics gate in `src/test-setup.ts` earns its place, in the
 * two halves it has:
 *
 *   1. the engine finds real Solid mistakes in this environment (happy-dom,
 *      the browser build, attribution on) — not only in a dev browser. One
 *      case per channel the gate reads: a coded diagnostic, and a silent hold,
 *      which below the engine's console threshold has no code at all;
 *   2. an undeclared finding fails the test that caused it.
 *
 * (2) cannot be asserted from inside a test the gate is watching — a failing
 * test is the evidence — so it re-runs this very file in a child vitest with
 * `COBRACKET_DIAGNOSTICS_SELFTEST=1`. That flag withholds the declarations in
 * (1) and skips (2), so the child is exactly two broken scenarios with nothing
 * declared, and its exit code is the assertion.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createMemo, createSignal, flush, For, resolve } from "solid-js";
import { Loading } from "@solidjs/web";
import { expectDiagnostics, expectSilentHold, mount } from "./test-setup";

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
  const host = mount(() => <UnkeyedRows rows={rows()} />);

  // The shape the rule is about: the same records arriving as fresh objects,
  // the way a refetch or a subscription payload delivers them.
  setRows(load());
  flush();
  setRows(load());
  flush();

  expect(host.querySelectorAll("li")).toHaveLength(3);
});

test("the engine records a held write the screen never acknowledged", async () => {
  // Withheld in the child run, same as above.
  if (!SELFTEST) expectSilentHold();

  const [id, setId] = createSignal(1, { name: "selectedId" });
  const load = (value: number) =>
    new Promise<string>((settle) => setTimeout(() => settle(`item ${value}`), 20));
  const item = createMemo(() => load(id()), { name: "item" });

  const host = mount(() => (
    <Loading fallback={<p>loading</p>}>
      <span>{item()}</span>
    </Loading>
  ));
  await resolve(() => item());
  flush();

  // A write held behind `item` with no isPending(), latest(), optimistic value
  // or affects() anywhere — dead input time, and short enough that the console
  // tier stays quiet about it.
  setId(2);
  flush();
  await resolve(() => item());
  flush();

  expect(host.textContent).toContain("item 2");
});

test.skipIf(SELFTEST)(
  "an undeclared finding fails the test that caused it",
  () => {
    // `vp`, not `vitest`: vitest is not a direct devDependency here, it is a
    // bin hoisted out of vite-plus. `bun x` falls back to the registry when a
    // local bin is missing, so a hoist change would quietly run a *different*
    // vitest against this config instead of failing. `vp test run` is the
    // entry point AGENTS.md documents and takes the same flags.
    const child = spawnSync(
      "bun",
      ["x", "vp", "test", "run", "--project", "src", "src/diagnostics-gate.test.tsx"],
      {
        cwd: join(import.meta.dirname, ".."),
        env: { ...process.env, COBRACKET_DIAGNOSTICS_SELFTEST: "1" },
        encoding: "utf8",
      },
    );
    const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;

    expect(child.status, output).not.toBe(0);
    // The failures have to be the gate's, naming what it found, not some other
    // breakage — and both channels have to fail, not just the coded one. Both
    // messages together say that; a failure count would only restate it in a
    // reporter's wording.
    expect(output).toContain("Expected no diagnostics");
    expect(output).toContain("UNSTABLE_LIST_IDENTITY");
    expect(output).toContain("Expected no silent holds");
  },
  120_000,
);
