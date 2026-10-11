import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { buildTournamentView, tournamentViewValidator } from "./model";

// The Share Link's access rule: the slug is the bearer credential, and it
// opens only a published, non-private tournament. MVP behavior is
// unlisted-only, but the gate reads the visibility field from day one so a
// future mutation exposing it cannot leak by omission.
function canViewShared(tournament: Doc<"tournaments"> | null): tournament is Doc<"tournaments"> {
  return (
    tournament !== null && tournament.status !== "draft" && tournament.visibility !== "private"
  );
}

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
    if (!canViewShared(tournament)) {
      return null;
    }
    return (await buildTournamentView(ctx, tournament)).view;
  },
});
