import { v } from "convex/values";
import { query } from "./_generated/server";
import { normalizeDisciplineName } from "./model";

// Suggestions for the freeform Discipline field (story 2): prefix search on
// the normalized form. Public on purpose — discipline names are not
// organizer-private, and the create form runs before any tournament exists.
// oxlint-disable-next-line @convex-dev/require-access-control -- public until events.md narrows it to the caller's own Disciplines
export const suggestDisciplines = query({
  args: { prefix: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const { normalizedName: prefix } = normalizeDisciplineName(args.prefix);
    if (prefix === "") {
      return [];
    }
    const rows = await ctx.db
      .query("disciplines")
      .withIndex("by_normalized_name", (q) =>
        q.gte("normalizedName", prefix).lt("normalizedName", `${prefix}\uffff`),
      )
      .take(10);
    return rows.map((row) => row.name);
  },
});
