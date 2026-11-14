import { t } from "spacetimedb/server";
import type { WritableDb } from "./lib";
import {
  PRE_LIVE,
  invalidateBracket,
  loadRoster,
  requireName,
  requireOwnedParticipant,
  requireOwnedTournamentIn,
  requireRosterCapacity,
  requireStatus,
} from "./lib";
import { spacetimedb } from "./schema";

// Roster management and seeding (stories 4–8), the successor of
// convex/roster.ts. Every reducer resolves identity and ownership
// through the guards before touching a row.

function insertParticipant(
  db: WritableDb,
  tournamentId: bigint,
  rawName: string,
  seed: number,
): void {
  const name = requireName(rawName, "Participant name");
  db.participant.insert({ id: 0n, tournamentId, name, seed });
}

export const addParticipant = spacetimedb.reducer(
  { tournamentId: t.u64(), name: t.string() },
  (ctx, args) => {
    requireOwnedTournamentIn(ctx.db, ctx.sender, args.tournamentId, PRE_LIVE, "edit the roster");
    const roster = loadRoster(ctx.db, args.tournamentId);
    requireRosterCapacity(roster.length, 1);
    insertParticipant(ctx.db, args.tournamentId, args.name, roster.length + 1);
    invalidateBracket(ctx.db, args.tournamentId);
  },
);

// Bulk entry (story 5): one name per line, e.g. pasted from Discord.
// Blank lines and surrounding whitespace are dropped.
export const addParticipants = spacetimedb.reducer(
  { tournamentId: t.u64(), text: t.string() },
  (ctx, args) => {
    requireOwnedTournamentIn(ctx.db, ctx.sender, args.tournamentId, PRE_LIVE, "edit the roster");
    // fallow-ignore-next-line code-duplication -- intentionally mirrors the Convex original during the migration window (both backends live until M6 deletes the Convex side; this module copy is the survivor)
    const names = args.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
    if (names.length === 0) {
      throw new Error("No participant names given");
    }
    const roster = loadRoster(ctx.db, args.tournamentId);
    requireRosterCapacity(roster.length, names.length);
    for (const [index, name] of names.entries()) {
      insertParticipant(ctx.db, args.tournamentId, name, roster.length + index + 1);
    }
    invalidateBracket(ctx.db, args.tournamentId);
  },
);

export const renameParticipant = spacetimedb.reducer(
  { participantId: t.u64(), name: t.string() },
  (ctx, args) => {
    const { participant, tournament } = requireOwnedParticipant(
      ctx.db,
      ctx.sender,
      args.participantId,
    );
    requireStatus(tournament, PRE_LIVE, "edit the roster");
    const name = requireName(args.name, "Participant name");
    // Names live on the participant row and matches reference ids, so a
    // rename never invalidates the bracket.
    ctx.db.participant.id.update({ ...participant, name });
  },
);

export const removeParticipant = spacetimedb.reducer({ participantId: t.u64() }, (ctx, args) => {
  const { participant, tournament } = requireOwnedParticipant(
    ctx.db,
    ctx.sender,
    args.participantId,
  );
  requireStatus(tournament, PRE_LIVE, "edit the roster");
  ctx.db.participant.id.delete(participant.id);
  // Close the seed gap so seeds stay a contiguous 1..n sequence.
  const roster = loadRoster(ctx.db, tournament.id);
  for (const other of roster) {
    if (other.seed > participant.seed) {
      ctx.db.participant.id.update({ ...other, seed: other.seed - 1 });
    }
  }
  invalidateBracket(ctx.db, tournament.id);
});

// Manual reorder pins the given order and switches the tournament to
// manual seeding, so later regenerations preserve it instead of
// reshuffling.
export const reorderSeeding = spacetimedb.reducer(
  { tournamentId: t.u64(), orderedParticipantIds: t.array(t.u64()) },
  (ctx, args) => {
    const tournament = requireOwnedTournamentIn(
      ctx.db,
      ctx.sender,
      args.tournamentId,
      PRE_LIVE,
      "reorder the seeding",
    );
    const roster = loadRoster(ctx.db, args.tournamentId);
    // fallow-ignore-next-line code-duplication -- intentionally mirrors the Convex original during the migration window (both backends live until M6 deletes the Convex side; this module copy is the survivor)
    const rosterIds = new Set<bigint>(roster.map((participant) => participant.id));
    const orderedIds = new Set<bigint>(args.orderedParticipantIds);
    if (
      args.orderedParticipantIds.length !== roster.length ||
      orderedIds.size !== rosterIds.size ||
      [...orderedIds].some((id) => !rosterIds.has(id))
    ) {
      throw new Error("The new order must contain every participant exactly once");
    }
    const byId = new Map(roster.map((participant) => [participant.id, participant]));
    for (const [index, participantId] of args.orderedParticipantIds.entries()) {
      const participant = byId.get(participantId)!;
      ctx.db.participant.id.update({ ...participant, seed: index + 1 });
    }
    ctx.db.tournament.id.update({ ...tournament, seeding: { tag: "manual" } });
    invalidateBracket(ctx.db, args.tournamentId);
  },
);
