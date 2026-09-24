/**
 * The Share Link page under the diagnostics gate — a whole page, not a
 * component. Only the router hooks and the Convex seam are faked
 * (`src/test-fakes`); the page, its boundaries, the header and the whole
 * bracket render for real, which is what puts them under the gate.
 */
import { expect, test, vi } from "vite-plus/test";
import { api } from "../../convex/_generated/api";
import { AppProviders } from "../providers";
import { mount } from "../test-setup";
import type { FunctionReturnType } from "convex/server";
import { fakeId, publishQuery, routerHooks } from "../test-fakes";

vi.mock("../lib/convex", async () => (await import("../test-fakes")).convexModule());
vi.mock("@solidjs/router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...routerHooks({ shareSlug: "sunday-cup" }),
}));

const { default: SharePage } = await import("./Share");

localStorage.setItem("cobracket:locale", "en");

type SharedView = NonNullable<FunctionReturnType<typeof api.operations.getSharedTournament>>;

const P = {
  ada: fakeId<"participants">("p1"),
  grace: fakeId<"participants">("p2"),
  alan: fakeId<"participants">("p3"),
  edsger: fakeId<"participants">("p4"),
};

/** Rebuilt on every call — the way each subscription push delivers it. */
function sharedView(overrides: Partial<SharedView> = {}): SharedView {
  return {
    name: "Sunday Cup",
    status: "live",
    discipline: "Chess",
    format: { family: "single_elimination" },
    participants: [
      { participantId: P.ada, name: "Ada", seed: 1 },
      { participantId: P.grace, name: "Grace", seed: 2 },
      { participantId: P.alan, name: "Alan", seed: 3 },
      { participantId: P.edsger, name: "Edsger", seed: 4 },
    ],
    bracket: {
      completed: false,
      matches: [
        {
          key: "w1m1",
          bracket: "winners",
          round: 1,
          indexInRound: 0,
          state: "completed",
          occupants: [
            { kind: "participant", participantId: P.ada },
            { kind: "participant", participantId: P.grace },
          ],
          winnerId: P.ada,
        },
        {
          key: "w1m2",
          bracket: "winners",
          round: 1,
          indexInRound: 1,
          state: "completed",
          occupants: [
            { kind: "participant", participantId: P.alan },
            { kind: "participant", participantId: P.edsger },
          ],
          winnerId: P.alan,
        },
        {
          key: "w2m1",
          bracket: "winners",
          round: 2,
          indexInRound: 0,
          state: "ready",
          occupants: [
            { kind: "participant", participantId: P.ada },
            { kind: "participant", participantId: P.alan },
          ],
        },
      ],
      readyMatchKeys: ["w2m1"],
      voidedMatchKeys: [],
      standings: [],
    },
    ...overrides,
  };
}

/** Let the async memo settle and the DOM catch up. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test("shows the loading fallback until the subscription delivers", () => {
  const host = mount(() => (
    <AppProviders>
      <SharePage />
    </AppProviders>
  ));
  expect(host.textContent).toContain("Loading");
});

test("renders the tournament the share slug names, bracket and all", async () => {
  const host = mount(() => (
    <AppProviders>
      <SharePage />
    </AppProviders>
  ));
  publishQuery(api.operations.getSharedTournament, sharedView());
  await settled();

  expect(host.textContent).toContain("Sunday Cup");
  expect(host.textContent).toContain("Chess");
  expect(host.querySelectorAll("button[style*='translate']")).toHaveLength(3);
  // A viewer has no Organizer controls, so no card is reportable.
  for (const card of host.querySelectorAll("button[style*='translate']")) {
    expect(card.hasAttribute("disabled")).toBe(true);
  }
});

test("says so when the slug names nothing", async () => {
  const host = mount(() => (
    <AppProviders>
      <SharePage />
    </AppProviders>
  ));
  publishQuery(api.operations.getSharedTournament, null);
  await settled();
  expect(host.textContent).toContain("This tournament is not available");
});

test("keeps the bracket's DOM across a subscription re-delivery", async () => {
  const host = mount(() => (
    <AppProviders>
      <SharePage />
    </AppProviders>
  ));
  publishQuery(api.operations.getSharedTournament, sharedView());
  await settled();
  const firstCard = host.querySelector("button[style*='translate']");

  // The same tournament, all-new objects: an idle push from Convex.
  publishQuery(api.operations.getSharedTournament, sharedView());
  await settled();

  expect(host.querySelector("button[style*='translate']")).toBe(firstCard);

  // And a real change still lands, through the page rather than around it.
  publishQuery(api.operations.getSharedTournament, sharedView({ name: "Sunday Cup — Final" }));
  await settled();
  expect(host.textContent).toContain("Sunday Cup — Final");
});

test("shows standings once the tournament is completed", async () => {
  const host = mount(() => (
    <AppProviders>
      <SharePage />
    </AppProviders>
  ));
  const view = sharedView({ status: "completed" });
  if (view.bracket) {
    view.bracket.completed = true;
    view.bracket.standings = [
      { participantId: P.ada, placement: 1 },
      { participantId: P.alan, placement: 2 },
    ];
    view.bracket.championId = P.ada;
  }
  publishQuery(api.operations.getSharedTournament, view);
  await settled();

  expect(host.textContent).toContain("Standings");
  expect(host.textContent).toContain("Champion");
  expect([...host.querySelectorAll("tbody tr td")].map((c) => c.textContent?.trim())).toEqual([
    "1",
    "Ada",
    "2",
    "Alan",
  ]);
});
