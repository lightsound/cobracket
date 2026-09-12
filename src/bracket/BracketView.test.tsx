/**
 * BracketView under the diagnostics gate (src/test-setup.ts): every test here
 * also asserts, implicitly, that rendering and updating the bracket produces no
 * Solid diagnostic — no lost row identity, no untracked read, no wasted
 * recompute. That is the point of exercising it with the update shape the app
 * actually sees: Convex hands the page a whole new array of new objects on
 * every subscription push, so a `<For>` keyed by object identity would rebuild
 * every card, and only this kind of test can see that.
 */
import { createSignal, flush } from "solid-js";
import { expect, test } from "vite-plus/test";
import { mount } from "../test-setup";
import { setLocale } from "../i18n";
import { BracketView, type BracketViewProps, type ViewMatch } from "./BracketView";

setLocale("en");

const PARTICIPANTS = [
  { participantId: "p1", name: "Ada" },
  { participantId: "p2", name: "Grace" },
  { participantId: "p3", name: "Alan" },
  { participantId: "p4", name: "Edsger" },
];

/**
 * A 4-player single-elimination bracket, rebuilt from scratch on every call —
 * the way a fresh subscription payload arrives.
 */
function semisAndFinal(final: Partial<ViewMatch> = {}): ViewMatch[] {
  return [
    {
      key: "w1m1",
      bracket: "winners",
      round: 1,
      indexInRound: 0,
      state: "completed",
      occupants: [
        { kind: "participant", participantId: "p1" },
        { kind: "participant", participantId: "p2" },
      ],
      winnerId: "p1",
      loserId: "p2",
      sides: [
        { participantId: "p1", outcome: "win", score: 2 },
        { participantId: "p2", outcome: "loss", score: 1 },
      ],
    },
    {
      key: "w1m2",
      bracket: "winners",
      round: 1,
      indexInRound: 1,
      state: "completed",
      occupants: [
        { kind: "participant", participantId: "p3" },
        { kind: "participant", participantId: "p4" },
      ],
      winnerId: "p3",
      loserId: "p4",
      sides: [
        { participantId: "p3", outcome: "win", score: 2 },
        { participantId: "p4", outcome: "loss", score: 0 },
      ],
    },
    {
      key: "w2m1",
      bracket: "winners",
      round: 2,
      indexInRound: 0,
      state: "ready",
      occupants: [
        { kind: "participant", participantId: "p1" },
        { kind: "participant", participantId: "p3" },
      ],
      ...final,
    },
  ];
}

function mountBracket(props: () => BracketViewProps): HTMLElement {
  return mount(() => <BracketView {...props()} />);
}

function cardLabels(host: HTMLElement): string[] {
  return [...host.querySelectorAll("button[style*='translate']")].map((card) =>
    (card.textContent ?? "").trim(),
  );
}

test("renders every match with its participants, scores and ready marker", () => {
  const host = mountBracket(() => ({
    matches: semisAndFinal(),
    participants: PARTICIPANTS,
    readyMatchKeys: ["w2m1"],
    voidedMatchKeys: [],
  }));

  const labels = cardLabels(host);
  expect(labels).toHaveLength(3);
  expect(labels[0]).toContain("Ada");
  expect(labels[0]).toContain("Grace");
  expect(labels[0]).toContain("2");
  expect(labels[2]).toContain("Up next");
  // Every edge of the 4-player bracket: both semis feed the final.
  expect(host.querySelectorAll("svg path")).toHaveLength(2);
});

test("survives a refetch that replaces every match object", () => {
  const [matches, setMatches] = createSignal(semisAndFinal(), { name: "matches" });
  const [ready, setReady] = createSignal(["w2m1"], { name: "ready" });
  const host = mountBracket(() => ({
    matches: matches(),
    participants: PARTICIPANTS,
    readyMatchKeys: ready(),
    voidedMatchKeys: [],
  }));
  const before = host.querySelector("button[style*='translate']");

  // Same data, all-new objects — an idle subscription push.
  setMatches(semisAndFinal());
  flush();

  // Identity survived: the DOM node was updated in place, not rebuilt. The
  // gate catches the same mistake from the other side (UNSTABLE_LIST_IDENTITY).
  expect(host.querySelector("button[style*='translate']")).toBe(before);

  // And a real change still lands.
  setMatches(
    semisAndFinal({
      state: "completed",
      winnerId: "p1",
      loserId: "p3",
      sides: [
        { participantId: "p1", outcome: "win", score: 3 },
        { participantId: "p3", outcome: "loss", score: 2 },
      ],
    }),
  );
  setReady([]);
  flush();

  const final = cardLabels(host)[2] ?? "";
  expect(final).toContain("3");
  expect(final).not.toContain("Up next");
});

