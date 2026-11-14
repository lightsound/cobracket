import type { Identity } from "spacetimedb";
import type {
  MatchRow,
  ParticipantRow,
  TournamentRow,
  TournamentStatusTag,
  WritableDb,
} from "./binding";
import { requireBoundUser } from "./binding";

// Identity, ownership, and lifecycle guards — the successor of
// convex/model/guards.ts. Every guard resolves identity FIRST through
// the binding seam (requireBoundUser), before any row lookup, so a
// caller learns nothing about rows they do not own; and "missing" and
// "not yours" deliberately read the same, so the API never confirms a
// foreign row's existence. (The read side's collapsing form is
// ownedTournament in reads.ts, which answers undefined instead of
// throwing: a URL that names nothing is a state to render, while a
// mutation refuses with one error.)

export function requireStatus(
  tournament: TournamentRow,
  allowed: readonly TournamentStatusTag[],
  operation: string,
): void {
  if (!allowed.includes(tournament.status.tag)) {
    throw new Error(`Cannot ${operation}: the tournament is ${tournament.status.tag}`);
  }
}

// The shared prologue of every tournament-keyed mutation: identity,
// ownership, then (in requireOwnedTournamentIn) lifecycle.
export function requireOwnedTournament(
  db: WritableDb,
  sender: Identity,
  tournamentId: bigint,
): TournamentRow {
  const userId = requireBoundUser(db, sender);
  const tournament = db.tournament.id.find(tournamentId);
  if (tournament === null || tournament.userId !== userId) {
    throw new Error("Tournament not found");
  }
  return tournament;
}

export function requireOwnedTournamentIn(
  db: WritableDb,
  sender: Identity,
  tournamentId: bigint,
  allowed: readonly TournamentStatusTag[],
  operation: string,
): TournamentRow {
  const tournament = requireOwnedTournament(db, sender, tournamentId);
  requireStatus(tournament, allowed, operation);
  return tournament;
}

export function requireOwnedParticipant(
  db: WritableDb,
  sender: Identity,
  participantId: bigint,
): { participant: ParticipantRow; tournament: TournamentRow } {
  const userId = requireBoundUser(db, sender);
  const participant = db.participant.id.find(participantId);
  const tournament = participant === null ? null : db.tournament.id.find(participant.tournamentId);
  if (participant === null || tournament === null || tournament.userId !== userId) {
    throw new Error("Participant not found");
  }
  return { participant, tournament };
}

export function requireOwnedMatch(
  db: WritableDb,
  sender: Identity,
  matchId: bigint,
): { match: MatchRow; tournament: TournamentRow } {
  const userId = requireBoundUser(db, sender);
  const match = db.match.id.find(matchId);
  const tournament = match === null ? null : db.tournament.id.find(match.tournamentId);
  if (match === null || tournament === null || tournament.userId !== userId) {
    throw new Error("Match not found");
  }
  return { match, tournament };
}

// Roster and seeding stay editable, and the bracket regenerable, until
// the first result flips the tournament to live (story 10 + Lifecycle).
export const PRE_LIVE: readonly TournamentStatusTag[] = ["draft", "published"];
