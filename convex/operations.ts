import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getOrganizer } from "./auth";
import {
  deriveProgression,
  FormatEngineError,
  generateBracket as generateBracketStructure,
} from "./format";
import type { BracketStructure, Occupant, Progression, RecordedResult } from "./format";

// The operations API (Seam 2, docs/specs/mvp.md): one set of Convex functions
// covering every Organizer capability plus the Share Link's public read. The
// web UI and the MCP server are both thin clients of these functions
// (ADR 0001). Progression is never stored: every read derives it from the
// generated structure and the append-only results via the format engine
// (ADR 0005).

// ---------------------------------------------------------------------------
// Validators (function args/returns; storage shapes live in schema.ts)
// ---------------------------------------------------------------------------

const statusValidator = v.union(
  v.literal("draft"),
  v.literal("published"),
  v.literal("live"),
  v.literal("completed"),
);

// Args accept grandFinalReset as optional (defaulting to on, per the spec);
// the stored form in schema.ts keeps it required.
const formatArgsValidator = v.union(
  v.object({ family: v.literal("single_elimination") }),
  v.object({
    family: v.literal("double_elimination"),
    grandFinalReset: v.optional(v.boolean()),
  }),
);

const formatValidator = v.union(
  v.object({ family: v.literal("single_elimination") }),
  v.object({ family: v.literal("double_elimination"), grandFinalReset: v.boolean() }),
);

const outcomeValidator = v.union(
  v.literal("win"),
  v.literal("loss"),
  v.literal("draw"),
  v.literal("walkover"),
  v.literal("disqualification"),
);

const resultSideValidator = v.object({
  participantId: v.id("participants"),
  outcome: outcomeValidator,
  score: v.optional(v.number()),
});

type ResultSide = Infer<typeof resultSideValidator>;

// fallow-ignore-next-line code-duplication -- intentionally mirrors the stored slotSource union (schema.ts) but is a distinct read-side shape: "unknown" replaces winnerOf/loserOf
const occupantValidator = v.union(
  v.object({ kind: v.literal("participant"), participantId: v.id("participants") }),
  v.object({ kind: v.literal("bye") }),
  v.object({ kind: v.literal("unknown") }),
);

// The shared (public-safe) per-match shape identifies matches by their
// structural key only; document handles stay on the Organizer surface.
const derivedMatchValidator = v.object({
  key: v.string(),
  bracket: v.union(v.literal("winners"), v.literal("losers"), v.literal("grand_final")),
  round: v.number(),
  indexInRound: v.number(),
  state: v.union(
    v.literal("pending"),
    v.literal("ready"),
    v.literal("completed"),
    v.literal("cancelled"),
  ),
  occupants: v.array(occupantValidator),
  winnerId: v.optional(v.id("participants")),
  loserId: v.optional(v.id("participants")),
  // The effective (latest, still-valid) recorded result for this match:
  // outcome plus optional score per side. Absent for matches resolved
  // structurally (byes) or not yet decided.
  sides: v.optional(v.array(resultSideValidator)),
});

// Organizer matches carry the document id — the handle reportResult takes.
const organizerMatchValidator = derivedMatchValidator.extend({ matchId: v.id("matches") });

const progressionFields = {
  // Matches with two known participants and no effective result — the
  // Organizer's "in progress / up next" list (story 15).
  readyMatchKeys: v.array(v.string()),
  completed: v.boolean(),
  championId: v.optional(v.id("participants")),
  standings: v.array(v.object({ participantId: v.id("participants"), placement: v.number() })),
  // Matches whose latest recorded result no longer applies because a
  // correction upstream changed their pairing; they await re-entry.
  voidedMatchKeys: v.array(v.string()),
};

const progressionValidator = v.object({
  matches: v.array(derivedMatchValidator),
  ...progressionFields,
});

const organizerProgressionValidator = v.object({
  matches: v.array(organizerMatchValidator),
  ...progressionFields,
});

const participantValidator = v.object({
  participantId: v.id("participants"),
  name: v.string(),
  seed: v.number(),
});

const tournamentViewFields = {
  name: v.string(),
  status: statusValidator,
  format: formatValidator,
  discipline: v.string(),
  participants: v.array(participantValidator),
};

