import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { MAX_MATCHES, takeAll } from "./limits";

// Structural changes drop the generated bracket: docs/specs/mvp.md.
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
