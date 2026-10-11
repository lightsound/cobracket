import type { Infer } from "convex/values";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { BracketStructure, Occupant, Progression, RecordedResult } from "../format";
import { deriveProgression, FormatEngineError } from "../format";
import { MAX_MATCHES, MAX_RESULTS, MAX_ROSTER_SIZE, takeAll } from "./limits";
import type { OrganizerProgressionView, ProgressionView, TournamentView } from "./validators";
import { occupantValidator } from "./validators";

// Loading a tournament and deriving its views. Progression is never stored:
// every read derives it from the generated structure and the append-only
// results via the format engine (ADR 0005).

export async function loadRoster(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
): Promise<Doc<"participants">[]> {
  const roster = await takeAll(
    ctx.db
      .query("participants")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId)),
    MAX_ROSTER_SIZE,
    "participants",
  );
  return roster.sort((a, b) => a.seed - b.seed);
}

interface StoredBracket {
  matchDocs: Doc<"matches">[];
  byKey: Map<string, Doc<"matches">>;
  byId: Map<Id<"matches">, Doc<"matches">>;
  structure: BracketStructure;
}

export async function loadBracket(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
): Promise<StoredBracket> {
  const matchDocs = await takeAll(
    ctx.db.query("matches").withIndex("by_tournament", (q) => q.eq("tournamentId", tournament._id)),
    MAX_MATCHES,
    "matches",
  );
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
export async function loadResults(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
): Promise<Doc<"results">[]> {
  return await takeAll(
    ctx.db.query("results").withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId)),
    MAX_RESULTS,
    "results",
  );
}

export function toRecordedResults(
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
export function rethrowEngineError(error: unknown): never {
  if (error instanceof FormatEngineError) {
    throw new ConvexError(error.message);
  }
  throw error;
}

export function deriveOrThrow(
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
export function castParticipantId(participantId: string): Id<"participants"> {
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
export function withMatchIds(
  view: ProgressionView,
  bracket: StoredBracket,
): OrganizerProgressionView {
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
export async function requireDiscipline(
  ctx: QueryCtx,
  disciplineId: Id<"disciplines">,
): Promise<Doc<"disciplines">> {
  const discipline = await ctx.db.get("disciplines", disciplineId);
  if (discipline === null) {
    throw new Error("tournament references a missing discipline");
  }
  return discipline;
}

export async function buildTournamentView(
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
