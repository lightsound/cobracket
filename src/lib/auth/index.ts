import type { Accessor } from "solid-js";
import { backendSelection, createBackendQuery } from "../backend";
import { api as seamApi } from "../operations";
import { ensureConvexOrganizer, initConvexAuth } from "./convex";

// The auth boundary (ADR 0003): the rest of the app knows only the
// @public exports — bootstrap, "who is the current Organizer", and
// "make sure I am one". Behind it sit two implementations, selected
// with the data seam's backend (`../backend`): `./convex` (Convex
// Auth v2 Anonymous Sign-In; the production default) and
// `./spacetimedb` (native Identity plus the module's binding table,
// ADR 0031; loaded lazily, like the adapter it rides on). If either
// platform's auth changes shape, its file is swapped, not the app.

/**
 * Bootstrap the auth session for this browser: restore a persisted
 * session (story 25) and keep the backend connection authenticated
 * from then on. Call once from the app root; idempotent, a no-op
 * during SSR and without a configured backend.
 *
 * @public
 */
export function initAuth(): void {
  if (backendSelection() === "spacetimedb") {
    void import("./spacetimedb").then((impl) => impl.initSpacetimeAuth());
  } else {
    initConvexAuth();
  }
}

/**
 * Make sure the caller has an Organizer identity, establishing one
 * if this browser has none (story 1: zero sign-up). Once it
 * resolves, later backend calls run as that Organizer. Call it from
 * the handler of any Organizer action; concurrent callers collapse
 * into one establishment. What establishment costs and how it is
 * serialized is each implementation's own affair (`./convex`,
 * `./spacetimedb`).
 *
 * @public
 */
export async function ensureOrganizer(): Promise<void> {
  if (backendSelection() === "spacetimedb") {
    const impl = await import("./spacetimedb");
    await impl.ensureSpacetimeOrganizer();
  } else {
    await ensureConvexOrganizer();
  }
}

/**
 * The current Organizer's user id, or null when signed out — as the
 * backend sees it (derived from the caller's verified identity,
 * never from client state).
 *
 * A reactive subscription through the data seam (`src/lib/backend`),
 * created once for the whole app by `src/organizer.tsx` and read
 * through `useOrganizer()` under `<Loading>` / `<Errored>`
 * boundaries, gated on `getBackendUrl()` like every other backend
 * read. Flips from null to the id once the session is live.
 *
 * @public
 */
export function createOrganizer(): Accessor<string | null> {
  return createBackendQuery(seamApi.auth.currentOrganizer, {});
}
