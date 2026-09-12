/**
 * The Organizer management page under the diagnostics gate — 766 lines and
 * the most reactive surface in the app: the roster, the bracket controls, the
 * settings form's writable derivations and the report dialog all run for real
 * here. Only the router hooks and the Convex seam are faked
 * (`src/test-fakes`).
 */
import { expect, test, vi } from "vite-plus/test";
import { flush } from "solid-js";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { setLocale } from "../i18n";
import { mount } from "../test-setup";
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
  ...routerHooks({ tournamentId: "t1" }),
}));

const { default: TournamentPage } = await import("./Tournament");

setLocale("en");

type OrganizerView = NonNullable<FunctionReturnType<typeof api.operations.getTournament>>;

const ORGANIZER = fakeId<"users">("user1");
const TOURNAMENT = fakeId<"tournaments">("t1");
const P = {
  ada: fakeId<"participants">("p1"),
  grace: fakeId<"participants">("p2"),
};

/** Rebuilt on every call — the way each subscription push delivers it. */
function view(overrides: Partial<OrganizerView> = {}): OrganizerView {
  return {
    tournamentId: TOURNAMENT,
    name: "Friday Night Bracket",
    status: "draft",
    discipline: "Chess",
    format: { family: "single_elimination" },
    shareSlug: "friday-night",
    seeding: "manual",
    participants: [
      { participantId: P.ada, name: "Ada", seed: 1 },
      { participantId: P.grace, name: "Grace", seed: 2 },
    ],
    bracket: null,
    ...overrides,
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

function button(host: ParentNode, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (node) => (node.textContent ?? "").trim() === label,
  );
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

/** Solid writes the value property, not the attribute, so find fields by label. */
function field(host: ParentNode, label: string): HTMLInputElement {
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

async function open(overrides: Partial<OrganizerView> = {}): Promise<HTMLElement> {
  const host = mount(() => <TournamentPage />);
  publishQuery(api.auth.currentOrganizer, ORGANIZER);
  publishQuery(api.operations.getTournament, view(overrides));
  publishQuery(api.operations.suggestDisciplines, []);
  await settled();
  return host;
}

test("asks a visitor with no session to start their own", async () => {
  const host = mount(() => <TournamentPage />);
  publishQuery(api.auth.currentOrganizer, null);
  await settled();
  expect(host.textContent).toContain("this browser has no Organizer session");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/");
});

test("says so when the id names nothing of ours", async () => {
  const host = mount(() => <TournamentPage />);
  publishQuery(api.auth.currentOrganizer, ORGANIZER);
  publishQuery(api.operations.getTournament, null);
  await settled();
  expect(host.textContent).toContain("does not exist, was deleted, or belongs to a different");
});

test("renders the roster and explains why there is no bracket yet", async () => {
  const host = await open();
  expect(host.textContent).toContain("Friday Night Bracket");
  expect([...host.querySelectorAll("ol li")].map((li) => li.textContent?.trim())).toHaveLength(2);
  expect(host.textContent).toContain("2 participants");
  expect(host.textContent).toContain("Generate the bracket to preview it here");
});

test("keeps the roster's rows across a subscription re-delivery", async () => {
  const host = await open();
  const firstRow = host.querySelector("ol li");

  // Same tournament, all-new objects: an idle push from Convex.
  publishQuery(api.operations.getTournament, view());
  await settled();

  expect(host.querySelector("ol li")).toBe(firstRow);

  // A real change still lands, in place.
  publishQuery(
    api.operations.getTournament,
    view({ participants: [{ participantId: P.ada, name: "Ada Lovelace", seed: 1 }] }),
  );
  await settled();
  expect(host.querySelector("ol li")?.textContent).toContain("Ada Lovelace");
});

test("adds a participant and clears the field", async () => {
  const host = await open();
  answerMutation(api.operations.addParticipant, () => fakeId<"participants">("p3"));

  const input = host.querySelector<HTMLInputElement>("input[placeholder='Participant name']");
  if (!input) throw new Error("no roster input");
  type(input, "Alan");
  input.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settled();

  expect(mutationCalls()).toEqual([
    { name: "operations:addParticipant", args: { tournamentId: TOURNAMENT, name: "Alan" } },
  ]);
  expect(input.value).toBe("");
});

test("reports why a roster change was refused, and keeps the text", async () => {
  const host = await open();
  answerMutation(api.operations.addParticipant, () => {
    throw new Error("That name is already taken");
  });

  const input = host.querySelector<HTMLInputElement>("input[placeholder='Participant name']");
  if (!input) throw new Error("no roster input");
  type(input, "Ada");
  input.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settled();

  expect(host.textContent).toContain("That name is already taken");
  expect(input.value).toBe("Ada");
});

test("saves only the settings that actually changed", async () => {
  const host = await open();
  answerMutation(api.operations.updateTournament, () => null);

  const name = field(host, "Tournament name");
  expect(name.value).toBe("Friday Night Bracket");
  type(name, "Saturday Night Bracket");
  button(host, "Save changes")
    .closest("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settled();

  // Discipline and format are untouched, so they are not in the patch.
  expect(mutationCalls()).toEqual([
    {
      name: "operations:updateTournament",
      args: { tournamentId: TOURNAMENT, name: "Saturday Night Bracket" },
    },
  ]);
  expect(host.textContent).toContain("Saved.");
});

test("a server change overrides a local settings edit", async () => {
  const host = await open();
  const name = field(host, "Tournament name");
  type(name, "half-typed");

  // The writable derivation is `createSignal(() => props.view.name)`: a new
  // server value re-runs it, so the field follows the source of truth rather
  // than stranding an edit nobody saved.
  publishQuery(api.operations.getTournament, view({ name: "Renamed Elsewhere" }));
  await settled();

  expect(field(host, "Tournament name").value).toBe("Renamed Elsewhere");
});

test("deletes only after a second confirmation, then goes home", async () => {
  const host = await open();
  answerMutation(api.operations.deleteTournament, () => null);

  button(host, "Delete tournament…").click();
  flush();
  expect(host.textContent).toContain("permanently?");
  expect(mutationCalls()).toEqual([]);

  button(host, "Delete permanently").click();
  await settled();

  expect(mutationCalls()).toEqual([
    { name: "operations:deleteTournament", args: { tournamentId: TOURNAMENT } },
  ]);
  expect(navigations()).toEqual(["/"]);
});

test("reports a result from the dialog the bracket opens", async () => {
  const host = await open({
    status: "live",
    bracket: {
      completed: false,
      matches: [
        {
          matchId: fakeId<"matches">("m1"),
          key: "w1m1",
          bracket: "winners",
          round: 1,
          indexInRound: 0,
          state: "ready",
          occupants: [
            { kind: "participant", participantId: P.ada },
            { kind: "participant", participantId: P.grace },
          ],
        },
      ],
      readyMatchKeys: ["w1m1"],
      voidedMatchKeys: [],
      standings: [],
    },
  });
  answerMutation(api.operations.reportResult, () => ({ status: "live" as const, voided: [] }));

  // The card is the only way in: the dialog has no independent entry point.
  host.querySelector<HTMLButtonElement>("button[style*='translate']")?.click();
  flush();

  const dialog = document.body.querySelector("form.max-w-sm");
  expect(dialog?.textContent).toContain("Record result");

  const winner = [...(dialog?.querySelectorAll<HTMLInputElement>("input[type=radio]") ?? [])].find(
    (radio) => radio.closest("label")?.textContent?.includes("Ada"),
  );
  winner?.click();
  flush();
  dialog?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settled();

  expect(mutationCalls()).toEqual([
    {
      name: "operations:reportResult",
      args: {
        matchId: "m1",
        sides: [
          { participantId: P.ada, outcome: "win" },
          { participantId: P.grace, outcome: "loss" },
        ],
      },
    },
  ]);
  // Reporting closes the dialog.
  expect(document.body.querySelector("form.max-w-sm")).toBeNull();
});

test("saves an edited discipline even with the suggestions still in flight", async () => {
  const host = await open();
  answerMutation(api.operations.updateTournament, () => null);

  // The settings form's half of the same bug: `settingsChanges` omits a key
  // it thinks is unchanged, so a held write did not ship a stale discipline —
  // it dropped the field from the patch entirely, and still said "Saved."
  type(field(host, "Tournament name"), "Saturday Night Bracket");
  type(field(host, "Discipline"), "Chess960");
  button(host, "Save changes")
    .closest("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settled();

  expect(mutationCalls()).toEqual([
    {
      name: "operations:updateTournament",
      args: {
        tournamentId: TOURNAMENT,
        name: "Saturday Night Bracket",
        discipline: "Chess960",
      },
    },
  ]);
  expect(host.textContent).toContain("Saved.");
});

/**
 * A roster the size of a real one, rebuilt on every call. Sized above the
 * gate's scale-dependent thresholds (`[WIDE_SCOPE_DEPS]` at 30 sources) —
 * two participants cannot reach them, so without a fixture this size the
 * per-row cost of the roster is only ever asserted by reading the code.
 * Each row carries a `<Show>` on `editingId()`, which by measurement costs
 * the list's insert effect nothing where it sits (inside the `<li>`, not as
 * the row's root); this is what keeps that a measurement.
 */
function bigRoster(): OrganizerView["participants"] {
  return Array.from({ length: 32 }, (_, index) => ({
    participantId: fakeId<"participants">(`p${index + 1}`),
    name: `Player ${index + 1}`,
    seed: index + 1,
  }));
}

test("a tournament-sized roster costs the list no per-row subscription", async () => {
  const host = await open({ participants: bigRoster() });
  expect(host.querySelectorAll("ol li")).toHaveLength(32);
  const firstRow = host.querySelector("ol li");

  // A subscription push with all-new objects, at scale.
  publishQuery(api.operations.getTournament, view({ participants: bigRoster() }));
  await settled();

  expect(host.querySelector("ol li")).toBe(firstRow);
  expect(host.textContent).toContain("32 participants");
});