test("reports only the matches an organizer may score", () => {
  const selected: string[] = [];
  const host = mountBracket(() => ({
    matches: semisAndFinal(),
    participants: PARTICIPANTS,
    readyMatchKeys: ["w2m1"],
    voidedMatchKeys: [],
    onSelectMatch: (key) => selected.push(key),
  }));

  for (const card of host.querySelectorAll<HTMLButtonElement>("button[style*='translate']")) {
    card.click();
  }
  flush();

  // Two completed head-to-heads (correctable) plus the ready final.
  expect(selected).toEqual(["w1m1", "w1m2", "w2m1"]);
});

function drag(viewport: HTMLElement, from: [number, number], to: [number, number]): void {
  const init = { pointerId: 1, button: 0, bubbles: true };
  viewport.dispatchEvent(
    new PointerEvent("pointerdown", { ...init, clientX: from[0], clientY: from[1] }),
  );
  viewport.dispatchEvent(
    new PointerEvent("pointermove", { ...init, clientX: to[0], clientY: to[1] }),
  );
  viewport.dispatchEvent(new PointerEvent("pointerup", init));
  flush();
}

test("zooming and panning move the canvas without disturbing the cards", () => {
  const host = mountBracket(() => ({
    matches: semisAndFinal(),
    participants: PARTICIPANTS,
    readyMatchKeys: [],
    voidedMatchKeys: [],
  }));
  const viewport = host.firstElementChild as HTMLElement;
  // The pan/zoom canvas: the viewport's first child, holding the transform.
  const canvas = viewport.firstElementChild as HTMLElement;
  const before = cardLabels(host);

  host.querySelector<HTMLButtonElement>("button[aria-label='Zoom in']")?.click();
  flush();
  expect(canvas.style.transform).toContain("scale(1.25)");

  // Pan by a known delta. CANVAS_PADDING (24) is the untouched origin, so the
  // translate is the drag distance plus it.
  drag(viewport, [100, 100], [140, 70]);
  expect(canvas.style.transform).toContain("translate(64px, -6px)");

  // Released: further movement is not a drag.
  viewport.dispatchEvent(
    new PointerEvent("pointermove", { pointerId: 1, bubbles: true, clientX: 300, clientY: 300 }),
  );
  flush();
  expect(canvas.style.transform).toContain("translate(64px, -6px)");

  host.querySelector<HTMLButtonElement>("button[aria-label='Reset view']")?.click();
  flush();
  expect(canvas.style.transform).toContain("scale(1)");
  expect(canvas.style.transform).toContain("translate(24px, 24px)");
  expect(cardLabels(host)).toEqual(before);
});

/**
 * A 32-player single elimination: 16 + 8 + 4 + 2 + 1 = 31 matches, rebuilt
 * from scratch on every call like the fixtures above.
 */
function bigBracket(): ViewMatch[] {
  const matches: ViewMatch[] = [];
  for (let round = 1, count = 16; count >= 1; round++, count /= 2) {
    for (let index = 0; index < count; index++) {
      matches.push({
        key: `w${round}m${index}`,
        bracket: "winners",
        round,
        indexInRound: index,
        state: round === 1 ? "ready" : "pending",
        occupants:
          round === 1
            ? [
                { kind: "participant", participantId: `p${index * 2 + 1}` },
                { kind: "participant", participantId: `p${index * 2 + 2}` },
              ]
            : [{ kind: "unknown" }, { kind: "unknown" }],
      });
    }
  }
  return matches;
}

const MANY_PARTICIPANTS = Array.from({ length: 32 }, (_, index) => ({
  participantId: `p${index + 1}`,
  name: `Player ${index + 1}`,
}));

/**
 * The gate has scale-dependent codes, and the 3-match fixtures above cannot
 * reach them: [WIDE_SCOPE_DEPS] fires at 30 sources on one scope, so a
 * bracket has to be tournament-sized before a per-row cost shows up at all.
 * This is the case that caught the real one — a per-row `<Show>` narrowing
 * each card's match made every row a source of the list's insert effect, and
 * 15 matches were already enough to report it in the browser while every test
 * here passed. Keep this fixture above the threshold: it is the only thing
 * standing between a per-row reactive wrapper and a silent regression.
 */
test("a tournament-sized bracket costs the list no per-row subscription", () => {
  const [matches, setMatches] = createSignal(bigBracket(), { name: "matches" });
  const host = mountBracket(() => ({
    matches: matches(),
    participants: MANY_PARTICIPANTS,
    readyMatchKeys: ["w1m0"],
    voidedMatchKeys: [],
  }));
  expect(host.querySelectorAll("button[style*='translate']")).toHaveLength(31);
  const before = host.querySelector("button[style*='translate']");

  // A subscription push with all-new objects, at scale.
  setMatches(bigBracket());
  flush();

  expect(host.querySelector("button[style*='translate']")).toBe(before);
  expect(host.querySelectorAll("button[style*='translate']")).toHaveLength(31);
});
