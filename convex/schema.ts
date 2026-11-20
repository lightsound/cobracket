import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Recorded results are the source of truth: docs/adr/0005-results-are-the-source-of-truth.md.

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

// The schema keeps the full outcome range, draws included: docs/adr/0002-format-scope-five-families-no-custom.md.
const outcome = v.union(
  v.literal("win"),
  v.literal("loss"),
  v.literal("draw"),
  v.literal("walkover"),
  v.literal("disqualification"),
);

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
  users: defineTable({}),

  disciplines: defineTable({
    name: v.string(),
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
    visibility: v.union(v.literal("public"), v.literal("unlisted"), v.literal("private")),
    // How generateBracket assigns seeds. "random" (the default) reshuffles on
    // every generation; manual reordering pins the stored order. Optional so
    // the field stays additive: absent means "random".
    seeding: v.optional(v.union(v.literal("random"), v.literal("manual"))),
    // The Share Link identifier: a crypto-random token minted at creation.
    // An unlisted tournament's URL is its only guard, so the public surface
    // gets its own unguessable name instead of reusing the document id.
    shareSlug: v.string(),
  })
    .index("by_organizer", ["organizerId"])
    .index("by_share_slug", ["shareSlug"]),

  participants: defineTable({
    tournamentId: v.id("tournaments"),
    name: v.string(),
    seed: v.number(),
  }).index("by_tournament", ["tournamentId"]),

  matches: defineTable({
    tournamentId: v.id("tournaments"),
    key: v.string(),
    bracket: v.union(v.literal("winners"), v.literal("losers"), v.literal("grand_final")),
    round: v.number(),
    indexInRound: v.number(),
    slots: v.array(slotSource),
  }).index("by_tournament", ["tournamentId"]),

  // Results are append-only: docs/adr/0005-results-are-the-source-of-truth.md.
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
    recordedBy: v.id("users"),
  })
    .index("by_tournament", ["tournamentId"])
    .index("by_match", ["matchId"]),
});