// The shared read shape. Deliberately free of Organizer-only data
// (organizerId, recordedBy, shareSlug, document handles) so
// getSharedTournament can return it to unauthenticated viewers as-is.
const tournamentViewValidator = v.object({
  ...tournamentViewFields,
  // Null until the bracket has been generated (and after a roster change
  // invalidates a draft/published bracket).
  bracket: v.union(progressionValidator, v.null()),
});

const organizerTournamentViewValidator = v.object({
  ...tournamentViewFields,
  bracket: v.union(organizerProgressionValidator, v.null()),
  tournamentId: v.id("tournaments"),
  shareSlug: v.string(),
  seeding: v.union(v.literal("random"), v.literal("manual")),
});

type ProgressionView = Infer<typeof progressionValidator>;
type OrganizerProgressionView = Infer<typeof organizerProgressionValidator>;
type TournamentView = Infer<typeof tournamentViewValidator>;

// ---------------------------------------------------------------------------
// Identity, ownership, and lifecycle guards
// ---------------------------------------------------------------------------

type TournamentStatus = Doc<"tournaments">["status"];

// Every operation below funnels identity through getOrganizer (ADR 0003) and
// never takes it from client arguments.
async function requireOrganizer(ctx: QueryCtx): Promise<Id<"users">> {
  const organizerId = await getOrganizer(ctx);
  if (organizerId === null) {
    throw new ConvexError("Not signed in");
  }
  return organizerId;
}

// "Missing" and "not yours" are deliberately the same error so the API never
// confirms a foreign tournament's existence.
async function requireOwnedTournament(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
): Promise<Doc<"tournaments">> {
  const organizerId = await requireOrganizer(ctx);
  const tournament = await ctx.db.get("tournaments", tournamentId);
  if (tournament === null || tournament.organizerId !== organizerId) {
    throw new ConvexError("Tournament not found");
  }
  return tournament;
}

function requireStatus(
  tournament: Doc<"tournaments">,
  allowed: readonly TournamentStatus[],
  operation: string,
): void {
  if (!allowed.includes(tournament.status)) {
    throw new ConvexError(`Cannot ${operation}: the tournament is ${tournament.status}`);
  }
}

// The shared prologue of every tournament-keyed Organizer mutation:
// identity, ownership, then lifecycle.
async function requireOwnedTournamentIn(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  allowed: readonly TournamentStatus[],
  operation: string,
): Promise<Doc<"tournaments">> {
  const tournament = await requireOwnedTournament(ctx, tournamentId);
  requireStatus(tournament, allowed, operation);
  return tournament;
}

// Same collapsing rule for child-document handles: identity is resolved
// first (an unauthenticated probe learns nothing), and a missing document
// reads the same as someone else's, so neither confirms existence.
async function requireOwnedParticipant(
  ctx: QueryCtx,
  participantId: Id<"participants">,
): Promise<{ participant: Doc<"participants">; tournament: Doc<"tournaments"> }> {
  const organizerId = await requireOrganizer(ctx);
  const participant = await ctx.db.get("participants", participantId);
  const tournament =
    participant === null ? null : await ctx.db.get("tournaments", participant.tournamentId);
  if (participant === null || tournament === null || tournament.organizerId !== organizerId) {
    throw new ConvexError("Participant not found");
  }
  return { participant, tournament };
}

async function requireOwnedMatch(
  ctx: QueryCtx,
  matchId: Id<"matches">,
): Promise<{ match: Doc<"matches">; tournament: Doc<"tournaments"> }> {
  const organizerId = await requireOrganizer(ctx);
  const match = await ctx.db.get("matches", matchId);
  const tournament = match === null ? null : await ctx.db.get("tournaments", match.tournamentId);
  if (match === null || tournament === null || tournament.organizerId !== organizerId) {
    throw new ConvexError("Match not found");
  }
  return { match, tournament };
}

// Roster and seeding stay editable, and the bracket regenerable, until the
// first result flips the tournament to live (story 10 + Lifecycle).
const PRE_LIVE: readonly TournamentStatus[] = ["draft", "published"];

// ---------------------------------------------------------------------------
// Shared loading and derivation helpers
// ---------------------------------------------------------------------------

// All .collect() calls below are bounded by one tournament's size: roster,
// bracket matches (< 2x roster for the MVP formats), and results (matches
// played plus corrections).

async function loadRoster(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
): Promise<Doc<"participants">[]> {
  const roster = await ctx.db
    .query("participants")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
    .collect();
  return roster.sort((a, b) => a.seed - b.seed);
}

