import { SenderError, t } from "spacetimedb/server";
import type { DbSide } from "./lib";
import {
  MAX_RESULTS,
  deriveOrThrow,
  formatToEngine,
  generateOrThrow,
  invalidateBracket,
  loadBracket,
  loadResults,
  loadRoster,
  requireEvent,
  requireEventAllowed,
  requireOwnedMatch,
  requireOwnedTournament,
  requireOwnedTournamentIn,
  sideToEngine,
  slotToDb,
  toRecordedResults,
  updateTournamentStatus,
} from "./lib";
import { transitionStatus } from "../lifecycle";
import { ResultSide, spacetimedb } from "./schema";

// Generate — or regenerate, freely until the first result locks the
// structure (story 10). Random seeding (the default) reshuffles on
// every generation; manual seeding (set by reorderSeeding) uses the
// stored order. The shuffle is ctx.random's unbiased Fisher-Yates.
// One platform difference from Math.random: the stream is
// seeded by the transaction timestamp, so two generations inside the
// same timestamp shuffle identically — reducer determinism requires
// exactly that.
export const generateBracket = spacetimedb.reducer({ tournamentId: t.u64() }, (ctx, args) => {
  const tournament = requireOwnedTournamentIn(
    ctx.db,
    ctx.sender,
    args.tournamentId,
    { type: "generateBracket" },
    "generate the bracket",
  );
  let roster = loadRoster(ctx.db, args.tournamentId);
  if (roster.length < 2) {
    throw new SenderError("At least two participants are required to generate a bracket");
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
  const tournament = requireOwnedTournament(ctx.db, ctx.sender, args.tournamentId);
  const next = requireEvent(tournament, { type: "publish" }, "publish");
  const bracket = loadBracket(ctx.db, tournament);
  if (bracket.matchDocs.length === 0) {
    throw new SenderError("Generate the bracket before publishing");
  }
  updateTournamentStatus(ctx.db, tournament, next);
});

function requireTwoSides(sides: readonly DbSide[]): [DbSide, DbSide] {
  const [sideA, sideB] = sides;
  if (sides.length !== 2 || sideA === undefined || sideB === undefined) {
    throw new SenderError("A result must have exactly two sides");
  }
  for (const side of sides) {
    // The wire admits every IEEE-754 double, including NaN and Infinity.
    if (side.score !== undefined && !Number.isFinite(side.score)) {
      throw new SenderError("A score must be a finite number");
    }
  }
  return [sideA, sideB];
}

// Recording and correcting are the same operation: results are
// append-only, and the latest record per match is the effective one.
// The reducer derives the progression with the candidate included,
// which validates it (outcome combination, pairing against current
// occupants) without reimplementing any engine logic. A query-side
// API would derive twice — before, to compute its voided return, and
// after, with the candidate; deriving only with the candidate is
// equivalent for every reducer-reachable history, because each prefix
// was validated when it was appended. The { status, voided } return
// has no reducer counterpart: the client reads the status from
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
    requireEventAllowed(tournament, "recordResult", "report a result");
    const sides = requireTwoSides(args.sides);
    const bracket = loadBracket(ctx.db, tournament);
    const resultDocs = loadResults(ctx.db, tournament.id);
    if (resultDocs.length >= MAX_RESULTS) {
      throw new SenderError(`A tournament can record at most ${MAX_RESULTS} results`);
    }
    const recorded = toRecordedResults(resultDocs, bracket);
    recorded.push({
      matchKey: match.key,
      sides: [sideToEngine(sides[0]), sideToEngine(sides[1])],
    });
    const progression = deriveOrThrow(bracket.structure, recorded);
    if (progression.voidedResultIndices.includes(recorded.length - 1)) {
      throw new SenderError("This result does not apply to the match's current participants");
    }
    const next = transitionStatus(tournament.status.tag, {
      type: "recordResult",
      completesTournament: progression.completed,
    });
    if (next === undefined) {
      throw new SenderError("Cannot correct: this would reopen a completed tournament");
    }
    let previousSides: DbSide[] = [];
    let previousId: bigint | undefined;
    for (const doc of resultDocs) {
      if (doc.matchId === args.matchId && (previousId === undefined || doc.id > previousId)) {
        previousId = doc.id;
        previousSides = [...doc.sides];
      }
    }
    ctx.db.result.insert({
      id: 0n,
      tournamentId: tournament.id,
      matchId: args.matchId,
      sides,
      recordedBy: tournament.userId,
      reportedAt: ctx.timestamp,
    });
    ctx.db.scoreChange.insert({
      id: 0n,
      tournamentId: tournament.id,
      matchId: args.matchId,
      changedBy: tournament.userId,
      changedAt: ctx.timestamp,
      previousSides,
      newSides: sides,
    });
    if (next !== tournament.status.tag) {
      updateTournamentStatus(ctx.db, tournament, next);
    }
  },
);
