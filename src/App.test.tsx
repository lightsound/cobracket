/**
 * The app shell under the gate: the header, the two toggles, and the
 * `<Errored>` / `<Loading>` boundaries the routed page renders inside.
 *
 * The router is the real one (`src/router.ts`), so this also covers the one
 * thing no page test can: that a URL reaches its page through
 * `createRouter`'s lazy import, inside App's boundaries. Only the Convex seam
 * and the auth module are faked, as everywhere else — `src/test-fakes.ts`.
 */
import { expect, test, vi } from "vite-plus/test";
import { api } from "../convex/_generated/api";
import { mount } from "./test-setup";
import { fakeId, publishQuery } from "./test-fakes";

vi.mock("./lib/convex", async () => (await import("./test-fakes")).convexModule());
vi.mock("./lib/auth", async () => (await import("./test-fakes")).authModule());

const { default: App } = await import("./App");

localStorage.setItem("cobracket:locale", "en");

const ORGANIZER = fakeId<"users">("user1");

/** Let the async memos settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The routed page arrives through a dynamic import, which takes more than one
 * turn of the loop — so this waits for the page rather than for a fixed number
 * of ticks. It also settles the import before the test returns, which the gate
 * requires: work left in flight lands on whichever test is open next.
 */
async function routed(host: HTMLElement): Promise<HTMLElement> {
  for (let tick = 0; tick < 100; tick++) {
    const heading = host.querySelector<HTMLElement>("main h2");
    if (heading) return heading;
    await settled();
  }
  throw new Error(`no routed page rendered; main is ${host.querySelector("main")?.textContent}`);
}

test("frames the routed page with the header and the toggles", async () => {
  const host = mount(() => <App />);
  publishQuery(api.auth.currentOrganizer, ORGANIZER);
  publishQuery(api.operations.listMyTournaments, []);
  publishQuery(api.operations.suggestDisciplines, []);
  const heading = await routed(host);

  const home = host.querySelector("header a");
  expect(home?.getAttribute("href")).toBe("/");
  expect(home?.textContent).toContain("cobracket");

  const controls = [...host.querySelectorAll("header button")].map((button) =>
    (button.textContent ?? "").trim(),
  );
  expect(controls).toEqual(["日本語", "Theme: Auto"]);

  // The page for `/` arrived through the router's lazy import, inside the
  // boundaries — its heading is Home's, not the shell's.
  expect(heading.textContent).toBe("Your tournaments");
});

test("keeps the shell up while the routed page is still waiting on data", async () => {
  const host = mount(() => <App />);
  const heading = await routed(host);
  // Nothing published: the page is mounted and its own session boundary owns
  // the frame, while the shell around it is already usable.
  expect(heading.textContent).toBe("Your tournaments");
  expect(host.querySelector("main")?.textContent).toContain("Checking your session…");
  expect(host.querySelectorAll("header button")).toHaveLength(2);

  publishQuery(api.auth.currentOrganizer, ORGANIZER);
  publishQuery(api.operations.listMyTournaments, []);
  publishQuery(api.operations.suggestDisciplines, []);
  await settled();

  expect(host.querySelector("main")?.textContent).not.toContain("Checking your session…");
  expect(host.querySelector("main")?.textContent).toContain("No tournaments yet");
});
