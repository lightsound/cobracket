import { schema, table, t } from "spacetimedb/server";

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

export const TournamentFormat = t.enum("TournamentFormat", {
  single_elimination: t.unit(),
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

const TournamentVisibility = t.enum("TournamentVisibility", ["public", "unlisted", "private"]);

export const SeedingMode = t.enum("SeedingMode", ["random", "manual"]);

export const BracketSection = t.enum("BracketSection", ["winners", "losers", "grand_final"]);

const BindingKind = t.enum("BindingKind", ["anonymous", "account"]);

const appUser = table(
  { name: "app_user" },
  {
    id: t.u64().primaryKey().autoInc(),
  },
);

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
    name: t.string(),
    normalizedName: t.string().unique(),
  },
);

const moduleSecret = table(
  { name: "module_secret" },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.byteArray(),
    keyVersion: t.u32(),
  },
);

const slugCounter = table(
  { name: "slug_counter" },
  {
    userId: t.u64().primaryKey(),
    next: t.u64(),
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
    drawsAllowed: t.bool(),
    status: TournamentStatus,
    visibility: TournamentVisibility,
    seeding: SeedingMode.optional(),
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
    seed: t.u32(),
  },
);

const match = table(
  { name: "match" },
  {
    id: t.u64().primaryKey().autoInc(),
    tournamentId: t.u64().index("btree"),
    key: t.string(),
    bracket: BracketSection,
    round: t.u32(),
    indexInRound: t.u32(),
    slots: t.array(SlotSource),
  },
);

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
    recordedBy: t.u64(),
    reportedAt: t.timestamp(),
  },
);

const scoreChange = table(
  { name: "score_change" },
  {
    id: t.u64().primaryKey().autoInc(),
    tournamentId: t.u64().index("btree"),
    matchId: t.u64().index("btree"),
    changedBy: t.u64(),
    changedAt: t.timestamp(),
    previousSides: t.array(ResultSide),
    newSides: t.array(ResultSide),
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
  moduleSecret,
  slugCounter,
  discipline,
  tournament,
  participant,
  match,
  result,
  scoreChange,
});
