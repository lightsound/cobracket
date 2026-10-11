import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { MAX_MATCHES, takeAll } from "./limits";

// A structural roster or seeding change makes the generated bracket stale
// (structure is fixed at generation), so it is dropped and must be
// regenerated. Safe pre-live: no results exist yet, so nothing is orphaned.
export async function invalidateBracket(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
): Promise<void> {
  const matchDocs = await takeAll(
    ctx.db.query("matches").withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId)),
    MAX_MATCHES,
    "matches",
  );
  for (const doc of matchDocs) {
    await ctx.db.delete("matches", doc._id);
  }
}
