import { deriveProgression } from "../format";
import type { BracketStructure, FormatOptions, RecordedResult } from "../format";
import { formatToEngine, sideToEngine, slotToEngine } from "../src/lib";
import * as moduleExports from "../src/index";
import { authFor, type Harness } from "./harness";

// The composed read shapes the operations tests assert against. ADR
// 0031 replaces Convex's one assembled getTournament query with flat
// per-table views the client composes: these helpers perform that
// composition (views + the format engine) exactly as a client would,
// so the ported tests assert the same external behavior — results in,
// progression / standings / ready matches out — through the module's
// real surfaces. Ids stay bigint (the row handles); everything the
// engine derives is converted back from its string ids.

export type ComposedOccupant =
  | { kind: "participant"; participantId: bigint }
  | { kind: "bye" }
  | { kind: "unknown" };

export interface ComposedSide {
  participantId: bigint;
  outcome: string;
  score?: number;
}

export interface ComposedMatch {
  key: string;
  bracket: string;
  round: number;
  indexInRound: number;
  state: string;
  occupants: ComposedOccupant[];
  winnerId?: bigint;
  loserId?: bigint;
  sides?: ComposedSide[];
  // The Organizer composition only: the handle reportResult takes.
  matchId?: bigint;
}

export interface ComposedBracket {
  matches: ComposedMatch[];
  readyMatchKeys: string[];
  completed: boolean;
  championId?: bigint;
  standings: { participantId: bigint; placement: number }[];
  // One entry per voided RECORD (a key repeats when two of its
  // records are voided at once) — the granularity of Convex's voided
  // return, which filters the engine's per-record indices.
  voidedMatchKeys: string[];
}

export interface ComposedParticipant {
  participantId: bigint;
  name: string;
  seed: number;
}

export interface OrganizerView {
  tournamentId: bigint;
  name: string;
  status: string;
  format: FormatOptions;
  discipline: string;
  shareSlug: string;
  seeding: string;
  participants: ComposedParticipant[];
  bracket: ComposedBracket | null;
}

export interface SharedView {
  name: string;
  status: string;
  format: FormatOptions;
  discipline: string;
  participants: ComposedParticipant[];
  bracket: ComposedBracket | null;
}

// The engine structure over either audience's match rows (both
// surfaces project the same stored shape).
function structureOf(
  format: Parameters<typeof formatToEngine>[0],
  matches: readonly {
    key: string;
    bracket: { tag: "winners" | "losers" | "grand_final" };
    round: number;
    indexInRound: number;
    slots: readonly Parameters<typeof slotToEngine>[0][];
  }[],
): BracketStructure {
  return {
    format: formatToEngine(format),
    matches: matches.map((match) => ({
      key: match.key,
      bracket: match.bracket.tag,
      round: match.round,
      indexInRound: match.indexInRound,
      slots: [slotToEngine(match.slots[0]!), slotToEngine(match.slots[1]!)],
    })),
  };
}

function assembleBracket(
  structure: BracketStructure,
  recorded: readonly RecordedResult[],
  matchIdByKey?: ReadonlyMap<string, bigint>,
): ComposedBracket | null {
  if (structure.matches.length === 0) {
    return null;
  }
  const progression = deriveProgression(structure, recorded);
  return {
    matches: progression.matches.map((match) => ({
      key: match.key,
      bracket: match.bracket,
      round: match.round,
      indexInRound: match.indexInRound,
      state: match.state,
      occupants: match.occupants.map((occupant) =>
        occupant.kind === "participant"
          ? { kind: "participant" as const, participantId: BigInt(occupant.participantId) }
          : occupant,
      ),
      ...(match.winnerId !== undefined && { winnerId: BigInt(match.winnerId) }),
      ...(match.loserId !== undefined && { loserId: BigInt(match.loserId) }),
      ...(match.resultIndex !== undefined && {
        sides: recorded[match.resultIndex]!.sides.map((side) => ({
          participantId: BigInt(side.participantId),
          outcome: side.outcome,
          ...(side.score !== undefined && { score: side.score }),
        })),
      }),
      ...(matchIdByKey !== undefined && { matchId: matchIdByKey.get(match.key) }),
    })),
    readyMatchKeys: progression.readyMatchKeys,
    completed: progression.completed,
    ...(progression.championId !== undefined && { championId: BigInt(progression.championId) }),
    standings: progression.standings.map((entry) => ({
      participantId: BigInt(entry.participantId),
      placement: entry.placement,
    })),
    voidedMatchKeys: progression.voidedResultIndices.map((index) => recorded[index]!.matchKey),
  };
}

// The Organizer's read of one tournament, composed from the four
// sender-gated views as the owner — or undefined when the gate
// answers nothing (unbound, foreign, or missing), the module form of
// getTournament's null.
export function organizerView(
  harness: Harness,
  sub: string,
  tournamentId: bigint,
): OrganizerView | undefined {
  const ctx = harness.viewContext(authFor(sub));
  const header = moduleExports.organizerTournament(ctx, { tournamentId });
  if (header === undefined) {
    return undefined;
  }
  const participants = moduleExports.organizerParticipants(ctx, { tournamentId });
  const matches = moduleExports.organizerMatches(ctx, { tournamentId });
  const results = moduleExports.organizerResults(ctx, { tournamentId });
  const keyByMatchId = new Map(matches.map((match) => [match.matchId, match.key]));
  const structure = structureOf(header.format, matches);
  const recorded: RecordedResult[] = [...results]
    .sort((a, b) => (a.resultId < b.resultId ? -1 : a.resultId > b.resultId ? 1 : 0))
    .map((result) => ({
      matchKey: keyByMatchId.get(result.matchId)!,
      sides: [sideToEngine(result.sides[0]!), sideToEngine(result.sides[1]!)],
    }));
  return {
    tournamentId: header.tournamentId,
    name: header.name,
    status: header.status.tag,
    format: formatToEngine(header.format),
    discipline: header.discipline,
    shareSlug: header.shareSlug,
    seeding: header.seeding.tag,
    participants: participants.map((participant) => ({
      participantId: participant.participantId,
      name: participant.name,
      seed: participant.seed,
    })),
    bracket: assembleBracket(
      structure,
      recorded,
      new Map(matches.map((match) => [match.key, match.matchId])),
    ),
  };
}

// The Share Link's read, composed from the four anonymous slug views
// — or undefined when the gate answers nothing (unknown slug, draft,
// or private), the module form of getSharedTournament's null.
export function sharedView(harness: Harness, slug: string): SharedView | undefined {
  const ctx = harness.anonymousViewContext();
  const header = moduleExports.sharedTournament(ctx, { slug });
  if (header === undefined) {
    return undefined;
  }
  const participants = moduleExports.sharedParticipants(ctx, { slug });
  const matches = moduleExports.sharedMatches(ctx, { slug });
  const results = moduleExports.sharedResults(ctx, { slug });
  const structure = structureOf(header.format, matches);
  const recorded: RecordedResult[] = [...results]
    .sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0))
    .map((result) => ({
      matchKey: result.matchKey,
      sides: [sideToEngine(result.sides[0]!), sideToEngine(result.sides[1]!)],
    }));
  return {
    name: header.name,
    status: header.status.tag,
    format: formatToEngine(header.format),
    discipline: header.discipline,
    participants: participants.map((participant) => ({
      participantId: participant.participantId,
      name: participant.name,
      seed: participant.seed,
    })),
    bracket: assembleBracket(structure, recorded),
  };
}
