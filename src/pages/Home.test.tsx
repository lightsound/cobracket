/**
 * The Organizer home page under the diagnostics gate. Only the router hooks
 * and the Convex seam are faked (`src/test-fakes`); the session boundary, the
 * tournament list, the create form and the Discipline field with its
 * suggestions all run for real.
 */
import { expect, test, vi } from "vite-plus/test";
import { flush } from "solid-js";
import { api } from "../../convex/_generated/api";
import { setLocale } from "../i18n";
import { mount } from "../test-setup";
import type { FunctionReturnType } from "convex/server";
import {
  answerMutation,
  fakeId,
  mutationCalls,
  navigations,
  publishQuery,
  routerHooks,
} from "../test-fakes";

vi.mock("../lib/convex", async () => (await import("../test-fakes")).convexModule());
vi.mock("../lib/auth", async () => (await import("../test-fakes")).authModule());
vi.mock("@solidjs/router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...routerHooks({}),
}));

const { default: Home } = await import("./Home");

setLocale("en");

/** Let the async memos settle and the DOM catch up. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A live session with an empty list and suggestions answered. */
async function ready(): Promise<HTMLElement> {
  const host = mount(() => <Home />);
  publishQuery(api.auth.currentOrganizer, ORGANIZER);
  publishQuery(api.operations.listMyTournaments, []);
  publishQuery(api.operations.suggestDisciplines, []);
  await settled();
  return host;
}

/** Rebuilt on every call — the way each subscription push delivers it. */
function tournaments(): FunctionReturnType<typeof api.operations.listMyTournaments> {
  return [
    {
      tournamentId: fakeId<"tournaments">("t1"),
      name: "Friday Night Bracket",
      discipline: "Street Fighter 6",
      format: { family: "single_elimination" },
      status: "live",
      shareSlug: "friday-night",
    },
    {
      tournamentId: fakeId<"tournaments">("t2"),
      name: "Sunday Cup",
      discipline: "Chess",
      format: { family: "double_elimination", grandFinalReset: true },
      status: "draft",
      shareSlug: "sunday-cup",
    },
  ];
}

const ORGANIZER = fakeId<"users">("user1");

function field(host: HTMLElement, label: string): HTMLInputElement {
  const wrapper = [...host.querySelectorAll("label")].find((node) =>
    (node.textContent ?? "").includes(label),
  );
  const input = wrapper?.querySelector("input");
  if (!input) throw new Error(`no input under label ${label}`);
  return input;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
}

test("invites a first-time visitor to create one, with no list", async () => {
  const host = mount(() => <Home />);
  publishQuery(api.auth.currentOrganizer, null);
  await settled();

  expect(host.textContent).toContain("Create your first tournament below");
  expect(host.querySelector("ul")).toBeNull();
  // The create form is not behind the session: story 1 is zero sign-up.
  expect(host.querySelector("form")).not.toBeNull();
});

test("lists the organizer's tournaments once the session is live", async () => {
  const host = mount(() => <Home />);
  publishQuery(api.auth.currentOrganizer, ORGANIZER);
  publishQuery(api.operations.listMyTournaments, tournaments());
  await settled();

  const rows = [...host.querySelectorAll("ul li")];
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain("Friday Night Bracket");
  expect(rows[0]?.textContent).toContain("Street Fighter 6");
  expect(rows[0]?.textContent).toContain("Single elimination");
  expect(rows[0]?.querySelector("a")?.getAttribute("href")).toBe("/t/t1");
  expect(rows[1]?.textContent).toContain("Double elimination");
});

test("keeps its rows across a subscription re-delivery", async () => {
  const host = mount(() => <Home />);
  publishQuery(api.auth.currentOrganizer, ORGANIZER);
  publishQuery(api.operations.listMyTournaments, tournaments());
  await settled();
  const firstRow = host.querySelector("ul li");

  // Same tournaments, all-new objects.
  publishQuery(api.operations.listMyTournaments, tournaments());
  await settled();

  expect(host.querySelector("ul li")).toBe(firstRow);
});

test("says the list is empty rather than showing nothing", async () => {
  const host = mount(() => <Home />);
  publishQuery(api.auth.currentOrganizer, ORGANIZER);
  publishQuery(api.operations.listMyTournaments, []);
  await settled();
  expect(host.textContent).toContain("No tournaments yet");
});

test("creates a tournament and navigates to it", async () => {
  const host = mount(() => <Home />);
  publishQuery(api.auth.currentOrganizer, ORGANIZER);
  publishQuery(api.operations.listMyTournaments, []);
  publishQuery(api.operations.suggestDisciplines, []);
  await settled();
  answerMutation(api.operations.createTournament, () => ({
    tournamentId: fakeId<"tournaments">("t9"),
    shareSlug: "t9-share",
  }));

  type(field(host, "Tournament name"), "Friday Night Bracket");
  type(field(host, "Discipline"), "Chess");
  host
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settled();

  expect(mutationCalls()).toEqual([
    {
      name: "operations:createTournament",
      args: {
        name: "Friday Night Bracket",
        discipline: "Chess",
        format: { family: "single_elimination" },
      },
    },
  ]);
  expect(navigations()).toEqual(["/t/t9"]);
});

