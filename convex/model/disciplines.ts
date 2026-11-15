import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { MAX_DISCIPLINES, requireName } from "./limits";

export function normalizeDisciplineName(raw: string): { name: string; normalizedName: string } {
  // Canonical equivalence only: NFC folds canonically identical spellings
  // (e.g. a precomposed accented letter vs. the letter plus a combining
  // mark) onto one row. Compatibility folding (NFKC) is deliberately NOT
  // applied — it would merge display forms organizers may intend as
  // distinct (full- vs half-width) and rewrite their text.
  const name = raw.trim().replace(/\s+/g, " ").normalize("NFC");
  // Lowercasing can decompose (e.g. İ), so normalize again after it.
  return { name, normalizedName: name.toLowerCase().normalize("NFC") };
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
  // Only a new row counts against the cap: reusing an existing discipline
  // stays allowed at any count. Take one past the cap, like takeAll, so an
  // already over-cap table is seen rather than truncated silently.
  const rows = await ctx.db.query("disciplines").take(MAX_DISCIPLINES + 1);
  if (rows.length >= MAX_DISCIPLINES) {
    throw new ConvexError(`Cannot add a new discipline: the list is limited to ${MAX_DISCIPLINES}`);
  }
  return await ctx.db.insert("disciplines", { name, normalizedName });
}
