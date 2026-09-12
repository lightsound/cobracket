/**
 * `initDevDiagnostics` under the diagnostics gate — which is the whole
 * subject, because the two want the same engine.
 *
 * The gate (`src/test-setup.ts`) enables Solid's attribution engine around
 * every test body with one option changed from its default. `enable()` is not
 * additive: it replaces the options and clears every aggregate table. So app
 * code calling it mid-test resets the gate's `hotTime` override and wipes the
 * hold records its second assertion reads — for that test, silently. `App`
 * calls this function, so any test that renders the app shell would have been
 * gated on the defaults without knowing it.
 *
 * The function therefore stands down under vitest, and this file is the proof:
 * the same scope that reports against the 8ms default reports against the
 * gate's 40ms after the call. Removing the `import.meta.env.VITEST` guard
 * fails the first test with `budget 8ms` in the message.
 */
import { expect, test } from "vite-plus/test";
import { createMemo, createSignal, flush } from "solid-js";
import { mount } from "./test-setup";
import { initDevDiagnostics } from "./dev-diagnostics";

/** Busy-wait, so the scope's self-time is real compute the engine measures. */
function burn(ms: number): void {
  const start = Date.now();
  while (Date.now() - start < ms) {
    /* spin */
  }
}

/**
 * A memo the engine will charge 20ms to: over the 8ms default budget, under
 * the gate's 40ms. Rendered, because self-time is only attributed to scopes
 * that run inside the graph — a memo called straight from a test body is
 * untracked and costs nothing measurable.
 */
function burnTwentyMs(): void {
  const [n, setN] = createSignal(1, { name: "n" });
  const slow = createMemo(
    () => {
      burn(20);
      return n();
    },
    { name: "slow" },
  );
  const host = mount(() => <p>{slow()}</p>);
  setN(2);
  flush();
  expect(host.textContent).toBe("2");
}

test("leaves the gate's engine options in force", () => {
  initDevDiagnostics();
  // No [HOT_SCOPE_TIME]: the gate's 40ms budget survived the call. Without
  // the guard this same scope reports at 8ms and the gate fails the test.
  burnTwentyMs();
});

test("is safe to call more than once", () => {
  initDevDiagnostics();
  initDevDiagnostics();
  burnTwentyMs();
});
