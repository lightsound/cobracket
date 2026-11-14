import type { Identity } from "spacetimedb";
import type { InferSchema, ReadonlyDbView } from "spacetimedb/server";
import type { spacetimedb } from "../schema";

// The read-side database handle the library helpers are written
// against: the schema's tables with their read accessors. Reducer and
// procedure code passes its own (writable) handle where a helper is
// shared; view code passes the view's.
export type Db = ReadonlyDbView<InferSchema<typeof spacetimedb>>;

// The binding row for a connection identity, or undefined when the
// identity has never been bound to an app_user. This is the module's
// one identity seam (ADR 0031): sender-gated views resolve the caller
// through it, and M2's reducers check it before anything else — the
// require* discipline of the Convex operations API, carried over as
// convention plus tests.
function bindingFor(db: Db, sender: Identity) {
  return db.identityUser.identity.find(sender);
}

// The app_user id a connection identity is bound to, or undefined.
export function userIdFor(db: Db, sender: Identity): bigint | undefined {
  return bindingFor(db, sender)?.userId;
}
