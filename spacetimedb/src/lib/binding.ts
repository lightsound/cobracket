import type { Identity } from "spacetimedb";
import type { DbView, InferSchema, ReadonlyDbView } from "spacetimedb/server";
import { SenderError } from "spacetimedb/server";
import type { spacetimedb } from "../schema";

// The read-side database handle the library helpers are written
// against: the schema's tables with their read accessors. Reducer and
// procedure code passes its own (writable) handle where a helper is
// shared; view code passes the view's.
export type Db = ReadonlyDbView<InferSchema<typeof spacetimedb>>;

export type WritableDb = DbView<InferSchema<typeof spacetimedb>>;

export type TournamentRow = NonNullable<ReturnType<Db["tournament"]["id"]["find"]>>;
export type ParticipantRow = NonNullable<ReturnType<Db["participant"]["id"]["find"]>>;
export type MatchRow = NonNullable<ReturnType<Db["match"]["id"]["find"]>>;
export type ResultRow = NonNullable<ReturnType<Db["result"]["id"]["find"]>>;

export type TournamentStatusTag = TournamentRow["status"]["tag"];

function bindingFor(db: Db, sender: Identity) {
  return db.identityUser.identity.find(sender);
}

// What a connection identity resolves to — the three-way distinction
// of session resolution, re-expressed (ADR 0031): no
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

export function organizerIdFor(db: Db, sender: Identity): bigint | undefined {
  const session = resolveSession(db, sender);
  return session.kind === "organizer" ? session.userId : undefined;
}

export function requireBoundUser(db: WritableDb, sender: Identity): bigint {
  const binding = bindingFor(db, sender);
  if (binding !== null) {
    if (db.appUser.id.find(binding.userId) === null) {
      throw new SenderError("Not signed in");
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
