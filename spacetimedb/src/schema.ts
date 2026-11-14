import { schema, table, t } from "spacetimedb/server";

// Domain schema for the MVP standalone tournament (docs/specs/mvp.md),
// the SpacetimeDB form of convex/schema.ts (ADR 0031). Recorded results
// are the source of truth (ADR 0005): bracket progression, current/next
// matches, and standings are derived by the format engine
// (spacetimedb/format/) from the stored structure and results, never
// stored themselves.
//
// Every table is private (the default): no client can subscribe to a
// base table. All reads go through the named views in share.ts and
// tournaments.ts — sender-gated where the surface depends on who is
// asking, slug-probed where a Share Link is the credential (ADR 0019).
//
// Ids are u64 auto-increment primary keys; structural match keys stay
// strings scoped to one tournament, exactly as in the engine.

// --- algebraic types --------------------------------------------------------

// Where a participant slot's occupant comes from. Fixed at bracket
// generation; only results move the bracket after that. Slot references
// use the engine's structural match keys rather than row ids, so the
// generated structure can be inserted in one pass and mirrors the pure
// engine's output exactly.
export const SlotSource = t.enum("SlotSource", {
  participant: t.object("ParticipantSlot", { participantId: t.u64() }),
  bye: t.unit(),
  winnerOf: t.object("WinnerOfSlot", { matchKey: t.string() }),
  loserOf: t.object("LoserOfSlot", { matchKey: t.string() }),
});

// A participant's outcome in one match. The general form (CONTEXT.md
// "Match"): elimination formats reject draws at the engine level, but
// the schema keeps the full range so round robin and Swiss need no
// migration.
const Outcome = t.enum("Outcome", ["win", "loss", "draw", "walkover", "disqualification"]);

export const ResultSide = t.object("ResultSide", {
  participantId: t.u64(),
  outcome: Outcome,
  score: t.f64().optional(),
});

// Format options, one member per family (ADR 0002). Adding round
// robin, Swiss, or group-into-playoffs later is an additive member.
export const TournamentFormat = t.enum("TournamentFormat", {
  single_elimination: t.unit(),
  // Grand-final bracket reset: the losers-side winner must beat the
  // winners-side winner twice. On by default at tournament creation.
  double_elimination: t.object("DoubleEliminationFormat", {
    grandFinalReset: t.bool(),
  }),
});

export const TournamentStatus = t.enum("TournamentStatus", [
  // draft: roster/seeding editable, bracket regenerable.
  // published: bracket visible on the Share Link.
  // live: first result recorded; roster and structure locked.
  // completed: final resolved (automatic).
  "draft",
  "published",
  "live",
  "completed",
]);

// MVP behavior is unlisted-only; the field exists from day one.
const TournamentVisibility = t.enum("TournamentVisibility", ["public", "unlisted", "private"]);

// How generateBracket assigns seeds. "random" (the default) reshuffles
// on every generation; manual reordering pins the stored order. The
// column is optional so the field stays additive: absent means
// "random".
export const SeedingMode = t.enum("SeedingMode", ["random", "manual"]);

export const BracketSection = t.enum("BracketSection", ["winners", "losers", "grand_final"]);

// How an Identity came to be bound to an app_user: minted anonymously
// on first use, or upgraded to (or merged into) an account (ADR 0021's
// linking, on this module's own tables — ADR 0031).
const BindingKind = t.enum("BindingKind", ["anonymous", "account"]);

// --- tables (all private) ---------------------------------------------------

// One row per person known to the app. App-owned outright — there is
// no auth component. Profile fields arrive with Events slice 1.
const appUser = table(
  { name: "app_user" },
  {
    id: t.u64().primaryKey().autoInc(),
  },
);

// The binding row: a connection's native Identity → its app_user,
// written by the identity seam when an unbound identity first acts
// (M2). Sender-gated views resolve the caller through this table.
const identityUser = table(
  { name: "identity_user" },
  {
    identity: t.identity().primaryKey(),
    userId: t.u64().index("btree"),
    kind: BindingKind,
  },
);

