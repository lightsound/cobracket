import { t } from "spacetimedb/server";
import { organizerIdFor, requireBoundUser, resolveSession } from "./lib";
import { spacetimedb } from "./schema";

// The explicit bind: an identity's first act mints its app_user row
// (idempotent per identity). The standing rule is that every reducer
// binds on first use through requireBoundUser; this entry exists so a
// client can establish the binding before it has any operation to
// perform (the ensureOrganizer seam of src/lib/auth), exactly as
// anonymous sign-in preceded the first mutation on Convex.
export const bindIdentity = spacetimedb.reducer({}, (ctx) => {
  requireBoundUser(ctx.db, ctx.sender);
});

// What the caller's identity resolves to — the three-way union
// convex/auth.ts's sessionState returned, kept exactly: the client
// reacts differently to an identity that was never bound (bind it),
// one whose user row is gone (drop the dead identity), and a live
// binding (proceed). (The type is named SessionStateKind, not
// SessionState: the bare name collides in the module typespace and
// the definition is rejected — measured, 2026-11-15.)
const SessionStateKind = t.enum("SessionStateKind", {
  unauthenticated: t.unit(),
  user_missing: t.unit(),
  organizer: t.object("SessionOrganizer", { userId: t.u64() }),
});

const SessionStateRow = t.row("SessionStateRow", { state: SessionStateKind });

export const sessionState = spacetimedb.view(
  { name: "session_state", public: true },
  t.array(SessionStateRow),
  (ctx) => {
    const session = resolveSession(ctx.db, ctx.sender);
    switch (session.kind) {
      case "unauthenticated":
        return [{ state: { tag: "unauthenticated" } }];
      case "user_missing":
        return [{ state: { tag: "user_missing" } }];
      case "organizer":
        return [{ state: { tag: "organizer", value: { userId: session.userId } } }];
    }
  },
);

const CurrentOrganizerRow = t.row("CurrentOrganizerRow", { userId: t.u64() });

export const currentOrganizer = spacetimedb.view(
  { name: "current_organizer", public: true },
  t.option(CurrentOrganizerRow),
  (ctx) => {
    const userId = organizerIdFor(ctx.db, ctx.sender);
    return userId === undefined ? undefined : { userId };
  },
);
