/**
 * `initDevDiagnostics` under the diagnostics gate — which is the whole
 * subject, because the two want the same engine.
 *
 * The gate (`src/test-setup.ts`) enables Solid's attribution engine around
 * every test body and then reads its tables. `enable()` is not additive: it
 * replaces the options and clears every aggregate — `scopeCosts`, `holdLog`,
 * `feedbackSources`, the lot. So app code calling it mid-test erases the
 * evidence the gate is about to judge, for that test, silently. `App` calls
 * this function, so any test rendering the app shell would have been gated on
 * an empty table without knowing it.
 *
 * The function therefore stands down under vitest, where the harness owns the
 * engine, and this file is the proof: a silent hold recorded *before* the call
 * is still there at teardown. Remove the `import.meta.env.VITEST` guard and
 * `expectSilentHold()` fails instead — the hold is real, and the record of it
 * is gone.
 */
import { expect, test } from "vite-plus/test";
import { createMemo, createSignal, flush, resolve } from "solid-js";
import { Loading } from "@solidjs/web";
import { expectSilentHold, mount } from "./test-setup";
import { initDevDiagnostics } from "./dev-diagnostics";

/**
 * A write held behind an async read with nothing acknowledging it — the same
 * shape `src/diagnostics-gate.test.tsx` uses, and the one thing the gate reads
 * from the attribution tables rather than from the diagnostics channel.
 */
async function recordASilentHold(): Promise<void> {
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
}

test("leaves the records the gate is about to read", async () => {
  expectSilentHold();
  await recordASilentHold();

  // Without the guard this call clears the table the declaration above reads,
  // and the test fails for saying a hold happened when the engine no longer
  // remembers one.
  initDevDiagnostics();
});
