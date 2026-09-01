import { describe, expect, test } from "vite-plus/test";
import { CARD_HEIGHT, CARD_WIDTH, layoutBracket } from "./layout";
import type { BracketEdge, LayoutMatch } from "./layout";

const GAP_X = 56;
const SECTION_GAP = 72;
const PITCH = CARD_HEIGHT + 20;
const COLUMN = CARD_WIDTH + GAP_X;

function winnersMatches(size: number): LayoutMatch[] {
  const rounds = Math.log2(size);
  const matches: LayoutMatch[] = [];
  for (let round = 1; round <= rounds; round++) {
    for (let index = 0; index < size / 2 ** round; index++) {
      matches.push({
        key: `w${round}m${index + 1}`,
        bracket: "winners",
        round,
        indexInRound: index,
      });
    }
  }
  return matches;
}

function doubleElim8(): LayoutMatch[] {
  const losers: LayoutMatch[] = [];
  for (const [round, count] of [
    [1, 2],
    [2, 2],
    [3, 1],
    [4, 1],
  ] as const) {
    for (let index = 0; index < count; index++) {
      losers.push({ key: `l${round}m${index + 1}`, bracket: "losers", round, indexInRound: index });
    }
  }
  return [
    ...winnersMatches(8),
    ...losers,
    { key: "gf", bracket: "grand_final", round: 1, indexInRound: 0 },
    { key: "gfr", bracket: "grand_final", round: 2, indexInRound: 0 },
  ];
}

function cardOf(layout: ReturnType<typeof layoutBracket>, key: string) {
  const card = layout.cards.find((candidate) => candidate.key === key);
  expect(card, `card ${key}`).toBeDefined();
  return card!;
}

function edgeOf(
  layout: ReturnType<typeof layoutBracket>,
  fromKey: string,
  toKey: string,
  kind: BracketEdge["kind"] = "winner",
): BracketEdge {
  const edge = layout.edges.find(
    (candidate) =>
      candidate.fromKey === fromKey && candidate.toKey === toKey && candidate.kind === kind,
  );
  expect(edge, `edge ${fromKey} -[${kind}]-> ${toKey}`).toBeDefined();
  return edge!;
}

describe("single elimination", () => {
  test("a 2-participant bracket is one card and no edges", () => {
    const layout = layoutBracket(winnersMatches(2));
    expect(layout.cards).toEqual([{ key: "w1m1", bracket: "winners", x: 0, y: 0 }]);
    expect(layout.edges).toEqual([]);
    expect(layout.width).toBe(CARD_WIDTH);
    expect(layout.height).toBe(CARD_HEIGHT);
  });

  test("an 8-participant bracket stacks round 1 and centers later rounds on their feeders", () => {
    const layout = layoutBracket(winnersMatches(8));
    expect(layout.cards).toHaveLength(7);

    for (const [key, column] of [
      ["w1m1", 0],
      ["w2m1", 1],
      ["w3m1", 2],
    ] as const) {
      expect(cardOf(layout, key).x).toBe(column * COLUMN);
    }

    expect(layout.cards.filter((card) => card.key.startsWith("w1")).map((card) => card.y)).toEqual([
      0,
      PITCH,
      2 * PITCH,
      3 * PITCH,
    ]);
    expect(cardOf(layout, "w2m1").y).toBe(PITCH / 2);
    expect(cardOf(layout, "w2m2").y).toBe(2.5 * PITCH);
    expect(cardOf(layout, "w3m1").y).toBe(1.5 * PITCH);

    expect(layout.edges).toHaveLength(6);
    expect(layout.edges.every((edge) => edge.kind === "winner")).toBe(true);
    const finalFeed = edgeOf(layout, "w2m1", "w3m1");
    expect(finalFeed.from).toEqual({
      x: cardOf(layout, "w2m1").x + CARD_WIDTH,
      y: cardOf(layout, "w2m1").y + CARD_HEIGHT / 2,
    });
    expect(finalFeed.to).toEqual({
      x: cardOf(layout, "w3m1").x,
      y: cardOf(layout, "w3m1").y + CARD_HEIGHT / 2,
    });
  });

  test("the layout does not depend on input order", () => {
    const matches = winnersMatches(8);
    const reversed = [...matches].reverse();
    expect(layoutBracket(reversed)).toEqual(layoutBracket(matches));
  });

  test("the layout is plain serializable data", () => {
    const layout = layoutBracket(winnersMatches(4));
    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout);
  });
});

