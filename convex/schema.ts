import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Domain schema for the MVP standalone tournament (docs/specs/mvp.md).
// Recorded results are the source of truth (ADR 0005): bracket progression,
// current/next matches, and standings are derived by the format engine
// (convex/format/) inside queries, never stored.

// Where a participant slot's occupant comes from. Fixed at bracket
// generation; only results move the bracket after that. Slot references use
// the engine's structural match keys (stable strings scoped to one
// tournament) rather than document ids, so the generated structure can be
// inserted in one pass and mirrors the pure engine's output exactly.
const slotSource = v.union(
  v.object({
    kind: v.literal("participant"),
    participantId: v.id("participants"),
  }),
  v.object({ kind: v.literal("bye") }),
  v.object({ kind: v.literal("winnerOf"), matchKey: v.string() }),
  v.object({ kind: v.literal("loserOf"), matchKey: v.string() }),
);

// A participant's outcome in one match. The general form (CONTEXT.md
// "Match"): elimination formats reject draws at the engine level, but the
// schema keeps the full range so round robin and Swiss need no migration.
const outcome = v.union(
  v.literal("win"),
  v.literal("loss"),
  v.literal("draw"),
  v.literal("walkover"),
  v.literal("disqualification"),
);

// Format options, one member per family (ADR 0002). Adding round robin,
// Swiss, or group-into-playoffs later is an additive union member.
const format = v.union(
  v.object({ family: v.literal("single_elimination") }),
  v.object({
    family: v.literal("double_elimination"),
    // Grand-final bracket reset: the losers-side winner must beat the
    // winners-side winner twice. On by default at tournament creation.
    grandFinalReset: v.boolean(),
  }),
);

export default defineSchema({
  // Owned by the app, populated by Convex Auth v2 (preview): its
  // attachUserCallbacks createUser mutation inserts a row per (anonymous)
  // sign-in and returns v.id("users"). The auth module itself lands in a
  // separate task (ADR 0003); profile fields are added there as needed.
  users: defineTable({}),

  // Disciplines are freeform organizer input, stored as rows (not inline
  // strings) so aliases can be merged later with results following — a
  // future canonical/mergedInto pointer is an additive change.
  disciplines: defineTable({
    // Display form, as first entered (e.g. "Street Fighter 6").
    name: v.string(),
    // Lookup form for suggestions and dedup (e.g. lowercased/trimmed).
    normalizedName: v.string(),
  }).index("by_normalized_name", ["normalizedName"]),

  tournaments: defineTable({
    name: v.string(),
    organizerId: v.id("users"),
    disciplineId: v.id("disciplines"),
    format,
    // Per-tournament draw configuration ships in the schema but stays false
    // for both MVP formats (elimination requires a decisive outcome).
    drawsAllowed: v.boolean(),
    // draft: roster/seeding editable, bracket regenerable.
    // published: bracket visible on the Share Link.
    // live: first result recorded; roster and structure locked.
    // completed: final resolved (automatic).
    status: v.union(
      v.literal("draft"),
      v.literal("published"),
      v.literal("live"),
      v.literal("completed"),
    ),
    // MVP behavior is unlisted-only; the field exists from day one.
    visibility: v.union(v.literal("public"), v.literal("unlisted"), v.literal("private")),
  }).index("by_organizer", ["organizerId"]),

  // Tournament-local records (CONTEXT.md "Participant"). Kept unlinked to
  // any account on purpose; a future players table is referenced by adding
  // an optional playerId field, so claiming stays an additive change.
  participants: defineTable({
    tournamentId: v.id("tournaments"),
    name: v.string(),
    // 1-based seeding position — an input fixed at bracket generation
    // (random by default, manually reorderable while drafting).
    seed: v.number(),
  }).index("by_tournament", ["tournamentId"]),

  // Bracket structure, written once at generation time from the format
  // engine's output. Slots, byes, and seeding never change afterwards;
  // progression is derived from results.
  matches: defineTable({
    tournamentId: v.id("tournaments"),
    // Engine-assigned structural key, unique within the tournament.
    key: v.string(),
    bracket: v.union(v.literal("winners"), v.literal("losers"), v.literal("grand_final")),
    // 1-based round within the bracket section.
    round: v.number(),
    // 0-based position within the round.
    indexInRound: v.number(),
    // Exactly two slots for the MVP formats.
    slots: v.array(slotSource),
  })
    .index("by_tournament", ["tournamentId"])
    .index("by_tournament_key", ["tournamentId", "key"]),

  // Append-style result records (ADR 0005). Never patched or deleted: a
  // correction appends a newer record for the same match, and the latest
  // record per match is the effective one. Downstream records whose pairing
  // a correction invalidates are voided by derivation, not mutated.
  // The report timestamp is _creationTime.
  results: defineTable({
    tournamentId: v.id("tournaments"),
    matchId: v.id("matches"),
    // One entry per participant in the match, e.g. win/loss, win/walkover,
    // win/disqualification, draw/draw (where the format allows draws).
    // Exactly two sides is a hard engine contract for the MVP formats;
    // the format engine rejects any other arity at derivation time.
    sides: v.array(
      v.object({
        participantId: v.id("participants"),
        outcome,
        score: v.optional(v.number()),
      }),
    ),
    // The actor (ADR 0005): the Organizer in MVP. Future participant
    // self-reporting widens this additively.
    recordedBy: v.id("users"),
  })
    .index("by_tournament", ["tournamentId"])
    .index("by_match", ["matchId"]),

  // Template scaffolding, removed together with the demo UI in a later task.
  tasks: defineTable({
    text: v.string(),
    isCompleted: v.boolean(),
  }),
});
