import type { Identity } from "spacetimedb";
import type { DbView, InferSchema, ReadonlyDbView } from "spacetimedb/server";
import type { spacetimedb } from "../schema";

// The read-side database handle the library helpers are written
// against: the schema's tables with their read accessors. Reducer and
// procedure code passes its own (writable) handle where a helper is
// shared; view code passes the view's.
export type Db = ReadonlyDbView<InferSchema<typeof spacetimedb>>;

// The writable handle, for the helpers that write the binding itself.
export type WritableDb = DbView<InferSchema<typeof spacetimedb>>;

// The binding row for a connection identity, or null when the
// identity has never been bound to an app_user. This is the module's
// one identity seam (ADR 0031): sender-gated views resolve the caller
// through it, and a reducer's first act must be to consult it — the
// require* discipline of the Convex operations API, carried over as
// convention plus tests.
function bindingFor(db: Db, sender: Identity) {
  return db.identityUser.identity.find(sender);
}

// What a connection identity resolves to — the three-way distinction
// convex/auth.ts's resolveSession kept, re-expressed (ADR 0031): no
// binding yet is "unauthenticated" (the identity has never acted, so
// it has no user); a binding whose app_user row is gone is
// "user_missing" (today that is a deleted user; ADR 0031's alias case
// — an identity merged into an account — joins it when linking lands
// with Events slice 1, and the shape already covers both); a live
// binding is the Organizer. The client drops a dead identity rather
// than reading a verification gap as a sign-out or vice versa.
export type SessionResolution =
  | { kind: "unauthenticated" }
  | { kind: "user_missing" }
  | { kind: "organizer"; userId: bigint };

export function resolveSession(db: Db, sender: Identity): SessionResolution {
  const binding = bindingFor(db, sender);
  if (binding === null) {
    return { kind: "unauthenticated" };
  }
  if (db.appUser.id.find(binding.userId) === null) {
    return { kind: "user_missing" };
  }
  return { kind: "organizer", userId: binding.userId };
}

// The caller's app_user id when their identity resolves to one — the
// read-side getOrganizer. Null-equivalent (undefined) covers both
// unauthenticated and user_missing, exactly as on Convex.
export function organizerIdFor(db: Db, sender: Identity): bigint | undefined {
  const session = resolveSession(db, sender);
  return session.kind === "organizer" ? session.userId : undefined;
}

// The write-side seam every reducer consults first: the caller's
// app_user id, binding the identity when this is its first act
// (ADR 0031: the first reducer call from an unbound identity binds it
// to a fresh app_user, idempotently per identity — this replaces
// anonymous sign-in wholesale). A binding whose app_user row is gone
// refuses with "Not signed in", as requireOrganizer did when
// getOrganizer resolved null: the identity is real, but it no longer
// names a user, and silently minting a replacement would resurrect a
// deleted user under the same credential. Because a reducer is
// atomic, a call that later throws leaves no binding behind — a
// failed first act does not sign anyone in.
export function requireBoundUser(db: WritableDb, sender: Identity): bigint {
  const binding = bindingFor(db, sender);
  if (binding !== null) {
    if (db.appUser.id.find(binding.userId) === null) {
      throw new Error("Not signed in");
    }
    return binding.userId;
  }
  const user = db.appUser.insert({ id: 0n });
  db.identityUser.insert({
    identity: sender,
    userId: user.id,
    kind: { tag: "anonymous" },
  });
  return user.id;
}