describe("double elimination", () => {
  test("8 participants: losers sit in a band below winners, grand final after both", () => {
    const layout = layoutBracket(doubleElim8());
    expect(layout.cards).toHaveLength(15);

    const winnersBottom = Math.max(
      ...layout.cards
        .filter((card) => card.bracket === "winners")
        .map((card) => card.y + CARD_HEIGHT),
    );
    const losersTop = Math.min(
      ...layout.cards.filter((card) => card.bracket === "losers").map((card) => card.y),
    );
    expect(losersTop).toBe(winnersBottom + SECTION_GAP);

    expect(cardOf(layout, "l1m1").x).toBe(0);
    expect(cardOf(layout, "l4m1").x).toBe(3 * COLUMN);
    expect(cardOf(layout, "gf").x).toBe(4 * COLUMN);
    expect(cardOf(layout, "gfr").x).toBe(5 * COLUMN);

    const expectedGrandFinalY = (cardOf(layout, "w3m1").y + cardOf(layout, "l4m1").y) / 2;
    expect(cardOf(layout, "gf").y).toBe(expectedGrandFinalY);
    expect(cardOf(layout, "gfr").y).toBe(expectedGrandFinalY);
  });

  test("8 participants: drop edges mirror the engine's alternating drop-in order", () => {
    const layout = layoutBracket(doubleElim8());

    const dropEdges = layout.edges.filter((edge) => edge.kind === "loser");
    expect(dropEdges.map((edge) => `${edge.fromKey}->${edge.toKey}`).sort()).toEqual([
      "w1m1->l1m1",
      "w1m2->l1m1",
      "w1m3->l1m2",
      "w1m4->l1m2",
      "w2m1->l2m2",
      "w2m2->l2m1",
      "w3m1->l4m1",
    ]);

    const drop = edgeOf(layout, "w2m2", "l2m1", "loser");
    expect(drop.from).toEqual({
      x: cardOf(layout, "w2m2").x + CARD_WIDTH / 2,
      y: cardOf(layout, "w2m2").y + CARD_HEIGHT,
    });
    expect(drop.to).toEqual({
      x: cardOf(layout, "l2m1").x + CARD_WIDTH / 2,
      y: cardOf(layout, "l2m1").y,
    });

    edgeOf(layout, "w3m1", "gf", "winner");
    edgeOf(layout, "l4m1", "gf", "winner");

    const resetEdges = layout.edges.filter((edge) => edge.toKey === "gfr");
    expect(resetEdges).toHaveLength(1);
    expect(resetEdges[0]).toEqual({
      fromKey: "gf",
      toKey: "gfr",
      kind: "winner",
      from: {
        x: cardOf(layout, "gf").x + CARD_WIDTH,
        y: cardOf(layout, "gf").y + CARD_HEIGHT / 2,
      },
      to: {
        x: cardOf(layout, "gfr").x,
        y: cardOf(layout, "gfr").y + CARD_HEIGHT / 2,
      },
    });
  });

  test("2 participants: no losers bracket, the grand final takes the loser of the only match", () => {
    const layout = layoutBracket([
      ...winnersMatches(2),
      { key: "gf", bracket: "grand_final", round: 1, indexInRound: 0 },
      { key: "gfr", bracket: "grand_final", round: 2, indexInRound: 0 },
    ]);
    expect(cardOf(layout, "gf").x).toBe(COLUMN);
    expect(cardOf(layout, "gfr").x).toBe(2 * COLUMN);
    expect(layout.edges).toEqual([
      expect.objectContaining({ fromKey: "w1m1", toKey: "gf", kind: "winner" }),
      expect.objectContaining({ fromKey: "gf", toKey: "gfr", kind: "winner" }),
    ]);
  });
});