test("shows the reason when creating fails, and does not navigate", async () => {
  const host = mount(() => <Home />);
  publishQuery(api.auth.currentOrganizer, ORGANIZER);
  publishQuery(api.operations.listMyTournaments, []);
  publishQuery(api.operations.suggestDisciplines, []);
  await settled();
  answerMutation(api.operations.createTournament, () => {
    throw new Error("Discipline is required");
  });

  type(field(host, "Tournament name"), "Nameless");
  host
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settled();

  expect(host.textContent).toContain("Discipline is required");
  expect(navigations()).toEqual([]);
});

test("shows each keystroke while the suggestions query is still held", async () => {
  const host = mount(() => <Home />);
  publishQuery(api.auth.currentOrganizer, ORGANIZER);
  publishQuery(api.operations.listMyTournaments, []);
  publishQuery(api.operations.suggestDisciplines, ["Chess"]);
  await settled();

  const discipline = field(host, "Discipline");
  // Each keystroke re-subscribes the suggestions query. The field must not
  // wait for that answer: `<Loading on>` on the datalist makes the boundary
  // own the wait, so the write commits at once. Remove the `on` and the gate
  // reports the resulting hold as silent.
  type(discipline, "Che");
  expect(discipline.value).toBe("Che");
  await settled();
  expect(discipline.value).toBe("Che");
});

test("submits what was typed even with the suggestions still in flight", async () => {
  const host = await ready();
  answerMutation(api.operations.createTournament, () => ({
    tournamentId: fakeId<"tournaments">("t9"),
    shareSlug: "t9-share",
  }));

  // Type the last character and submit in the same turn — the suggestions for
  // that prefix have not landed. Before `<Loading on>` this sent the value
  // from before the keystroke: "" on a first entry, and the *previous*
  // discipline when editing one, which the server accepts.
  type(field(host, "Tournament name"), "Friday Night Bracket");
  type(field(host, "Discipline"), "Chess");
  host
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settled();

  expect(field(host, "Discipline").value).toBe("Chess");
  const sent = mutationCalls()[0]?.args as { discipline: string } | undefined;
  expect(sent?.discipline).toBe("Chess");
});

test("submits an edited discipline, not the one it replaced", async () => {
  const host = await ready();
  answerMutation(api.operations.createTournament, () => ({
    tournamentId: fakeId<"tournaments">("t9"),
    shareSlug: "t9-share",
  }));

  type(field(host, "Tournament name"), "Friday Night Bracket");
  type(field(host, "Discipline"), "Chess");
  await settled();
  // The worse half of the same bug: a committed previous value passes the
  // server's non-empty check, so this shipped silently wrong data.
  type(field(host, "Discipline"), "Chess960");
  host
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settled();

  const sent = mutationCalls()[0]?.args as { discipline: string } | undefined;
  expect(sent?.discipline).toBe("Chess960");
});

test("a suggestion published while the keystroke is in flight is the one that shows", async () => {
  const host = await ready();

  // Typing opens a new subscription; the answer for it lands before the fake
  // would have seeded the flight from the previous result.
  type(field(host, "Discipline"), "Che");
  publishQuery(api.operations.suggestDisciplines, ["Chess", "Checkers"]);
  await settled();

  expect([...host.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"))).toEqual(
    ["Chess", "Checkers"],
  );
});

test("clears the completions while a new prefix is in flight", async () => {
  const host = await ready();
  publishQuery(api.operations.suggestDisciplines, ["Chess"]);
  await settled();
  const options = () =>
    [...host.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"));
  expect(options()).toEqual(["Chess"]);

  // The visible half of `<Loading on>`: the boundary shows its fallback —
  // here, nothing — rather than keeping completions for a prefix nobody
  // typed. Without `on` the old list would stay on screen and the write
  // would be held instead.
  type(field(host, "Discipline"), "Che");
  expect(options()).toEqual([]);

  publishQuery(api.operations.suggestDisciplines, ["Chess", "Checkers"]);
  await settled();
  expect(options()).toEqual(["Chess", "Checkers"]);
});

/**
 * The same list at a size the gate's scale-dependent codes can reach — see
 * the roster fixture in `Tournament.test.tsx` for why a small one cannot.
 * An Organizer's list is realistically shorter than a roster, but the rows
 * hold a component (`StatusBadge`), which is the other shape worth measuring
 * rather than reasoning about.
 */
function manyTournaments(): FunctionReturnType<typeof api.operations.listMyTournaments> {
  return Array.from({ length: 32 }, (_, index) => ({
    tournamentId: fakeId<"tournaments">(`t${index + 1}`),
    name: `Tournament ${index + 1}`,
    discipline: "Chess",
    format: { family: "single_elimination" as const },
    status: "draft" as const,
    shareSlug: `slug-${index + 1}`,
  }));
}

test("a long tournament list costs the list no per-row subscription", async () => {
  const host = mount(() => <Home />);
  publishQuery(api.auth.currentOrganizer, ORGANIZER);
  publishQuery(api.operations.listMyTournaments, manyTournaments());
  publishQuery(api.operations.suggestDisciplines, []);
  await settled();
  expect(host.querySelectorAll("ul li")).toHaveLength(32);
  const firstRow = host.querySelector("ul li");

  // A subscription push with all-new objects, at scale.
  publishQuery(api.operations.listMyTournaments, manyTournaments());
  await settled();

  expect(host.querySelector("ul li")).toBe(firstRow);
});
