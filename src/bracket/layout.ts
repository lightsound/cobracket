// Pure bracket layout (ADR 0007): (derived match coordinates) -> absolutely
// positioned cards plus connector edges, all serializable numbers. No DOM
// measurement — elimination geometry is closed-form, so slot arithmetic on
// (bracket, round, indexInRound) reconstructs who feeds whom for both MVP
// formats, mirroring the format engine's generators. Renderers (HTML cards +
// SVG overlay today; static SVG or text later) consume this data unchanged.

/**
 * @public
 */
export type BracketSectionName = "winners" | "losers" | "grand_final";

/**
 * @public
 */
export interface LayoutMatch {
  key: string;
  bracket: BracketSectionName;
  /** 1-based round within the bracket section. */
  round: number;
  /** 0-based position within the round. */
  indexInRound: number;
}

/**
 * @public
 */
export interface BracketCard {
  key: string;
  bracket: BracketSectionName;
  x: number;
  y: number;
}

/**
 * @public
 */
export interface LayoutPoint {
  x: number;
  y: number;
}

/**
 * A connector: the winner (or loser, for double-elimination drops) of
 * `fromKey` proceeds to `toKey`. `kind` is the semantic (renderers dash
 * loser edges); `direction` is the geometry: `forward` edges run from the
 * source's right edge to the target's left edge, `drop` edges leave the
 * bottom and enter the top, reading as vertical drops into the losers
 * bracket. A loser edge into a same-row target (the grand-final reset, and
 * the 2-participant grand final) is `forward`, entering along the target's
 * lower slot row.
 *
 * @public
 */
export interface BracketEdge {
  fromKey: string;
  toKey: string;
  kind: "winner" | "loser";
  direction: "forward" | "drop";
  from: LayoutPoint;
  to: LayoutPoint;
}

/**
 * @public
 */
export interface BracketLayout {
  width: number;
  height: number;
  cards: BracketCard[];
  edges: BracketEdge[];
}

/**
 * Fixed card dimensions (ADR 0007): participant names truncate, and small
 * screens pan/zoom via transform instead of reflowing.
 *
 * @public
 */
export const CARD_WIDTH = 220;

/**
 * @public
 */
export const CARD_HEIGHT = 76;

const GAP_X = 56;
const GAP_Y = 20;
const SECTION_GAP = 72;
const PITCH = CARD_HEIGHT + GAP_Y;

const SECTION_ORDER: Record<BracketSectionName, number> = {
  winners: 0,
  losers: 1,
  grand_final: 2,
};

interface Feed {
  source: LayoutMatch;
  kind: "winner" | "loser";
}

function positionKey(bracket: BracketSectionName, round: number, indexInRound: number): string {
  return `${bracket}:${round}:${indexInRound}`;
}

// Resolves feeder matches by position; a miss is a malformed structure.
type MatchAt = (bracket: BracketSectionName, round: number, indexInRound: number) => LayoutMatch;

function winnersFeeds(round: number, i: number, at: MatchAt): Feed[] {
  if (round === 1) return [];
  return [
    { source: at("winners", round - 1, i * 2), kind: "winner" },
    { source: at("winners", round - 1, i * 2 + 1), kind: "winner" },
  ];
}

// Losers rounds: round 1 pairs winners-round-1 losers; even round 2j is the
// drop-in round where losers of winners round j+1 enter (odd j reverses the
// drop order — see convex/format/doubleElimination); odd rounds >= 3 pair
// the previous drop-in round's survivors.
function losersFeeds(round: number, i: number, at: MatchAt, roundSize: number): Feed[] {
  if (round === 1) {
    return [
      { source: at("winners", 1, i * 2), kind: "loser" },
      { source: at("winners", 1, i * 2 + 1), kind: "loser" },
    ];
  }
  if (round % 2 === 0) {
    const j = round / 2;
    const dropIndex = j % 2 === 1 ? roundSize - 1 - i : i;
    return [
      { source: at("winners", j + 1, dropIndex), kind: "loser" },
      { source: at("losers", round - 1, i), kind: "winner" },
    ];
  }
  return [
    { source: at("losers", round - 1, i * 2), kind: "winner" },
    { source: at("losers", round - 1, i * 2 + 1), kind: "winner" },
  ];
}

// Grand final: round 1 pairs the winners-side finalist with the losers
// finalist (or, with no losers bracket, the loser of the only winners
// match); round 2 is the bracket-reset replay of round 1.
function grandFinalFeeds(
  round: number,
  at: MatchAt,
  maxWinners: number,
  maxLosers: number,
): Feed[] {
  if (round === 1) {
    return [
      { source: at("winners", maxWinners, 0), kind: "winner" },
      maxLosers > 0
        ? { source: at("losers", maxLosers, 0), kind: "winner" }
        : { source: at("winners", 1, 0), kind: "loser" },
    ];
  }
  return [
    { source: at("grand_final", 1, 0), kind: "winner" },
    { source: at("grand_final", 1, 0), kind: "loser" },
  ];
}

/**
 * Reconstructs which matches feed this one, from coordinates alone. This is
 * the read-side mirror of the engine's generators (buildWinnersBracket /
 * buildLosersBracket / the grand-final wiring in convex/format).
 */
