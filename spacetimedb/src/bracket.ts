import { t } from "spacetimedb/server";
import type { DbSide, TournamentStatusTag } from "./lib";
import {
  MAX_RESULTS,
  PRE_LIVE,
  deriveOrThrow,
  formatToEngine,
  generateOrThrow,
  invalidateBracket,
  loadBracket,
  loadResults,
  loadRoster,
  requireOwnedMatch,
  requireOwnedTournamentIn,
  requireStatus,
  sideToEngine,
  slotToDb,
  toRecordedResults,
} from "./lib";
import { ResultSide, spacetimedb } from "./schema";

// Bracket generation, publishing, and result recording (stories
// 9–14, ADR 0005), the successor of convex/bracket.ts.

// Generate — or regenerate, freely until the first result locks the
// structure (story 10). Random seeding (the default) reshuffles on
// every generation; manual seeding (set by reorderSeeding) uses the
// stored order. The shuffle is ctx.random's unbiased Fisher-Yates —
// the platform form of Convex's Math.random hand-roll, at the same
// call site. One platform difference from Math.random: the stream is
// seeded by the transaction timestamp, so two generations inside the
// same timestamp shuffle identically — reducer determinism requires
// exactly that.
export const generateBracket = spacetimedb.reducer({ tournamentId: t.u64() }, (ctx, args) => {
  const tournament = requireOwnedTournamentIn(
    ctx.db,
    ctx.sender,
    args.tournamentId,
    PRE_LIVE,
    "generate the bracket",
  );
  let roster = loadRoster(ctx.db, args.tournamentId);
  if (roster.length < 2) {
    throw new Error("At least two participants are required to generate a bracket");
  }
  if ((tournament.seeding?.tag ?? "random") === "random") {
    roster = ctx.random.shuffle(roster);
    for (const [index, participant] of roster.entries()) {
      if (participant.seed !== index + 1) {
        ctx.db.participant.id.update({ ...participant, seed: index + 1 });
      }
    }
  }
  const structure = generateOrThrow(
    roster.map((participant) => String(participant.id)),
    formatToEngine(tournament.format),
  );
  invalidateBracket(ctx.db, args.tournamentId);
  for (const match of structure.matches) {
    ctx.db.match.insert({
      id: 0n,
      tournamentId: args.tournamentId,
      key: match.key,
      bracket: { tag: match.bracket },
      round: match.round,
      indexInRound: match.indexInRound,
      slots: match.slots.map(slotToDb),
    });
  }
});

export const publishTournament = spacetimedb.reducer({ tournamentId: t.u64() }, (ctx, args) => {
  const tournament = requireOwnedTournamentIn(
    ctx.db,
    ctx.sender,
    args.tournamentId,
    ["draft"],
    "publish",
  );
  const bracket = loadBracket(ctx.db, tournament);
  if (bracket.matchDocs.length === 0) {
    // Published means the bracket is visible on the Share Link; there
    // must be one to show.
    throw new Error("Generate the bracket before publishing");
  }
  ctx.db.tournament.id.update({ ...tournament, status: { tag: "published" } });
});

// ---------------------------------------------------------------------------
// Result recording and correction (stories 12–14, ADR 0005)
// ---------------------------------------------------------------------------

function requireTwoSides(sides: readonly DbSide[]): [DbSide, DbSide] {
  const [sideA, sideB] = sides;
  if (sides.length !== 2 || sideA === undefined || sideB === undefined) {
    throw new Error("A result must have exactly two sides");
  }
  for (const side of sides) {
    // The wire admits every IEEE-754 double, including NaN and Infinity.
    if (side.score !== undefined && !Number.isFinite(side.score)) {
      throw new Error("A score must be a finite number");
    }
  }
  return [sideA, sideB];
}

// The automatic transitions a recorded result can cause: the first
// result flips published to live (story 12), and a resolved final
// completes the tournament (story 16). Always forward — the lifecycle
// is one-way.
function statusAfterResult(current: TournamentStatusTag, completed: boolean): TournamentStatusTag {
  if (completed) {
    return "completed";
  }
  return current === "published" ? "live" : current;
}

// Recording and correcting are the same operation: results are
// append-only, and the latest record per match is the effective one.
// The reducer derives the progression with the candidate included,
// which validates it (outcome combination, pairing against current
// occupants) without reimplementing any engine logic. Convex derived
// twice — before, to compute its voided return, and after, with the
// candidate; deriving only with the candidate is equivalent for
// every reducer-reachable history, because each prefix was validated
// when it was appended. Convex's return of { status, voided } has no
// reducer counterpart: the client reads the status from
// organizer_tournament and the voided set from the composed
// progression (voidedMatchKeys), both re-derived from the same
// append-only records.
export const reportResult = spacetimedb.reducer(
  { matchId: t.u64(), sides: t.array(ResultSide) },
  (ctx, args) => {
    const { match, tournament } = requireOwnedMatch(ctx.db, ctx.sender, args.matchId);
    // First result in published flips to live; corrections in completed
    // are allowed only when they keep the tournament completed (the
    // lifecycle is one-way, so a correction may never reopen play).
    requireStatus(tournament, ["published", "live", "completed"], "report a result");
    const sides = requireTwoSides(args.sides);
    const bracket = loadBracket(ctx.db, tournament);
    const resultDocs = loadResults(ctx.db, tournament.id);
    if (resultDocs.length >= MAX_RESULTS) {
      throw new Error(`A tournament can record at most ${MAX_RESULTS} results`);
    }
    const recorded = toRecordedResults(resultDocs, bracket);
    // The candidate is validated by the same derivation that computes
    // the voided set; whether it voided anything is observable through
    // the composed progression, so only the refusal matters here.
    recorded.push({
      matchKey: match.key,
      sides: [sideToEngine(sides[0]), sideToEngine(sides[1])],
    });
    const progression = deriveOrThrow(bracket.structure, recorded);
    if (progression.voidedResultIndices.includes(recorded.length - 1)) {
      // The candidate did not decide its match: wrong participants, a
      // bye-resolved match, or a cancelled one.
      throw new Error("This result does not apply to the match's current participants");
    }
    if (tournament.status.tag === "completed" && !progression.completed) {
      throw new Error("Cannot correct: this would reopen a completed tournament");
    }
    ctx.db.result.insert({
      id: 0n,
      tournamentId: tournament.id,
      matchId: args.matchId,
      sides,
      // The actor (ADR 0005). requireOwnedMatch verified the caller IS
      // the organizer; future self-reporting records the resolved
      // caller instead.
      recordedBy: tournament.userId,
      reportedAt: ctx.timestamp,
    });
    const status = statusAfterResult(tournament.status.tag, progression.completed);
    if (status !== tournament.status.tag) {
      ctx.db.tournament.id.update({ ...tournament, status: { tag: status } });
    }
  },
);
