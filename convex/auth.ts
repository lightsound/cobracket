import { getAuthUserId } from "@convex-dev/auth/core";
import { setupCore } from "@convex-dev/auth/core/setup";
import { setupAnonymous } from "@convex-dev/auth/providers/anonymous/setup";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, query } from "./_generated/server";

// The whole auth surface lives in this one module (ADR 0003): Convex Auth v2
// (preview) with Anonymous Sign-In. Everything else in convex/ learns "who is
// the current Organizer" through getOrganizer (verified against the core's
// JWKS via auth.config.ts), never from client-supplied arguments.

const core = setupCore({ component: components.auth });

export const { signOut, refreshSession } = core;

// The app owns the users table; the core only stores the id this callback
// returns. Anonymous sign-ins have no profile, so a sign-in mints a bare row.
export const createUserAnonymous = internalMutation({
  args: {
    provider: v.literal("anonymous"),
    providerAccountId: v.string(),
    profile: v.object({}),
  },
  returns: v.id("users"),
  handler: async (ctx) => {
    return await ctx.db.insert("users", {});
  },
});

export const { signInAnonymous } = setupAnonymous(core, {
  component: components.authAnonymous,
}).attachUserCallbacks({ createUser: internal.auth.createUserAnonymous });

/**
 * Who the caller is: the signed-in Organizer's user id, or null. The seam
 * every Organizer capability (operations API, MCP tokens later) resolves
 * identity through, so an added auth mechanism stays an edit to this module.
 *
 * getAuthUserId types the JWT subject but does not validate it against the
 * table; normalizeId turns a stale or foreign subject into null instead of
 * letting a bad id flow into reads.
 */
export async function getOrganizer(ctx: QueryCtx): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  return userId === null ? null : ctx.db.normalizeId("users", userId);
}

// The same answer for clients, as a subscribable query.
export const currentOrganizer = query({
  args: {},
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx) => getOrganizer(ctx),
});
