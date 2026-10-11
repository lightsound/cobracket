import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation } from "./_generated/server";
import {
  PRE_LIVE,
  invalidateBracket,
  loadRoster,
  requireName,
  requireOwnedParticipant,
  requireOwnedTournamentIn,
  requireRosterCapacity,
  requireStatus,
} from "./model";

// Roster management and seeding (stories 4–8).

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
