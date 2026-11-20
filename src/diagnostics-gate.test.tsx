import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createMemo, createSignal, flush, For, resolve, Show } from "solid-js";
import { Loading } from "@solidjs/web";
import { WIDE_SCOPE_SOURCES } from "./diagnostics-verdict";
import { expectDiagnostics, expectSilentHold, expectWideScope, mount } from "./test-setup";

const SELFTEST = process.env.COBRACKET_DIAGNOSTICS_SELFTEST === "1";

function UnkeyedRows(props: { rows: { id: number; label: string }[] }) {
  return (
    <ul>
      <For each={props.rows}>{(row) => <li>{row.label}</li>}</For>
    </ul>
  );
}

test("the engine reports a list that threw away row identity", () => {
  if (!SELFTEST) expectDiagnostics("UNSTABLE_LIST_IDENTITY");

  const load = () => [
    { id: 1, label: "a" },
    { id: 2, label: "b" },
    { id: 3, label: "c" },
  ];
  const [rows, setRows] = createSignal(load(), { name: "rows" });
  const host = mount(() => <UnkeyedRows rows={rows()} />);

  setRows(load());
  flush();
  setRows(load());
  flush();

  expect(host.querySelectorAll("li")).toHaveLength(3);
});

test("the engine records a held write the screen never acknowledged", async () => {
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

  setId(2);
  flush();
  await resolve(() => item());
  flush();

  expect(host.textContent).toContain("item 2");
});

function Label(props: { text: string }) {
  return <li>{props.text}</li>;
}

test("the engine counts a list whose rows each narrow their own data", () => {
  if (!SELFTEST) expectWideScope();

  const rows = Array.from({ length: WIDE_SCOPE_SOURCES }, (_, index) => ({
    key: `k${index}`,
    label: `row ${index}`,
  }));
  const byKey = createMemo(() => new Map(rows.map((row) => [row.key, row])), { name: "byKey" });

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
