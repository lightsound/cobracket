/**
 * Proves the diagnostics gate in `src/test-setup.ts` earns its place, in the
 * two halves it has:
 *
 *   1. the engine finds real Solid mistakes in this environment (happy-dom,
 *      the browser build, attribution on) — not only in a dev browser. One
 *      case per channel the gate reads: a coded diagnostic; a silent hold,
 *      which below the engine's console threshold has no code at all; and a
 *      scope whose sources grew with a list, which no code reports since
 *      Solid 2.0.0-rc.14;
 *   2. an undeclared finding fails the test that caused it.
 *
 * (2) cannot be asserted from inside a test the gate is watching — a failing
 * test is the evidence — so it re-runs this very file in a child vitest with
 * `COBRACKET_DIAGNOSTICS_SELFTEST=1`. That flag withholds the declarations in
 * (1) and skips (2), so the child is exactly three broken scenarios with
 * nothing declared, and its exit code is the assertion.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createMemo, createSignal, flush, For, resolve, Show } from "solid-js";
import { Loading } from "@solidjs/web";
import { WIDE_SCOPE_SOURCES } from "./diagnostics-verdict";
import { expectDiagnostics, expectSilentHold, expectWideScope, mount } from "./test-setup";

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

/** A row component, so the row is what `BracketView` renders: a component behind a narrowing. */
function Label(props: { text: string }) {
  return <li>{props.text}</li>;
}

test("the engine counts a list whose rows each narrow their own data", () => {
  // Withheld in the child run, same as above.
  if (!SELFTEST) expectWideScope();

  const rows = Array.from({ length: WIDE_SCOPE_SOURCES }, (_, index) => ({
    key: `k${index}`,
    label: `row ${index}`,
  }));
  const byKey = createMemo(() => new Map(rows.map((row) => [row.key, row])), { name: "byKey" });

  // The shape `BracketView` once had: each row looks its record up and
  // narrows it with a <Show>, which makes the row a source of the list's
  // insert effect. No code reports it — the engine exempts that effect.
  const host = mount(() => (
    <ul>
      <For each={rows} keyed={(row) => row.key}>
        {(row) => (
          <Show when={byKey().get(row().key)}>{(found) => <Label text={found().label} />}</Show>
        )}
      </For>
    </ul>
  ));

  expect(host.querySelectorAll("li")).toHaveLength(WIDE_SCOPE_SOURCES);
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
    // breakage — and every channel has to fail, not just the coded one. The
    // messages together say that; a failure count would only restate it in a
    // reporter's wording.
    expect(output).toContain("Expected no diagnostics");
    expect(output).toContain("UNSTABLE_LIST_IDENTITY");
    expect(output).toContain("Expected no silent holds");
    expect(output).toContain("Expected no scope to track");
  },
  120_000,
);
