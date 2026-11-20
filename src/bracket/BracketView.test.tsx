import { createSignal, flush } from "solid-js";
import { expect, test } from "vite-plus/test";
import { mount } from "../test-setup";
import { AppProviders } from "../providers";
import { BracketView, type BracketViewProps, type ViewMatch } from "./BracketView";

localStorage.setItem("cobracket:locale", "en");

const PARTICIPANTS = [
  { participantId: "p1", name: "Ada" },
  { participantId: "p2", name: "Grace" },
  { participantId: "p3", name: "Alan" },
  { participantId: "p4", name: "Edsger" },
];

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
  return mount(() => (
    <AppProviders>
      <BracketView {...props()} />
    </AppProviders>
  ));
}

function cardLabels(host: HTMLElement): string[] {
  return [...host.querySelectorAll("button[style*='--card-x']")].map((card) =>
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
  const before = host.querySelector("button[style*='--card-x']");

  setMatches(semisAndFinal());
  flush();

  expect(host.querySelector("button[style*='--card-x']")).toBe(before);

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

  for (const card of host.querySelectorAll<HTMLButtonElement>("button[style*='--card-x']")) {
    card.click();
  }
  flush();

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
  const canvas = viewport.firstElementChild as HTMLElement;
  const geometry = () => ({
    x: canvas.style.getPropertyValue("--pan-x"),
    y: canvas.style.getPropertyValue("--pan-y"),
    zoom: canvas.style.getPropertyValue("--zoom"),
  });
  const before = cardLabels(host);

  host.querySelector<HTMLButtonElement>("button[aria-label='Zoom in']")?.click();
  flush();
  expect(geometry().zoom).toBe("1.25");

  drag(viewport, [100, 100], [140, 70]);
  expect(geometry()).toMatchObject({ x: "64px", y: "-6px" });

  viewport.dispatchEvent(
    new PointerEvent("pointermove", { pointerId: 1, bubbles: true, clientX: 300, clientY: 300 }),
  );
  flush();
  expect(geometry()).toMatchObject({ x: "64px", y: "-6px" });

  host.querySelector<HTMLButtonElement>("button[aria-label='Reset view']")?.click();
  flush();
  expect(geometry()).toEqual({ x: "24px", y: "24px", zoom: "1" });
  expect(cardLabels(host)).toEqual(before);
});

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

test("a tournament-sized bracket costs the list no per-row subscription", () => {
  const [matches, setMatches] = createSignal(bigBracket(), { name: "matches" });
  const host = mountBracket(() => ({
    matches: matches(),
    participants: MANY_PARTICIPANTS,
    readyMatchKeys: ["w1m0"],
    voidedMatchKeys: [],
  }));
  expect(host.querySelectorAll("button[style*='--card-x']")).toHaveLength(31);
  const before = host.querySelector("button[style*='--card-x']");

  setMatches(bigBracket());
  flush();

  expect(host.querySelector("button[style*='--card-x']")).toBe(before);
  expect(host.querySelectorAll("button[style*='--card-x']")).toHaveLength(31);
});
