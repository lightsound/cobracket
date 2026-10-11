import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { getOrganizer } from "../auth";

// Identity, ownership, and lifecycle guards.

export type TournamentStatus = Doc<"tournaments">["status"];

// Every operation funnels identity through getOrganizer (ADR 0003) and
// never takes it from client arguments.
export async function requireOrganizer(ctx: QueryCtx): Promise<Id<"users">> {
  const organizerId = await getOrganizer(ctx);
  if (organizerId === null) {
    throw new ConvexError("Not signed in");
  }
  return organizerId;
}

// "Missing" and "not yours" deliberately read the same so the API never
// confirms a foreign tournament's existence. The lookup accepts the raw
// string a URL carries: a malformed id is just another way of naming
// nothing, not an argument error. The caller resolves identity first, at the
// top of its handler, where the access-control lint looks for it.
export async function findOwnedTournament(
  ctx: QueryCtx,
  organizerId: Id<"users">,
  tournamentId: string,
): Promise<Doc<"tournaments"> | null> {
  const normalizedId = ctx.db.normalizeId("tournaments", tournamentId);
  const tournament = normalizedId === null ? null : await ctx.db.get("tournaments", normalizedId);
  if (tournament === null || tournament.organizerId !== organizerId) {
    return null;
  }
  return tournament;
}

// Mutations take a typed handle and refuse with one error; the Organizer's
// read (getTournament) returns null instead, since a URL that names nothing
// is a state to render, not a failure to retry.
export async function requireOwnedTournament(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
): Promise<Doc<"tournaments">> {
  const organizerId = await requireOrganizer(ctx);
  const tournament = await findOwnedTournament(ctx, organizerId, tournamentId);
  if (tournament === null) {
    throw new ConvexError("Tournament not found");
  }
  return tournament;
}

export function requireStatus(
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
export async function requireOwnedTournamentIn(
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
export async function requireOwnedParticipant(
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

export async function requireOwnedMatch(
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
export const PRE_LIVE: readonly TournamentStatus[] = ["draft", "published"];
