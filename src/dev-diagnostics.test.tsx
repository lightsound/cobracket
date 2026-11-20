import { expect, test } from "vite-plus/test";
import { createMemo, createSignal, flush, resolve } from "solid-js";
import { Loading } from "@solidjs/web";
import { expectSilentHold, mount } from "./test-setup";
import { initDevDiagnostics } from "./dev-diagnostics";

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

  initDevDiagnostics();
});