// Disciplines are freeform organizer input, stored as rows (not inline
// strings) so aliases can be merged later with results following — a
// future canonical/mergedInto pointer is an additive change.
const discipline = table(
  { name: "discipline" },
  {
    id: t.u64().primaryKey().autoInc(),
    // Display form, as first entered (e.g. "Street Fighter 6").
    name: t.string(),
    // Lookup form for suggestions and dedup (e.g. lowercased/trimmed).
    normalizedName: t.string().unique(),
  },
);

const tournament = table(
  { name: "tournament" },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    userId: t.u64().index("btree"),
    disciplineId: t.u64(),
    format: TournamentFormat,
    // Per-tournament draw configuration ships in the schema but stays
    // false for both MVP formats (elimination requires a decisive
    // outcome).
    drawsAllowed: t.bool(),
    status: TournamentStatus,
    visibility: TournamentVisibility,
    seeding: SeedingMode.optional(),
    // The Share Link identifier: a crypto-random token minted at
    // creation. An unlisted tournament's URL is its only guard, so
    // the public surface gets its own unguessable name instead of
    // reusing the row id.
    shareSlug: t.string().unique(),
  },
);

// Tournament-local records (CONTEXT.md "Participant"). Kept unlinked
// to any account on purpose; a future players table is referenced by
// adding an optional playerId field, so claiming stays additive.
const participant = table(
  { name: "participant" },
  {
    id: t.u64().primaryKey().autoInc(),
    tournamentId: t.u64().index("btree"),
    name: t.string(),
    // 1-based seeding position — an input fixed at bracket
    // generation (random by default, manually reorderable while
    // drafting).
    seed: t.u32(),
  },
);

// Bracket structure, written once at generation time from the format
// engine's output. Slots, byes, and seeding never change afterwards;
// progression is derived from results.
const match = table(
  { name: "match" },
  {
    id: t.u64().primaryKey().autoInc(),
    tournamentId: t.u64().index("btree"),
    // Engine-assigned structural key, unique within the tournament.
    key: t.string(),
    bracket: BracketSection,
    // 1-based round within the bracket section.
    round: t.u32(),
    // 0-based position within the round.
    indexInRound: t.u32(),
    // Exactly two slots for the MVP formats.
    slots: t.array(SlotSource),
  },
);

// Append-style result records (ADR 0005). Never patched or deleted: a
// correction appends a newer record for the same match, and the latest
// record per match is the effective one. Downstream records whose
// pairing a correction invalidates are voided by derivation, not
// mutated. Append order is the auto-increment id order.
const result = table(
  { name: "result" },
  {
    id: t.u64().primaryKey().autoInc(),
    tournamentId: t.u64().index("btree"),
    matchId: t.u64().index("btree"),
    // One entry per participant in the match, e.g. win/loss,
    // win/walkover, win/disqualification, draw/draw (where the
    // format allows draws). Exactly two sides is a hard engine
    // contract for the MVP formats; the engine rejects any other
    // arity at derivation time.
    sides: t.array(ResultSide),
    // The actor (ADR 0005): the Organizer in MVP. Future participant
    // self-reporting widens this additively.
    recordedBy: t.u64(),
    // When the result was reported. (Convex carried this as the
    // implicit _creationTime; here it is an explicit column.)
    reportedAt: t.timestamp(),
  },
);

/**
 * The module's schema object: the entry's default export, and the
 * registrar every registration file builds on. Tagged @public for
 * one direct cross-package consumer: the spike fixture seed
 * (spacetimedb/spike/fixture/seed.ts) imports it from this file to
 * register its fixture reducers on the same schema object. (The
 * test harness reaches it through the entry, ../src/index.)
 *
 * @public
 */
export const spacetimedb = schema({
  appUser,
  identityUser,
  discipline,
  tournament,
  participant,
  match,
  result,
});
