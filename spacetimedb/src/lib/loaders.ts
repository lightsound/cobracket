import type { BracketStructure, FormatOptions, Progression, RecordedResult } from "../../format";
import { deriveProgression, FormatEngineError, generateBracket } from "../../format";
import type { MatchRow, ParticipantRow, ResultRow, TournamentRow, WritableDb } from "./binding";
import { formatToEngine, sideToEngine, slotToEngine } from "./convert";
import { MAX_MATCHES, MAX_RESULTS, MAX_ROSTER_SIZE, takeAll } from "./limits";
import { compareById, compareBySeed, sortedRows } from "./rows";

// Loading a tournament's sets and deriving its progression — the
// successor of convex/model/views.ts's loaders. Progression is never
// stored: every derivation runs the format engine over the stored
// structure and the append-only results (ADR 0005). Every load sorts
// explicitly; index iteration order is never trusted for semantics
// (append order for matches and results is id order; roster order is
// seed order).

export function loadRoster(db: WritableDb, tournamentId: bigint): ParticipantRow[] {
  const roster = takeAll(
    db.participant.tournamentId.filter(tournamentId),
    MAX_ROSTER_SIZE,
    "participants",
  );
  return sortedRows(roster, compareBySeed);
}

export interface StoredBracket {
  matchDocs: MatchRow[];
  byKey: Map<string, MatchRow>;
  byId: Map<bigint, MatchRow>;
  structure: BracketStructure;
}

export function loadBracket(db: WritableDb, tournament: TournamentRow): StoredBracket {
  const matchDocs = sortedRows(
    takeAll(db.match.tournamentId.filter(tournament.id), MAX_MATCHES, "matches"),
    compareById,
  );
  const structure: BracketStructure = {
    format: formatToEngine(tournament.format),
    matches: matchDocs.map((doc) => ({
      key: doc.key,
      bracket: doc.bracket.tag,
      round: doc.round,
      indexInRound: doc.indexInRound,
      // Stored as an array (schema limitation); exactly two by construction.
      slots: [slotToEngine(doc.slots[0]!), slotToEngine(doc.slots[1]!)],
      // fallow-ignore-next-line code-duplication -- intentionally mirrors the Convex original during the migration window (both backends live until M6 deletes the Convex side; this module copy is the survivor)
    })),
  };
  return {
    matchDocs,
    byKey: new Map(matchDocs.map((doc) => [doc.key, doc])),
    byId: new Map(matchDocs.map((doc) => [doc.id, doc])),
    structure,
  };
}

// Append order is id order — what the engine's correction semantics
// (latest record per match wins) are defined over.
export function loadResults(db: WritableDb, tournamentId: bigint): ResultRow[] {
  return sortedRows(
    takeAll(db.result.tournamentId.filter(tournamentId), MAX_RESULTS, "results"),
    compareById,
  );
}

export function toRecordedResults(
  resultDocs: readonly ResultRow[],
  bracket: StoredBracket,
): RecordedResult[] {
  // fallow-ignore-next-line code-duplication -- intentionally mirrors the Convex original during the migration window (both backends live until M6 deletes the Convex side; this module copy is the survivor)
  return resultDocs.map((doc) => {
    const match = bracket.byId.get(doc.matchId);
    if (match === undefined) {
      // Unreachable: results only exist from live on, and the structure is
      // immutable from live on.
      throw new Error("result references a match outside the current bracket");
    }
    const [a, b] = doc.sides.map(sideToEngine);
    if (a === undefined || b === undefined) {
      throw new Error("stored result must have two sides");
    }
    return { matchKey: match.key, sides: [a, b] };
  });
}

// Engine errors carry client-actionable messages (invalid outcome
// combos, draws under elimination, ...); surface them unchanged — the
// message is the contract the Convex API returned as a ConvexError.
function rethrowEngineError(error: unknown): never {
  if (error instanceof FormatEngineError) {
    // fallow-ignore-next-line code-duplication -- intentionally mirrors the Convex original during the migration window (both backends live until M6 deletes the Convex side; this module copy is the survivor)
    throw new Error(error.message);
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

export function generateOrThrow(
  participantIds: readonly string[],
  format: FormatOptions,
): BracketStructure {
  try {
    return generateBracket(participantIds, format);
  } catch (error) {
    rethrowEngineError(error);
  }
}