interface StoredBracket {
  matchDocs: Doc<"matches">[];
  byKey: Map<string, Doc<"matches">>;
  byId: Map<Id<"matches">, Doc<"matches">>;
  structure: BracketStructure;
}

async function loadBracket(ctx: QueryCtx, tournament: Doc<"tournaments">): Promise<StoredBracket> {
  const matchDocs = await ctx.db
    .query("matches")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournament._id))
    .collect();
  const structure: BracketStructure = {
    format: tournament.format,
    matches: matchDocs.map((doc) => ({
      key: doc.key,
      bracket: doc.bracket,
      round: doc.round,
      indexInRound: doc.indexInRound,
      // Stored as an array (schema limitation); exactly two by construction.
      slots: [doc.slots[0]!, doc.slots[1]!],
    })),
  };
  return {
    matchDocs,
    byKey: new Map(matchDocs.map((doc) => [doc.key, doc])),
    byId: new Map(matchDocs.map((doc) => [doc._id, doc])),
    structure,
  };
}

// Append order: the by_tournament index ends on _creationTime, so ascending
// iteration is exactly record order — what the engine's correction semantics
// (latest record per match wins) are defined over.
async function loadResults(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
): Promise<Doc<"results">[]> {
  return await ctx.db
    .query("results")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
    .collect();
}

function toRecordedResults(
  resultDocs: readonly Doc<"results">[],
  bracket: StoredBracket,
): RecordedResult[] {
  return resultDocs.map((doc) => {
    const match = bracket.byId.get(doc.matchId);
    if (match === undefined) {
      // Unreachable: results only exist from live on, and the structure is
      // immutable from live on.
      throw new Error("result references a match outside the current bracket");
    }
    const [a, b] = doc.sides;
    if (a === undefined || b === undefined) {
      throw new Error("stored result must have two sides");
    }
    return { matchKey: match.key, sides: [a, b] };
  });
}

// Engine errors carry client-actionable messages (invalid outcome combos,
// draws under elimination, ...); surface them as ConvexError so callers can
// display them.
function rethrowEngineError(error: unknown): never {
  if (error instanceof FormatEngineError) {
    throw new ConvexError(error.message);
  }
  throw error;
}

function deriveOrThrow(
  structure: BracketStructure,
  results: readonly RecordedResult[],
): Progression {
  try {
    return deriveProgression(structure, results);
  } catch (error) {
    rethrowEngineError(error);
  }
}

// The engine handles participant ids as opaque strings (it is Convex-free);
// every id it can emit entered through slots and results we wrote from
// Id<"participants">, so narrowing back is sound.
function castParticipantId(participantId: string): Id<"participants"> {
  return participantId as Id<"participants">;
}

function toOccupantView(occupant: Occupant): Infer<typeof occupantValidator> {
  return occupant.kind === "participant"
    ? { kind: "participant", participantId: castParticipantId(occupant.participantId) }
    : occupant;
}

function toProgressionView(
  progression: Progression,
  bracket: StoredBracket,
  resultDocs: readonly Doc<"results">[],
): ProgressionView {
  const matchKeyOfResult = (resultIndex: number): string =>
    bracket.byId.get(resultDocs[resultIndex]!.matchId)!.key;
  return {
    matches: progression.matches.map((match) => ({
      key: match.key,
      bracket: match.bracket,
      round: match.round,
      indexInRound: match.indexInRound,
      state: match.state,
      occupants: match.occupants.map(toOccupantView),
      ...(match.winnerId !== undefined && { winnerId: castParticipantId(match.winnerId) }),
      ...(match.loserId !== undefined && { loserId: castParticipantId(match.loserId) }),
      ...(match.resultIndex !== undefined && {
        sides: resultDocs[match.resultIndex]!.sides,
      }),
    })),
    readyMatchKeys: progression.readyMatchKeys,
    completed: progression.completed,
    ...(progression.championId !== undefined && {
      championId: castParticipantId(progression.championId),
    }),
    standings: progression.standings.map((entry) => ({
      participantId: castParticipantId(entry.participantId),
      placement: entry.placement,
    })),
    voidedMatchKeys: progression.voidedResultIndices.map(matchKeyOfResult),
  };
}