function feedsOf(
  match: LayoutMatch,
  byPosition: Map<string, LayoutMatch>,
  roundSizes: Map<string, number>,
  maxRound: Record<BracketSectionName, number>,
): Feed[] {
  const at: MatchAt = (bracket, round, indexInRound) => {
    const source = byPosition.get(positionKey(bracket, round, indexInRound));
    if (source === undefined) {
      throw new Error(
        `layoutBracket: match "${match.key}" expects a feeder at ${bracket} round ${round} index ${indexInRound}`,
      );
    }
    return source;
  };
  const { bracket, round, indexInRound: i } = match;
  if (bracket === "winners") return winnersFeeds(round, i, at);
  if (bracket === "losers") {
    return losersFeeds(round, i, at, roundSizes.get(positionKey(bracket, round, 0)) ?? 0);
  }
  return grandFinalFeeds(round, at, maxRound.winners, maxRound.losers);
}

// Entry rounds (winners round 1, losers round 1) stack by index; every
// later match centers on its in-section feeders (drop-in rounds track their
// losers-side feeder so the drop reads as a straight line); the grand final
// centers between the two finalists it collects.
function cardYOf(match: LayoutMatch, feedCards: BracketCard[], sectionTop: number): number {
  const inSection = feedCards.filter((card) => card.bracket === match.bracket);
  if (inSection.length > 0) {
    return inSection.reduce((sum, card) => sum + card.y, 0) / inSection.length;
  }
  if (feedCards.length > 0 && match.bracket === "grand_final") {
    return feedCards.reduce((sum, card) => sum + card.y, 0) / feedCards.length;
  }
  return sectionTop + match.indexInRound * PITCH;
}

// The lower slot row: where a same-row loser edge enters its target (the
// loser occupies the target's second slot).
const LOWER_SLOT_Y = (CARD_HEIGHT * 3) / 4;

// Winner edges run right edge to left edge. Loser edges drop bottom-to-top
// when the target sits below (the losers band); a loser edge to a same-row
// target runs forward along the lower slot row instead.
function edgeBetween(kind: Feed["kind"], source: BracketCard, target: BracketCard): BracketEdge {
  const identity = { fromKey: source.key, toKey: target.key, kind };
  if (kind === "winner") {
    return {
      ...identity,
      direction: "forward",
      from: { x: source.x + CARD_WIDTH, y: source.y + CARD_HEIGHT / 2 },
      to: { x: target.x, y: target.y + CARD_HEIGHT / 2 },
    };
  }
  if (target.y >= source.y + CARD_HEIGHT) {
    return {
      ...identity,
      direction: "drop",
      from: { x: source.x + CARD_WIDTH / 2, y: source.y + CARD_HEIGHT },
      to: { x: target.x + CARD_WIDTH / 2, y: target.y },
    };
  }
  return {
    ...identity,
    direction: "forward",
    from: { x: source.x + CARD_WIDTH, y: source.y + LOWER_SLOT_Y },
    to: { x: target.x, y: target.y + LOWER_SLOT_Y },
  };
}

/**
 * Lay out a bracket: winners section on top, losers below it, grand final
 * in its own columns to the right of both. Cards come out in
 * (section, round, indexInRound) order, so the first card of a section is
 * that section's top row.
 *
 * @public
 */
export function layoutBracket(matches: readonly LayoutMatch[]): BracketLayout {
  const sorted = [...matches].sort(
    (a, b) =>
      SECTION_ORDER[a.bracket] - SECTION_ORDER[b.bracket] ||
      a.round - b.round ||
      a.indexInRound - b.indexInRound,
  );

  const byPosition = new Map<string, LayoutMatch>();
  const roundSizes = new Map<string, number>();
  const maxRound: Record<BracketSectionName, number> = { winners: 0, losers: 0, grand_final: 0 };
  for (const match of sorted) {
    byPosition.set(positionKey(match.bracket, match.round, match.indexInRound), match);
    const sizeKey = positionKey(match.bracket, match.round, 0);
    roundSizes.set(sizeKey, (roundSizes.get(sizeKey) ?? 0) + 1);
    maxRound[match.bracket] = Math.max(maxRound[match.bracket], match.round);
  }
  const feeds = (match: LayoutMatch): Feed[] => feedsOf(match, byPosition, roundSizes, maxRound);

  // Column per (section, round); the grand final starts after both sections.
  const grandFinalBase = Math.max(maxRound.winners, maxRound.losers);
  const columnOf = (match: LayoutMatch): number =>
    match.bracket === "grand_final" ? grandFinalBase + match.round - 1 : match.round - 1;

  const cardByKey = new Map<string, BracketCard>();
  const cards: BracketCard[] = [];
  let winnersBottom = 0;

  for (const match of sorted) {
    // Processing in (section, round) order guarantees feeders are laid out
    // before their dependents, for well-formed structures.
    const feedCards = feeds(match).map((feed) => cardByKey.get(feed.source.key)!);
    const sectionTop = match.bracket === "losers" ? winnersBottom + SECTION_GAP : 0;
    const card: BracketCard = {
      key: match.key,
      bracket: match.bracket,
      x: columnOf(match) * (CARD_WIDTH + GAP_X),
      y: cardYOf(match, feedCards, sectionTop),
    };
    cards.push(card);
    cardByKey.set(match.key, card);
    if (match.bracket === "winners") {
      winnersBottom = Math.max(winnersBottom, card.y + CARD_HEIGHT);
    }
  }

  const edges = sorted.flatMap((match) =>
    feeds(match).map((feed) =>
      edgeBetween(feed.kind, cardByKey.get(feed.source.key)!, cardByKey.get(match.key)!),
    ),
  );

  const width = cards.reduce((max, card) => Math.max(max, card.x + CARD_WIDTH), 0);
  const height = cards.reduce((max, card) => Math.max(max, card.y + CARD_HEIGHT), 0);
  return { width, height, cards, edges };
}
