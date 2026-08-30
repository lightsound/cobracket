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

// What a verified request's identity resolves to. "unauthenticated" (no JWT
// sent — an unverifiable one is refused by Convex before the query runs)
// and "user_missing" (JWT verified, but its user row is gone) are
// deliberately distinct: conflating them once made the client treat any
// verification gap as a deleted user and revoke real sessions.
type SessionState =
  | { kind: "unauthenticated" }
  | { kind: "user_missing" }
  | { kind: "organizer"; userId: Id<"users"> };

async function resolveSession(ctx: QueryCtx): Promise<SessionState> {
  // getAuthUserId types the JWT subject but does not validate it: normalizeId
  // rejects a malformed or foreign-table subject, and the read rejects a
  // deleted user whose JWT is still live — never a dangling id.
  const subject = await getAuthUserId(ctx);
  if (subject === null) return { kind: "unauthenticated" };
  const userId = ctx.db.normalizeId("users", subject);
  if (userId === null) return { kind: "user_missing" };
  if ((await ctx.db.get("users", userId)) === null) return { kind: "user_missing" };
  return { kind: "organizer", userId };
}

/**
 * Who the caller is: the signed-in Organizer's user id, or null. The seam
 * every Organizer capability (operations API, MCP tokens later) resolves
 * identity through, so an added auth mechanism stays an edit to this module.
 */
export async function getOrganizer(ctx: QueryCtx): Promise<Id<"users"> | null> {
  const session = await resolveSession(ctx);
  return session.kind === "organizer" ? session.userId : null;
}

// The same answer for clients, as a subscribable query.
export const currentOrganizer = query({
  args: {},
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx) => getOrganizer(ctx),
});

// The full distinction, for the client's session verification: it must
// react differently to a missing user row (drop the dead session) and an
// unverifiable token (keep the session, report the misconfiguration).
export const sessionState = query({
  args: {},
  returns: v.union(
    v.object({ kind: v.literal("unauthenticated") }),
    v.object({ kind: v.literal("user_missing") }),
    v.object({ kind: v.literal("organizer"), userId: v.id("users") }),
  ),
  handler: async (ctx) => resolveSession(ctx),
});
