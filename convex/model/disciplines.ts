import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireName } from "./limits";

export function normalizeDisciplineName(raw: string): { name: string; normalizedName: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  return { name, normalizedName: name.toLowerCase() };
}

// Disciplines are freeform organizer input, normalized into rows so the same
// discipline entered twice (case/spacing aside) is one row (story 2).
export async function getOrCreateDiscipline(
  ctx: MutationCtx,
  rawName: string,
): Promise<Id<"disciplines">> {
  const { name, normalizedName } = normalizeDisciplineName(rawName);
  requireName(name, "Discipline");
  const existing = await ctx.db
    .query("disciplines")
    .withIndex("by_normalized_name", (q) => q.eq("normalizedName", normalizedName))
    .unique();
  if (existing !== null) {
    return existing._id;
  }
  return await ctx.db.insert("disciplines", { name, normalizedName });
}