// The Organizer's variant of the progression: every match also carries its
// document id, the handle reportResult takes.
function withMatchIds(view: ProgressionView, bracket: StoredBracket): OrganizerProgressionView {
  return {
    ...view,
    matches: view.matches.map((match) => ({
      ...match,
      matchId: bracket.byKey.get(match.key)!._id,
    })),
  };
}

// A dangling disciplineId is a schema invariant violation, never expected
// input, so every read fails loudly and identically on it.
async function requireDiscipline(
  ctx: QueryCtx,
  disciplineId: Id<"disciplines">,
): Promise<Doc<"disciplines">> {
  const discipline = await ctx.db.get("disciplines", disciplineId);
  if (discipline === null) {
    throw new Error("tournament references a missing discipline");
  }
  return discipline;
}

async function buildTournamentView(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
): Promise<{ view: TournamentView; bracket: StoredBracket }> {
  const discipline = await requireDiscipline(ctx, tournament.disciplineId);
  const roster = await loadRoster(ctx, tournament._id);
  const bracket = await loadBracket(ctx, tournament);
  let progressionView: ProgressionView | null = null;
  if (bracket.matchDocs.length > 0) {
    const resultDocs = await loadResults(ctx, tournament._id);
    const progression = deriveOrThrow(bracket.structure, toRecordedResults(resultDocs, bracket));
    progressionView = toProgressionView(progression, bracket, resultDocs);
  }
  const view: TournamentView = {
    name: tournament.name,
    status: tournament.status,
    format: tournament.format,
    discipline: discipline.name,
    participants: roster.map((participant) => ({
      participantId: participant._id,
      name: participant.name,
      seed: participant.seed,
    })),
    bracket: progressionView,
  };
  return { view, bracket };
}

// ---------------------------------------------------------------------------
// Tournament creation and disciplines
// ---------------------------------------------------------------------------

// Anonymous sign-in is zero-friction (ADR 0003), so every write is bounded:
// generous for the spec's 8–64 participant target, tight enough that nobody
// can bloat documents or push generateBracket into transaction limits.
const MAX_NAME_LENGTH = 120;
const MAX_ROSTER_SIZE = 128;

