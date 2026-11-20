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
      drawsAllowed: false,
      status: "draft",
      visibility: "unlisted",
      shareSlug,
    });
    return { tournamentId, shareSlug };
  },
});

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

// Deletion is physical and whole, in every status: docs/adr/0011-physical-whole-tournament-deletion.md.
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
