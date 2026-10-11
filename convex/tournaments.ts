import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  MAX_MATCHES,
  MAX_RESULTS,
  MAX_ROSTER_SIZE,
  PRE_LIVE,
  buildTournamentView,
  findOwnedTournament,
  formatArgsValidator,
  formatValidator,
  getOrCreateDiscipline,
  invalidateBracket,
  organizerTournamentViewValidator,
  requireDiscipline,
  requireName,
  requireOrganizer,
  requireOwnedTournament,
  requireStatus,
  statusValidator,
  takeAll,
  withMatchIds,
} from "./model";

// Tournament creation, settings, deletion, and the Organizer's reads
// (stories 1–3, 9, 15–17, 25–27).

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_LENGTH = 12;

// The Share Link identifier: an unlisted tournament's URL is its only guard,
// so the slug is minted from crypto randomness (~62 bits) instead of reusing
// the document id, whose format is an implementation detail and not designed
// to be a capability.
function randomSlug(): string {
  const bytes = new Uint8Array(SLUG_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => SLUG_ALPHABET[byte % SLUG_ALPHABET.length]).join("");
}

async function mintShareSlug(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = randomSlug();
    const taken = await ctx.db
      .query("tournaments")
      .withIndex("by_share_slug", (q) => q.eq("shareSlug", slug))
      .unique();
    if (taken === null) {
      return slug;
    }
  }
  throw new Error("could not allocate a share slug");
}

type Format = Doc<"tournaments">["format"];

// Grand-final bracket reset defaults to on (spec: Format engine).
function toStoredFormat(format: Infer<typeof formatArgsValidator>): Format {
  return format.family === "double_elimination"
    ? { family: "double_elimination", grandFinalReset: format.grandFinalReset ?? true }
    : { family: "single_elimination" };
}

function sameFormat(a: Format, b: Format): boolean {
  if (a.family === "single_elimination" || b.family === "single_elimination") {
    return a.family === b.family;
  }
  return a.grandFinalReset === b.grandFinalReset;
}

export const createTournament = mutation({
  args: {
    name: v.string(),
    discipline: v.string(),
    format: formatArgsValidator,
  },
  returns: v.object({ tournamentId: v.id("tournaments"), shareSlug: v.string() }),
  handler: async (ctx, args) => {
    const organizerId = await requireOrganizer(ctx);
    const name = requireName(args.name, "Tournament name");
    const disciplineId = await getOrCreateDiscipline(ctx, args.discipline);
    const format = toStoredFormat(args.format);
    const shareSlug = await mintShareSlug(ctx);
    const tournamentId = await ctx.db.insert("tournaments", {
      name,
      organizerId,
      disciplineId,
      format,
      // Elimination requires a decisive outcome; the field ships for later
      // draw-capable families.
      drawsAllowed: false,
      status: "draft",
      visibility: "unlisted",
      shareSlug,
    });
    return { tournamentId, shareSlug };
  },
});

// Partial update: every field is optional and independently validated. Name
// and Discipline are labels, so they stay editable in every status (a typo on
// the Share Link is worth fixing after completion too). The Format decides
// the bracket structure, so changing it is a pre-live operation that drops
// the generated bracket, exactly like a roster change.
export const updateTournament = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.optional(v.string()),
    discipline: v.optional(v.string()),
    format: v.optional(formatArgsValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tournament = await requireOwnedTournament(ctx, args.tournamentId);
    const patch: Partial<Pick<Doc<"tournaments">, "name" | "disciplineId" | "format">> = {};
    if (args.name !== undefined) {
      patch.name = requireName(args.name, "Tournament name");
    }
    if (args.discipline !== undefined) {
      patch.disciplineId = await getOrCreateDiscipline(ctx, args.discipline);
    }
    if (args.format !== undefined) {
      const format = toStoredFormat(args.format);
      // Re-submitting the current format is a no-op in every status, so a
      // settings form can always send the whole record.
      if (!sameFormat(format, tournament.format)) {
        requireStatus(tournament, PRE_LIVE, "change the format");
        patch.format = format;
        await invalidateBracket(ctx, tournament._id);
      }
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch("tournaments", tournament._id, patch);
    }
    return null;
  },
});

// Deletion is physical and whole (ADR 0011): the tournament and everything
// that hangs off it — roster, bracket, results — go together, in every
// status. Results are never deleted on their own (ADR 0005: corrections are
// the only way to change them); removing the tournament they belong to is a
// different act. The Share Link reads as not found from then on. Bounded by
// one tournament's size, like every other per-tournament write.
export const deleteTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tournament = await requireOwnedTournament(ctx, args.tournamentId);
    const bounds = { results: MAX_RESULTS, matches: MAX_MATCHES, participants: MAX_ROSTER_SIZE };
    for (const table of ["results", "matches", "participants"] as const) {
      const docs = await takeAll(
        ctx.db.query(table).withIndex("by_tournament", (q) => q.eq("tournamentId", tournament._id)),
        bounds[table],
        table,
      );
      for (const doc of docs) {
        await ctx.db.delete(table, doc._id);
      }
    }
    await ctx.db.delete("tournaments", tournament._id);
    return null;
  },
});

export const listMyTournaments = query({
  args: {},
  returns: v.array(
    v.object({
      tournamentId: v.id("tournaments"),
      name: v.string(),
      status: statusValidator,
      format: formatValidator,
      discipline: v.string(),
      shareSlug: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const organizerId = await requireOrganizer(ctx);
    const tournaments = await ctx.db
      .query("tournaments")
      .withIndex("by_organizer", (q) => q.eq("organizerId", organizerId))
      .order("desc")
      // Newest 100 only, no cursor — callers must not assume completeness.
      // Enough headroom for the MVP; pagination is an additive change.
      .take(100);
    return await Promise.all(
      tournaments.map(async (tournament) => ({
        tournamentId: tournament._id,
        name: tournament.name,
        status: tournament.status,
        format: tournament.format,
        discipline: (await requireDiscipline(ctx, tournament.disciplineId)).name,
        shareSlug: tournament.shareSlug,
      })),
    );
  },
});

// The Organizer's full view, drafts included (story 9: see the bracket
// before anyone else does). Keyed by the raw URL segment and null for
// anything that is not the caller's tournament — malformed, missing (e.g.
// just deleted in another tab), or someone else's — so the page renders a
// not-found state instead of an error to retry.
export const getTournament = query({
  args: { tournamentId: v.string() },
  returns: v.union(organizerTournamentViewValidator, v.null()),
  handler: async (ctx, args) => {
    const organizerId = await requireOrganizer(ctx);
    const tournament = await findOwnedTournament(ctx, organizerId, args.tournamentId);
    if (tournament === null) {
      return null;
    }
    const { view, bracket } = await buildTournamentView(ctx, tournament);
    return {
      ...view,
      bracket: view.bracket === null ? null : withMatchIds(view.bracket, bracket),
      tournamentId: tournament._id,
      shareSlug: tournament.shareSlug,
      seeding: tournament.seeding ?? "random",
    };
  },
});
