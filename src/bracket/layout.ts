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
 * `fromKey` proceeds to `toKey`. Winner edges run from the source's right
 * edge to the target's left edge; loser edges leave the bottom and enter
 * the top, reading as vertical drops into the losers bracket (renderers
 * dash them). When both slots of a match are fed by the same source match
 * (the grand-final reset, and the 2-participant grand final) the pair
 * collapses into one ordinary winner edge — the whole match moves forward,
 * so one connector reads better than a solid and a dashed line side by
 * side.
 *
 * @public
 */
export interface BracketEdge {
  fromKey: string;
  toKey: string;
  kind: "winner" | "loser";
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

type MatchAt = (bracket: BracketSectionName, round: number, indexInRound: number) => LayoutMatch;

function winnersFeeds(round: number, i: number, at: MatchAt): Feed[] {
  if (round === 1) return [];
  return [
    { source: at("winners", round - 1, i * 2), kind: "winner" },
    { source: at("winners", round - 1, i * 2 + 1), kind: "winner" },
  ];
}

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

// The read-side mirror of the format engine's slot wiring, reconstructed
// from coordinates alone (the derived view exposes no slots). Kept in
// lockstep by layout.engine-parity.test.ts.
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

function dedupeFeeds(feeds: Feed[]): Feed[] {
  const [first, second] = feeds;
  if (first !== undefined && second !== undefined && first.source.key === second.source.key) {
    return [{ source: first.source, kind: "winner" }];
  }
  return feeds;
}

function edgeBetween(kind: Feed["kind"], source: BracketCard, target: BracketCard): BracketEdge {
  return kind === "winner"
    ? {
        fromKey: source.key,
        toKey: target.key,
        kind,
        from: { x: source.x + CARD_WIDTH, y: source.y + CARD_HEIGHT / 2 },
        to: { x: target.x, y: target.y + CARD_HEIGHT / 2 },
      }
    : {
        fromKey: source.key,
        toKey: target.key,
        kind,
        from: { x: source.x + CARD_WIDTH / 2, y: source.y + CARD_HEIGHT },
        to: { x: target.x + CARD_WIDTH / 2, y: target.y },
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
  const feeds = (match: LayoutMatch): Feed[] =>
    dedupeFeeds(feedsOf(match, byPosition, roundSizes, maxRound));

  const grandFinalBase = Math.max(maxRound.winners, maxRound.losers);
  const columnOf = (match: LayoutMatch): number =>
    match.bracket === "grand_final" ? grandFinalBase + match.round - 1 : match.round - 1;

  const cardByKey = new Map<string, BracketCard>();
  const cards: BracketCard[] = [];
  let winnersBottom = 0;

  for (const match of sorted) {
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