function requireName(raw: string, label: string): string {
  const name = raw.trim();
  if (name === "") {
    throw new ConvexError(`${label} must not be empty`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new ConvexError(`${label} must be at most ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

function requireRosterCapacity(currentSize: number, adding: number): void {
  if (currentSize + adding > MAX_ROSTER_SIZE) {
    throw new ConvexError(`A tournament can have at most ${MAX_ROSTER_SIZE} participants`);
  }
}

function normalizeDisciplineName(raw: string): { name: string; normalizedName: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  return { name, normalizedName: name.toLowerCase() };
}

// Disciplines are freeform organizer input, normalized into rows so the same
// discipline entered twice (case/spacing aside) is one row (story 2).
async function getOrCreateDiscipline(
  ctx: MutationCtx,
  rawName: string,
): Promise<Id<"disciplines">> {
  const { name, normalizedName } = normalizeDisciplineName(rawName);
  requireName(name, "Discipline");
  const existing = await ctx.db
    .query("disciplines")
    .withIndex("by_normalized_name", (q) => q.eq("normalizedName", normalizedName))
    .unique();
  if (existing !== null) {
    return existing._id;
  }
  return await ctx.db.insert("disciplines", { name, normalizedName });
}

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_LENGTH = 12;

// The Share Link identifier: an unlisted tournament's URL is its only guard,
// so the slug is minted from crypto randomness (~62 bits) instead of reusing
// the document id, whose format is an implementation detail and not designed
// to be a capability.
function randomSlug(): string {
  const bytes = new Uint8Array(SLUG_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => SLUG_ALPHABET[byte % SLUG_ALPHABET.length]).join("");
}

async function mintShareSlug(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = randomSlug();
    const taken = await ctx.db
      .query("tournaments")
      .withIndex("by_share_slug", (q) => q.eq("shareSlug", slug))
      .unique();
    if (taken === null) {
      return slug;
    }
  }
  throw new Error("could not allocate a share slug");
}

export const createTournament = mutation({
  args: {
    name: v.string(),
    discipline: v.string(),
    format: formatArgsValidator,
  },
  returns: v.object({ tournamentId: v.id("tournaments"), shareSlug: v.string() }),
  handler: async (ctx, args) => {
    const organizerId = await requireOrganizer(ctx);
    const name = requireName(args.name, "Tournament name");
    const disciplineId = await getOrCreateDiscipline(ctx, args.discipline);
    // Grand-final bracket reset defaults to on (spec: Format engine).
    const format =
      args.format.family === "double_elimination"
        ? {
            family: "double_elimination" as const,
            grandFinalReset: args.format.grandFinalReset ?? true,
          }
        : { family: "single_elimination" as const };
    const shareSlug = await mintShareSlug(ctx);
    const tournamentId = await ctx.db.insert("tournaments", {
      name,
      organizerId,
      disciplineId,
      format,
      // Elimination requires a decisive outcome; the field ships for later
      // draw-capable families.
      drawsAllowed: false,
      status: "draft",
      visibility: "unlisted",
      shareSlug,
    });
    return { tournamentId, shareSlug };
  },
});

// Suggestions for the freeform Discipline field (story 2): prefix search on
// the normalized form. Public on purpose — discipline names are not
// organizer-private, and the create form runs before any tournament exists.
export const suggestDisciplines = query({
  args: { prefix: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const { normalizedName: prefix } = normalizeDisciplineName(args.prefix);
    if (prefix === "") {
      return [];
    }
    const rows = await ctx.db
      .query("disciplines")
      .withIndex("by_normalized_name", (q) =>
        q.gte("normalizedName", prefix).lt("normalizedName", `${prefix}\uffff`),
      )
      .take(10);
    return rows.map((row) => row.name);
  },
});

// ---------------------------------------------------------------------------
// Roster management (stories 4–6)
// ---------------------------------------------------------------------------

// A structural roster or seeding change makes the generated bracket stale
// (structure is fixed at generation), so it is dropped and must be
// regenerated. Safe pre-live: no results exist yet, so nothing is orphaned.
async function invalidateBracket(ctx: MutationCtx, tournamentId: Id<"tournaments">): Promise<void> {
  const matchDocs = await ctx.db
    .query("matches")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
    .collect();
  for (const doc of matchDocs) {
    await ctx.db.delete("matches", doc._id);
  }
}

async function insertParticipant(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  rawName: string,
  seed: number,
): Promise<Id<"participants">> {
  const name = requireName(rawName, "Participant name");
  return await ctx.db.insert("participants", { tournamentId, name, seed });
}

export const addParticipant = mutation({
  args: { tournamentId: v.id("tournaments"), name: v.string() },
  returns: v.id("participants"),
  handler: async (ctx, args) => {
    await requireOwnedTournamentIn(ctx, args.tournamentId, PRE_LIVE, "edit the roster");
    const roster = await loadRoster(ctx, args.tournamentId);
    requireRosterCapacity(roster.length, 1);
    const participantId = await insertParticipant(
      ctx,
      args.tournamentId,
      args.name,
      roster.length + 1,
    );
    await invalidateBracket(ctx, args.tournamentId);
    return participantId;
  },
});

// Bulk entry (story 5): one name per line, e.g. pasted from Discord. Blank
// lines and surrounding whitespace are dropped.
export const addParticipants = mutation({
  args: { tournamentId: v.id("tournaments"), text: v.string() },
  returns: v.array(v.id("participants")),
  handler: async (ctx, args) => {
    await requireOwnedTournamentIn(ctx, args.tournamentId, PRE_LIVE, "edit the roster");
    const names = args.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
    if (names.length === 0) {
      throw new ConvexError("No participant names given");
    }
    const roster = await loadRoster(ctx, args.tournamentId);
    requireRosterCapacity(roster.length, names.length);
    const participantIds: Id<"participants">[] = [];
    for (const [index, name] of names.entries()) {
      participantIds.push(
        await insertParticipant(ctx, args.tournamentId, name, roster.length + index + 1),
      );
    }
    await invalidateBracket(ctx, args.tournamentId);
    return participantIds;
  },
});

export const renameParticipant = mutation({
  args: { participantId: v.id("participants"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { tournament } = await requireOwnedParticipant(ctx, args.participantId);
    requireStatus(tournament, PRE_LIVE, "edit the roster");
    const name = requireName(args.name, "Participant name");
    // Names live on the participant row and matches reference ids, so a
    // rename never invalidates the bracket.
    await ctx.db.patch("participants", args.participantId, { name });
    return null;
  },
});

export const removeParticipant = mutation({
  args: { participantId: v.id("participants") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { participant, tournament } = await requireOwnedParticipant(ctx, args.participantId);
    requireStatus(tournament, PRE_LIVE, "edit the roster");
    await ctx.db.delete("participants", args.participantId);
    // Close the seed gap so seeds stay a contiguous 1..n sequence.
    const roster = await loadRoster(ctx, tournament._id);
    for (const other of roster) {
      if (other.seed > participant.seed) {
        await ctx.db.patch("participants", other._id, { seed: other.seed - 1 });
      }
    }
    await invalidateBracket(ctx, tournament._id);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Seeding (stories 7–8)
// ---------------------------------------------------------------------------

// Manual reorder pins the given order and switches the tournament to manual
// seeding, so later regenerations preserve it instead of reshuffling.
export const reorderSeeding = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    orderedParticipantIds: v.array(v.id("participants")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwnedTournamentIn(ctx, args.tournamentId, PRE_LIVE, "reorder the seeding");
    const roster = await loadRoster(ctx, args.tournamentId);
    const rosterIds = new Set<string>(roster.map((participant) => participant._id));
    const orderedIds = new Set<string>(args.orderedParticipantIds);
    if (
      args.orderedParticipantIds.length !== roster.length ||
      orderedIds.size !== rosterIds.size ||
      [...orderedIds].some((id) => !rosterIds.has(id))
    ) {
      throw new ConvexError("The new order must contain every participant exactly once");
    }
    for (const [index, participantId] of args.orderedParticipantIds.entries()) {
      await ctx.db.patch("participants", participantId, { seed: index + 1 });
    }
    await ctx.db.patch("tournaments", args.tournamentId, { seeding: "manual" });
    await invalidateBracket(ctx, args.tournamentId);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Bracket generation and publishing (stories 9–11)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Reads (stories 9, 15–17, 21–23)
// ---------------------------------------------------------------------------

export const listMyTournaments = query({
  args: {},
  returns: v.array(
    v.object({
      tournamentId: v.id("tournaments"),
      name: v.string(),
      status: statusValidator,
      format: formatValidator,
      discipline: v.string(),
      shareSlug: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const organizerId = await requireOrganizer(ctx);
    const tournaments = await ctx.db
      .query("tournaments")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .order("desc")
      // Newest 100 only, no cursor — callers must not assume completeness.
      // Enough headroom for the MVP; pagination is an additive change.
      .take(100);
    return await Promise.all(
      tournaments.map(async (tournament) => ({
        tournamentId: tournament._id,
        name: tournament.name,
        status: tournament.status,
        format: tournament.format,
        discipline: (await requireDiscipline(ctx, tournament.disciplineId)).name,
        shareSlug: tournament.shareSlug,
      })),
    );
  },
});

// The Organizer's full view, drafts included (story 9: see the bracket
// before anyone else does).
export const getTournament = query({
  args: { tournamentId: v.id("tournaments") },
  returns: organizerTournamentViewValidator,
  handler: async (ctx, args) => {
    const tournament = await requireOwnedTournament(ctx, args.tournamentId);
    const { view, bracket } = await buildTournamentView(ctx, tournament);
    return {
      ...view,
      bracket: view.bracket === null ? null : withMatchIds(view.bracket, bracket),
      tournamentId: tournament._id,
      shareSlug: tournament.shareSlug,
      seeding: tournament.seeding ?? "random",
    };
  },
});

// The Share Link read (stories 21–23): unauthenticated, realtime, and
// view-only. Drafts stay invisible; null (rather than an error) covers both
// unknown slugs and not-yet-published tournaments without confirming which.
export const getSharedTournament = query({
  args: { shareSlug: v.string() },
  returns: v.union(tournamentViewValidator, v.null()),
  handler: async (ctx, args) => {
    const tournament = await ctx.db
      .query("tournaments")
      .withIndex("by_share_slug", (q) => q.eq("shareSlug", args.shareSlug))
      .unique();
    // MVP behavior is unlisted-only, but the gate reads the visibility field
    // from day one so a future mutation exposing it cannot leak by omission.
    if (
      tournament === null ||
      tournament.status === "draft" ||
      tournament.visibility === "private"
    ) {
      return null;
    }
    return (await buildTournamentView(ctx, tournament)).view;
  },
});
