import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { BracketStructure } from "./format";
import { generateBracket as generateBracketStructure } from "./format";
import type { ResultSide, TournamentStatus } from "./model";
import {
  MAX_RESULTS,
  PRE_LIVE,
  castParticipantId,
  deriveOrThrow,
  invalidateBracket,
  loadBracket,
  loadResults,
  loadRoster,
  requireOwnedMatch,
  requireOwnedTournamentIn,
  requireStatus,
  resultSideValidator,
  rethrowEngineError,
  statusValidator,
  toRecordedResults,
} from "./model";

// Bracket generation, publishing, and result recording (stories 9–14,
// ADR 0005).

function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

// Generate — or regenerate, freely until the first result locks the
// structure (story 10). Random seeding (the default) reshuffles on every
// generation; manual seeding (set by reorderSeeding) uses the stored order.
export const generateBracket = mutation({
  args: { tournamentId: v.id("tournaments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tournament = await requireOwnedTournamentIn(
      ctx,
      args.tournamentId,
      PRE_LIVE,
      "generate the bracket",
    );
    let roster = await loadRoster(ctx, args.tournamentId);
    if (roster.length < 2) {
      throw new ConvexError("At least two participants are required to generate a bracket");
    }
    if ((tournament.seeding ?? "random") === "random") {
      roster = shuffled(roster);
      for (const [index, participant] of roster.entries()) {
        if (participant.seed !== index + 1) {
          await ctx.db.patch("participants", participant._id, { seed: index + 1 });
        }
      }
    }
    let structure: BracketStructure;
    try {
      structure = generateBracketStructure(
        roster.map((participant) => participant._id),
        tournament.format,
      );
    } catch (error) {
      rethrowEngineError(error);
    }
    await invalidateBracket(ctx, args.tournamentId);
    for (const match of structure.matches) {
      await ctx.db.insert("matches", {
        tournamentId: args.tournamentId,
        key: match.key,
        bracket: match.bracket,
        round: match.round,
        indexInRound: match.indexInRound,
        // The engine's participant ids are the roster's document ids we just
        // passed in; the validator re-checks them on insert.
        slots: match.slots.map((slot) =>
          slot.kind === "participant"
            ? { kind: "participant" as const, participantId: castParticipantId(slot.participantId) }
            : slot,
        ),
      });
    }
    return null;
  },
});

export const publishTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tournament = await requireOwnedTournamentIn(ctx, args.tournamentId, ["draft"], "publish");
    const bracket = await loadBracket(ctx, tournament);
    if (bracket.matchDocs.length === 0) {
      // Published means the bracket is visible on the Share Link; there must
      // be one to show.
      throw new ConvexError("Generate the bracket before publishing");
    }
    await ctx.db.patch("tournaments", args.tournamentId, { status: "published" });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Result recording and correction (stories 12–14, ADR 0005)
// ---------------------------------------------------------------------------

function requireTwoSides(sides: readonly ResultSide[]): [ResultSide, ResultSide] {
  const [sideA, sideB] = sides;
  if (sides.length !== 2 || sideA === undefined || sideB === undefined) {
    throw new ConvexError("A result must have exactly two sides");
  }
  for (const side of sides) {
    // v.number() admits every IEEE-754 double, including NaN and Infinity.
    if (side.score !== undefined && !Number.isFinite(side.score)) {
      throw new ConvexError("A score must be a finite number");
    }
  }
  return [sideA, sideB];
}

// The automatic transitions a recorded result can cause: the first result
// flips published to live (story 12), and a resolved final completes the
// tournament (story 16). Always forward — the lifecycle is one-way.
function statusAfterResult(current: TournamentStatus, completed: boolean): TournamentStatus {
  if (completed) {
    return "completed";
  }
  return current === "published" ? "live" : current;
}

// Recording and correcting are the same operation: results are append-only,
// and the latest record per match is the effective one. The mutation derives
// the progression with the candidate included, which validates it (outcome
// combination, pairing against current occupants) without reimplementing any
// engine logic, and reports every downstream result the append voided.
export const reportResult = mutation({
  args: {
    matchId: v.id("matches"),
    sides: v.array(resultSideValidator),
  },
  returns: v.object({
    status: statusValidator,
    // Downstream results a correction invalidated; their matches are open
    // again and must be re-entered (spec: Implementation Decisions).
    voided: v.array(v.object({ matchId: v.id("matches"), matchKey: v.string() })),
  }),
  handler: async (ctx, args) => {
    const { match, tournament } = await requireOwnedMatch(ctx, args.matchId);
    // First result in published flips to live; corrections in completed are
    // allowed only when they keep the tournament completed (the lifecycle is
    // one-way, so a correction may never reopen play).
    requireStatus(tournament, ["published", "live", "completed"], "report a result");
    const sides = requireTwoSides(args.sides);
    const bracket = await loadBracket(ctx, tournament);
    const resultDocs = await loadResults(ctx, tournament._id);
    if (resultDocs.length >= MAX_RESULTS) {
      throw new ConvexError(`A tournament can record at most ${MAX_RESULTS} results`);
    }
    const recorded = toRecordedResults(resultDocs, bracket);
    // Results already void before this append (voided by an earlier
    // correction, still awaiting re-entry) are not news; the return value
    // reports only what THIS append invalidated.
    const alreadyVoided = new Set(
      recorded.length > 0 ? deriveOrThrow(bracket.structure, recorded).voidedResultIndices : [],
    );
    const candidateIndex = recorded.length;
    recorded.push({ matchKey: match.key, sides });
    const progression = deriveOrThrow(bracket.structure, recorded);
    if (progression.voidedResultIndices.includes(candidateIndex)) {
      // The candidate did not decide its match: wrong participants, a
      // bye-resolved match, or a cancelled one.
      throw new ConvexError("This result does not apply to the match's current participants");
    }
    if (tournament.status === "completed" && !progression.completed) {
      throw new ConvexError("Cannot correct: this would reopen a completed tournament");
    }
    await ctx.db.insert("results", {
      tournamentId: tournament._id,
      matchId: args.matchId,
      sides: args.sides,
      // The actor (ADR 0005). requireOwnedMatch verified the caller IS the
      // organizer; future self-reporting records the resolved caller instead.
      recordedBy: tournament.organizerId,
    });
    const status = statusAfterResult(tournament.status, progression.completed);
    if (status !== tournament.status) {
      await ctx.db.patch("tournaments", tournament._id, { status });
    }
    const voided = progression.voidedResultIndices
      .filter((index) => index !== candidateIndex && !alreadyVoided.has(index))
      .map((index) => {
        const doc = resultDocs[index]!;
        return { matchId: doc.matchId, matchKey: bracket.byId.get(doc.matchId)!.key };
      });
    return { status, voided };
  },
});
